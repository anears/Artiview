//! SSH/SFTP remote folder support: a per-host connection pool, a capped
//! directory walker for scans, and the `remote://` protocol server that
//! proxies file reads for the webview.
//!
//! Remote entries are stored with `sftp://<hostkey><abs-path>` paths, where
//! `<hostkey>` is the user-entered target ("alias" | "user@host" |
//! "user@host:port") kept verbatim — ~/.ssh/config resolution happens only at
//! connect time. Passwords are cached in memory for the app run and are never
//! written to disk.

use percent_encoding::percent_decode_str;
use ssh2::{ErrorCode, Session, Sftp};
use ssh2_config::{ParseRule, SshConfig};
use std::collections::HashMap;
use std::io::Read;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const SFTP_PREFIX: &str = "sftp://";

const DIAL_TIMEOUT: Duration = Duration::from_secs(10);
/// libssh2 blocking-op timeout (handshake, auth, every SFTP op).
const OP_TIMEOUT_MS: u32 = 15_000;
/// After a failed connect, fail fast for this long instead of letting every
/// queued thumbnail request wait out its own full dial timeout.
const DOWN_COOLDOWN: Duration = Duration::from_secs(30);
const MAX_DEPTH: usize = 16;
const MAX_ENTRIES: usize = 20_000;
pub const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

// LIBSSH2_FX_* codes for SFTP-level failures.
const FX_NO_SUCH_FILE: i32 = 2;
const FX_NO_SUCH_PATH: i32 = 10;

// ---- URL helpers -------------------------------------------------------------

/// `"sftp://alice@build01:2222/data/reports"` → `("alice@build01:2222", "/data/reports")`.
pub fn split_sftp_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix(SFTP_PREFIX)?;
    let (hostkey, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    if hostkey.is_empty() {
        return None;
    }
    Some((hostkey.to_string(), path.to_string()))
}

/// Decode a `remote://` request path (`"/alice%40build01%3A2222/a/b%20c"`)
/// back into `("alice@build01:2222", "/a/b c")`. The first segment is the
/// percent-encoded hostkey; the rest is the remote path with each segment
/// percent-encoded but real `/` separators (so `<base href>` resolution works).
pub fn parse_protocol_path(uri_path: &str) -> Option<(String, String)> {
    let rest = uri_path.strip_prefix('/')?;
    let (hk, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    if hk.is_empty() {
        return None;
    }
    let hostkey = percent_decode_str(hk).decode_utf8().ok()?.to_string();
    let segments = path
        .split('/')
        .map(|s| percent_decode_str(s).decode_utf8().map(|c| c.to_string()))
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    Some((hostkey, segments.join("/")))
}

struct Target<'a> {
    user: Option<&'a str>,
    host: &'a str,
    port: Option<u16>,
}

/// Split `"user@host:port"` (both parts optional) into pieces. A trailing
/// `:...` that doesn't parse as a port is treated as part of the host, so
/// bare IPv6 literals degrade gracefully rather than panicking.
fn parse_hostkey(hostkey: &str) -> Target<'_> {
    let (user, rest) = match hostkey.rsplit_once('@') {
        Some((u, r)) => (Some(u), r),
        None => (None, hostkey),
    };
    match rest.rsplit_once(':') {
        Some((h, p)) => match p.parse::<u16>() {
            Ok(port) => Target { user, host: h, port: Some(port) },
            Err(_) => Target { user, host: rest, port: None },
        },
        None => Target { user, host: rest, port: None },
    }
}

// ---- errors ------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct AuthSpec {
    /// "auto" | "key" | "password"
    pub auth: String,
    pub key_path: Option<String>,
}

pub enum RemoteError {
    /// The server accepts password auth and we have no (working) password
    /// cached for this run — the UI should prompt and retry.
    PasswordRequired(String),
    Auth(String),
    NotFound,
    Unreachable(String),
    Other(String),
}

impl RemoteError {
    /// Stable string form for Tauri command errors. The PASSWORD_REQUIRED
    /// marker is a contract with the frontend password-prompt flow.
    pub fn to_command_error(&self) -> String {
        match self {
            RemoteError::PasswordRequired(hk) => format!("PASSWORD_REQUIRED:{hk}"),
            RemoteError::Auth(hk) => {
                format!("Authentication to '{hk}' failed (check your keys / ssh-agent)")
            }
            RemoteError::NotFound => "Remote path not found".into(),
            RemoteError::Unreachable(m) => format!("Could not reach the server: {m}"),
            RemoteError::Other(m) => format!("Remote operation failed: {m}"),
        }
    }
}

fn map_sftp_error(e: ssh2::Error) -> RemoteError {
    match e.code() {
        ErrorCode::SFTP(FX_NO_SUCH_FILE) | ErrorCode::SFTP(FX_NO_SUCH_PATH) => RemoteError::NotFound,
        _ => RemoteError::Other(e.to_string()),
    }
}

/// Session-level (non-SFTP) errors usually mean the transport died — a stale
/// TCP connection after sleep or a network change — and warrant one reconnect.
fn is_transport_error(e: &ssh2::Error) -> bool {
    matches!(e.code(), ErrorCode::Session(_))
}

/// ssh2's `Read` impl wraps its errors in `io::Error`; recover the original
/// so the reconnect logic can classify it.
fn io_to_ssh2(e: std::io::Error) -> ssh2::Error {
    match e.into_inner().and_then(|b| b.downcast::<ssh2::Error>().ok()) {
        Some(inner) => *inner,
        None => ssh2::Error::from_errno(ErrorCode::Session(-43 /* LIBSSH2_ERROR_SOCKET_RECV */)),
    }
}

// ---- connection pool -----------------------------------------------------------

struct Conn {
    // Held to keep the transport alive alongside the SFTP channel.
    _sess: Session,
    sftp: Sftp,
}

#[derive(Default)]
pub struct Pool {
    /// One slot per hostkey; the inner mutex serializes all SFTP ops per host
    /// (thumbnail fetches naturally queue) and guards reconnects.
    conns: Mutex<HashMap<String, Arc<Mutex<Option<Conn>>>>>,
    /// In-memory only — never persisted. Gone on app restart by design.
    passwords: Mutex<HashMap<String, String>>,
    /// Mirror of the `remotes` table, loaded at startup so the protocol
    /// handler never needs the DB lock.
    auth: Mutex<HashMap<String, AuthSpec>>,
    down: Mutex<HashMap<String, Instant>>,
}

impl Pool {
    pub fn set_password(&self, hostkey: &str, password: String) {
        self.passwords.lock().unwrap().insert(hostkey.to_string(), password);
        // A fresh password is a reason to try again immediately.
        self.down.lock().unwrap().remove(hostkey);
    }

    pub fn set_auth(&self, hostkey: &str, spec: AuthSpec) {
        self.auth.lock().unwrap().insert(hostkey.to_string(), spec);
    }

    /// Run `f` against a live SFTP channel for `hostkey`, connecting on
    /// demand. On a transport-level failure the session is dropped,
    /// reconnected once, and `f` retried.
    pub fn with_sftp<T>(
        &self,
        hostkey: &str,
        f: impl Fn(&Sftp) -> Result<T, ssh2::Error>,
    ) -> Result<T, RemoteError> {
        let slot = {
            let mut conns = self.conns.lock().unwrap();
            conns.entry(hostkey.to_string()).or_default().clone()
        };
        let mut guard = slot.lock().unwrap();

        if guard.is_none() {
            *guard = Some(self.connect_guarded(hostkey)?);
        }

        match f(&guard.as_ref().unwrap().sftp) {
            Ok(v) => Ok(v),
            Err(e) if is_transport_error(&e) => {
                *guard = None;
                *guard = Some(self.connect_guarded(hostkey)?);
                f(&guard.as_ref().unwrap().sftp).map_err(map_sftp_error)
            }
            Err(e) => Err(map_sftp_error(e)),
        }
    }

    /// Connect with the down-cooldown bookkeeping around it.
    fn connect_guarded(&self, hostkey: &str) -> Result<Conn, RemoteError> {
        if let Some(t) = self.down.lock().unwrap().get(hostkey) {
            if t.elapsed() < DOWN_COOLDOWN {
                return Err(RemoteError::Unreachable("a recent connection attempt failed".into()));
            }
        }
        match self.connect(hostkey) {
            Ok(c) => {
                self.down.lock().unwrap().remove(hostkey);
                Ok(c)
            }
            Err(e) => {
                if matches!(e, RemoteError::Unreachable(_)) {
                    self.down.lock().unwrap().insert(hostkey.to_string(), Instant::now());
                }
                Err(e)
            }
        }
    }

    fn connect(&self, hostkey: &str) -> Result<Conn, RemoteError> {
        let spec = self.auth.lock().unwrap().get(hostkey).cloned().unwrap_or_default();
        let password = self.passwords.lock().unwrap().get(hostkey).cloned();
        let t = parse_hostkey(hostkey);

        // ~/.ssh/config: resolve alias/host → HostName, User, Port, IdentityFile.
        let params = SshConfig::parse_default_file(ParseRule::ALLOW_UNKNOWN_FIELDS)
            .map(|c| c.query(t.host))
            .ok();
        let host = params
            .as_ref()
            .and_then(|p| p.host_name.clone())
            .unwrap_or_else(|| t.host.to_string());
        let port = t.port.or_else(|| params.as_ref().and_then(|p| p.port)).unwrap_or(22);
        let user = t
            .user
            .map(str::to_string)
            .or_else(|| params.as_ref().and_then(|p| p.user.clone()))
            .or_else(|| std::env::var("USER").ok())
            .ok_or_else(|| RemoteError::Other("Could not determine the username to connect with".into()))?;

        let addr = (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|e| RemoteError::Unreachable(e.to_string()))?
            .next()
            .ok_or_else(|| RemoteError::Unreachable(format!("could not resolve the address of {host}")))?;
        let tcp = TcpStream::connect_timeout(&addr, DIAL_TIMEOUT)
            .map_err(|e| RemoteError::Unreachable(e.to_string()))?;

        let mut sess = Session::new().map_err(|e| RemoteError::Other(e.to_string()))?;
        sess.set_tcp_stream(tcp);
        sess.set_timeout(OP_TIMEOUT_MS);
        sess.handshake().map_err(|e| RemoteError::Unreachable(e.to_string()))?;
        // NOTE: the host key is not verified against known_hosts yet (future work).

        // Auth order: cached password → explicit key file → ssh-agent →
        // config IdentityFile → default key files. Attempts are best-effort;
        // the first one that authenticates wins.
        if let Some(pw) = &password {
            let _ = sess.userauth_password(&user, pw);
        }
        if !sess.authenticated() && spec.auth == "key" {
            if let Some(k) = &spec.key_path {
                let _ = sess.userauth_pubkey_file(&user, None, Path::new(k), None);
            }
        }
        if !sess.authenticated() {
            let _ = sess.userauth_agent(&user);
        }
        if !sess.authenticated() {
            let mut keys: Vec<PathBuf> = params
                .as_ref()
                .and_then(|p| p.identity_file.clone())
                .unwrap_or_default();
            if let Some(home) = std::env::var_os("HOME") {
                let ssh_dir = PathBuf::from(home).join(".ssh");
                for name in ["id_ed25519", "id_ecdsa", "id_rsa"] {
                    keys.push(ssh_dir.join(name));
                }
            }
            for key in keys.iter().filter(|k| k.exists()) {
                let _ = sess.userauth_pubkey_file(&user, None, key, None);
                if sess.authenticated() {
                    break;
                }
            }
        }
        if !sess.authenticated() {
            // If the server would take a password, ask the user for one (a
            // cached-but-wrong password also lands here → fresh prompt).
            let methods = sess.auth_methods(&user).unwrap_or("");
            return Err(if methods.contains("password") {
                RemoteError::PasswordRequired(hostkey.to_string())
            } else {
                RemoteError::Auth(hostkey.to_string())
            });
        }

        let sftp = sess.sftp().map_err(|e| RemoteError::Other(e.to_string()))?;
        Ok(Conn { _sess: sess, sftp })
    }
}

// ---- walking & reading ---------------------------------------------------------

pub struct RemoteEntry {
    pub path: String,
    pub size: i64,
    pub modified: i64,
}

/// Iterative walk over `readdir` (one round trip per directory; the returned
/// attrs already carry mtime/size). Returns the supported files found and
/// whether the walk covered everything — `false` when a safety cap was hit or
/// a subdirectory was unreadable, in which case the caller must NOT treat
/// unseen entries as deleted. readdir attrs are lstat-like, so symlinked
/// directories are never descended (no cycles).
pub fn walk(
    sftp: &Sftp,
    root: &str,
    is_supported: impl Fn(&Path) -> bool,
) -> Result<(Vec<RemoteEntry>, bool), ssh2::Error> {
    let root_path = PathBuf::from(root);
    let mut files = Vec::new();
    let mut queue: Vec<(PathBuf, usize)> = vec![(root_path.clone(), 0)];
    let mut complete = true;
    let mut seen = 0usize;

    while let Some((dir, depth)) = queue.pop() {
        let entries = match sftp.readdir(&dir) {
            Ok(v) => v,
            // The root must be readable; an unreadable subdir is skipped
            // (its known entries survive because complete turns false).
            Err(e) if dir == root_path => return Err(e),
            Err(_) => {
                complete = false;
                continue;
            }
        };
        for (path, stat) in entries {
            seen += 1;
            if seen > MAX_ENTRIES {
                complete = false;
                queue.clear();
                break;
            }
            if stat.is_dir() {
                if depth + 1 < MAX_DEPTH {
                    queue.push((path, depth + 1));
                } else {
                    complete = false;
                }
            } else if stat.is_file() && is_supported(&path) {
                files.push(RemoteEntry {
                    path: path.to_string_lossy().to_string(),
                    size: stat.size.unwrap_or(0) as i64,
                    modified: stat.mtime.unwrap_or(0) as i64,
                });
            }
        }
    }
    Ok((files, complete))
}

/// Read a remote file, capped at slightly over MAX_FILE_BYTES so callers can
/// detect (and reject) oversized files by length.
pub fn read_file(sftp: &Sftp, path: &str) -> Result<Vec<u8>, ssh2::Error> {
    let mut f = sftp.open(Path::new(path))?;
    let mut buf = Vec::new();
    f.by_ref()
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(io_to_ssh2)?;
    Ok(buf)
}

/// SFTP stat that answers "is this an existing directory?".
pub fn is_remote_dir(sftp: &Sftp, path: &str) -> Result<bool, ssh2::Error> {
    Ok(sftp.stat(Path::new(path))?.is_dir())
}

// ---- protocol server -------------------------------------------------------------

fn respond(
    status: u16,
    mime: Option<&str>,
    body: Vec<u8>,
    origin: Option<&str>,
) -> tauri::http::Response<Vec<u8>> {
    let mut b = tauri::http::Response::builder().status(status);
    if let Some(m) = mime {
        b = b.header("Content-Type", m);
    }
    // Echo the requesting origin so fetch() from the app can read responses.
    // Sandboxed iframes send Origin "null" and get no CORS access — the same
    // posture as the built-in asset protocol. Never use "*" here.
    if let Some(o) = origin.filter(|o| *o != "null") {
        b = b.header("Access-Control-Allow-Origin", o);
    }
    b.body(body).expect("static response parts are valid")
}

/// CORS preflight insurance (simple GETs don't preflight, but this is cheap).
pub fn preflight(origin: Option<&str>) -> tauri::http::Response<Vec<u8>> {
    let mut r = respond(204, None, Vec::new(), origin);
    r.headers_mut().insert(
        tauri::http::header::ACCESS_CONTROL_ALLOW_METHODS,
        tauri::http::HeaderValue::from_static("GET, OPTIONS"),
    );
    r
}

/// Handle one `remote://` request. Runs on a worker thread — every SFTP op in
/// here may block up to the op timeout.
pub fn serve(pool: &Pool, uri_path: &str, origin: Option<&str>) -> tauri::http::Response<Vec<u8>> {
    let Some((hostkey, path)) = parse_protocol_path(uri_path) else {
        return respond(400, None, Vec::new(), origin);
    };
    match pool.with_sftp(&hostkey, |sftp| read_file(sftp, &path)) {
        Ok(bytes) if bytes.len() as u64 > MAX_FILE_BYTES => respond(
            500,
            Some("text/plain"),
            "File is too large (50MB limit)".into(),
            origin,
        ),
        Ok(bytes) => {
            let mime = tauri::utils::mime_type::MimeType::parse(&bytes, &path);
            respond(200, Some(&mime), bytes, origin)
        }
        Err(RemoteError::NotFound) => respond(404, None, Vec::new(), origin),
        // 401 body carries the hostkey; the frontend prompts for a password.
        Err(RemoteError::PasswordRequired(hk)) => {
            respond(401, Some("text/plain"), hk.into_bytes(), origin)
        }
        Err(RemoteError::Unreachable(_)) => respond(502, None, Vec::new(), origin),
        Err(e) => respond(500, Some("text/plain"), e.to_command_error().into_bytes(), origin),
    }
}

// ---- tests ------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_sftp_url_forms() {
        assert_eq!(
            split_sftp_url("sftp://alice@build01:2222/data/reports"),
            Some(("alice@build01:2222".into(), "/data/reports".into()))
        );
        assert_eq!(
            split_sftp_url("sftp://myalias/home/me"),
            Some(("myalias".into(), "/home/me".into()))
        );
        assert_eq!(split_sftp_url("sftp://host"), Some(("host".into(), "/".into())));
        assert_eq!(split_sftp_url("sftp:///nohost"), None);
        assert_eq!(split_sftp_url("/local/path"), None);
    }

    #[test]
    fn parse_protocol_path_decodes() {
        assert_eq!(
            parse_protocol_path("/alice%40build01%3A2222/data/reports/index.html"),
            Some(("alice@build01:2222".into(), "/data/reports/index.html".into()))
        );
        // Spaces + Korean, encoded per segment.
        assert_eq!(
            parse_protocol_path("/a%40h/%EB%B3%B4%EA%B3%A0%EC%84%9C%201.html"),
            Some(("a@h".into(), "/보고서 1.html".into()))
        );
        assert_eq!(parse_protocol_path("/host"), Some(("host".into(), "/".into())));
        assert_eq!(parse_protocol_path("/"), None);
    }

    #[test]
    fn hostkey_parsing() {
        let t = parse_hostkey("alice@build01:2222");
        assert_eq!((t.user, t.host, t.port), (Some("alice"), "build01", Some(2222)));
        let t = parse_hostkey("build01");
        assert_eq!((t.user, t.host, t.port), (None, "build01", None));
        let t = parse_hostkey("alice@build01");
        assert_eq!((t.user, t.host, t.port), (Some("alice"), "build01", None));
        // Non-numeric suffix after ':' is not a port.
        let t = parse_hostkey("weird:name");
        assert_eq!((t.user, t.host, t.port), (None, "weird:name", None));
    }

    /// The frontend builds URLs as encode(hostkey) + path with each segment
    /// encoded — verify that round-trips through parse_protocol_path.
    #[test]
    fn frontend_encoding_round_trip() {
        use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
        let hostkey = "alice@build01:2222";
        let path = "/보고서 폴더/파일 #1.html";
        let enc = |s: &str| utf8_percent_encode(s, NON_ALPHANUMERIC).to_string();
        let url_path = format!(
            "/{}{}",
            enc(hostkey),
            path.split('/').map(enc).collect::<Vec<_>>().join("/")
        );
        assert_eq!(
            parse_protocol_path(&url_path),
            Some((hostkey.to_string(), path.to_string()))
        );
    }
}

import { useEffect, useState } from "react";
import * as api from "../api";
import { useDebounced } from "../hooks";
import { t } from "../i18n";
import type { ScanResult } from "../types";

type AuthMode = "auto" | "key" | "password";

interface Props {
  onAdded: (r: ScanResult) => void;
  onClose: () => void;
}

/** Longest common prefix, for shell-style partial tab completion. */
function commonPrefix(list: string[]): string {
  if (list.length === 0) return "";
  let p = list[0];
  for (const s of list) {
    while (!s.startsWith(p)) p = p.slice(0, -1);
  }
  return p;
}

/** Register a remote SSH/SFTP folder: target + path + auth method. */
export default function RemoteFolderModal({ onAdded, onClose }: Props) {
  const [target, setTarget] = useState("");
  const [path, setPath] = useState("");
  const [auth, setAuth] = useState<AuthMode>("auto");
  const [keyPath, setKeyPath] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  // Flipped when the server itself demands a password mid-flow.
  const [needPw, setNeedPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shell-style completion for the remote path: subdirectory suggestions,
  // Tab to complete, ↑↓ + Enter to pick.
  const [sug, setSug] = useState<string[]>([]);
  const [sugOpen, setSugOpen] = useState(false);
  const [sugIndex, setSugIndex] = useState(-1);
  const debouncedPath = useDebounced(path, 300);

  const askPw = auth === "password" || needPw;

  useEffect(() => {
    const t = target.trim();
    if (!t || !debouncedPath.startsWith("/")) {
      setSug([]);
      setSugOpen(false);
      return;
    }
    let cancelled = false;
    (async () => {
      // The password lives only in the pool — push the field's current value
      // there so completion can authenticate before the folder is added.
      if (askPw && password) await api.setRemotePassword(t, password);
      return api.listRemoteDirs(t, debouncedPath, auth, auth === "key" ? keyPath : null);
    })()
      .then((dirs) => {
        if (cancelled) return;
        setSug(dirs);
        setSugIndex(-1);
        setSugOpen(dirs.length > 0);
      })
      .catch((e) => {
        if (cancelled) return;
        setSug([]);
        setSugOpen(false);
        // Suggestions fail quietly (they're advisory), except when the server
        // tells us a password would help.
        if (String(e).startsWith("PASSWORD_REQUIRED:")) setNeedPw(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPath, target, auth, keyPath]);

  const completeTo = (s: string) => {
    setPath(s.endsWith("/") ? s : `${s}/`);
    setSugIndex(-1);
  };

  const onPathKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!sugOpen || sug.length === 0) return;
    if (e.key === "Tab") {
      e.preventDefault();
      if (sugIndex >= 0) return completeTo(sug[sugIndex]);
      if (sug.length === 1) return completeTo(sug[0]);
      const p = commonPrefix(sug);
      if (p.length > path.length) setPath(p);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSugIndex((i) => (i + 1) % sug.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSugIndex((i) => (i <= 0 ? sug.length - 1 : i - 1));
    } else if (e.key === "Enter" && sugIndex >= 0) {
      e.preventDefault();
      completeTo(sug[sugIndex]);
    } else if (e.key === "Escape") {
      // Close only the dropdown — not the modal.
      e.preventDefault();
      e.stopPropagation();
      setSugOpen(false);
      setSugIndex(-1);
    }
  };
  const ready =
    target.trim().length > 0 &&
    path.trim().length > 0 &&
    (auth !== "key" || !!keyPath) &&
    (!askPw || password.length > 0);

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      if (askPw && password) {
        await api.setRemotePassword(target.trim(), password);
      }
      const r = await api.addRemoteFolder(
        target.trim(),
        path.trim(),
        auth,
        auth === "key" ? keyPath : null,
      );
      onAdded(r);
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith("PASSWORD_REQUIRED:")) {
        setNeedPw(true);
        setError(t("remoteNeedsPassword"));
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{t("remoteModalTitle")}</span>
          <button className="mini-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-sub">{t("remoteModalSub")}</div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="form-field">
            <label className="form-label">{t("remoteTarget")}</label>
            <input
              className="form-input"
              autoFocus
              placeholder={t("remoteTargetPlaceholder")}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">{t("remotePath")}</label>
            <div className="suggest-wrap">
              <input
                className="form-input"
                placeholder="/home/user/reports"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={onPathKeyDown}
                onFocus={() => sug.length > 0 && setSugOpen(true)}
                onBlur={() => setTimeout(() => setSugOpen(false), 150)}
              />
              {sugOpen && (
                <ul className="suggest-list">
                  {sug.map((s, i) => (
                    <li
                      key={s}
                      className={`suggest-item ${i === sugIndex ? "active" : ""}`}
                      // mousedown (not click) so the input's blur doesn't
                      // close the list before the selection lands.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        completeTo(s);
                      }}
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="form-hint">{t("remotePathHint")}</div>
          </div>

          <div className="form-field">
            <label className="form-label">{t("remoteAuth")}</label>
            <div className="radio-row">
              {(
                [
                  ["auto", t("authAuto")],
                  ["key", t("authKey")],
                  ["password", t("authPassword")],
                ] as [AuthMode, string][]
              ).map(([mode, label]) => (
                <label key={mode} className="radio-opt">
                  <input
                    type="radio"
                    name="auth"
                    checked={auth === mode}
                    onChange={() => setAuth(mode)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {auth === "key" && (
            <div className="form-field">
              <button
                type="button"
                className="btn"
                onClick={async () => setKeyPath((await api.pickKeyFile()) ?? keyPath)}
              >
                {t("chooseKeyFile")}
              </button>
              {keyPath && <div className="form-hint">{keyPath}</div>}
            </div>
          )}

          {askPw && (
            <div className="form-field">
              <label className="form-label">{t("authPassword")}</label>
              <input
                className="form-input"
                type="password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {error && <div className="modal-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t("cancel")}
            </button>
            <button type="submit" className="btn primary" disabled={!ready || busy}>
              {busy ? t("connecting") : t("add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

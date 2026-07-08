import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath as openWithSystem } from "@tauri-apps/plugin-opener";
import type { DirCount, FileEntry, Folder, ScanResult, TagCount } from "./types";

export const listFolders = () => invoke<Folder[]>("list_folders");
export const addFolder = (path: string) => invoke<ScanResult>("add_folder", { path });
export const removeFolder = (id: number) => invoke<void>("remove_folder", { id });
export const rescan = () => invoke<ScanResult>("rescan");

export interface ListArgs {
  view: string;
  tag?: string | null;
  // Single-word key on purpose: Tauri expects camelCase arg keys, so a
  // snake_case key like `folder_path` would silently not bind.
  dir?: string | null;
  query?: string | null;
  sort?: string | null;
  ascending?: boolean;
  [key: string]: unknown;
}
export const listFiles = (args: ListArgs) => invoke<FileEntry[]>("list_files", args);
export const listDirs = () => invoke<DirCount[]>("list_dirs");

export const getFile = (id: number) => invoke<FileEntry | null>("get_file", { id });
export const openPath = (path: string) => invoke<FileEntry>("open_path", { path });
export const recordOpen = (id: number) => invoke<void>("record_open", { id });
export const setFavorite = (id: number, favorite: boolean) =>
  invoke<void>("set_favorite", { id, favorite });
export const listTags = () => invoke<TagCount[]>("list_tags");
export const setFileTags = (id: number, tags: string[]) =>
  invoke<void>("set_file_tags", { id, tags });

/** Remove a file's entry from the library index (does not delete the file). */
export const forgetFile = (id: number) => invoke<void>("forget_file", { id });

export const SFTP_PREFIX = "sftp://";
export const isRemotePath = (p: string) => p.startsWith(SFTP_PREFIX);

let remoteBase: string | null = null;

/**
 * URL the webview can use to load a file inside an <iframe>: local files via
 * the asset protocol, remote (sftp://) files via the remote:// SFTP proxy.
 * Remote URLs put the encoded hostkey in the first segment and keep real `/`
 * separators in the path (each segment encoded), so `<base href>` relative
 * resolution works inside remote documents.
 */
export const fileSrc = (path: string) => {
  if (!isRemotePath(path)) return convertFileSrc(path);
  // Platform-correct base: "remote://localhost/" (macOS/Linux) or
  // "http://remote.localhost/" (Windows), straight from tauri itself.
  remoteBase ??= convertFileSrc("", "remote");
  const rest = path.slice(SFTP_PREFIX.length);
  const slash = rest.indexOf("/");
  const target = slash < 0 ? rest : rest.slice(0, slash);
  const p = slash < 0 ? "/" : rest.slice(slash);
  return remoteBase + encodeURIComponent(target) + p.split("/").map(encodeURIComponent).join("/");
};

/** Register a remote SSH/SFTP folder and run its first scan. */
export const addRemoteFolder = (
  target: string,
  path: string,
  auth: string,
  keyPath: string | null,
) => invoke<ScanResult>("add_remote_folder", { target, path, auth, keyPath });

/** Cache a password for this app run only — never persisted. */
export const setRemotePassword = (hostkey: string, password: string) =>
  invoke<void>("set_remote_password", { hostkey, password });

/** Subdirectory suggestions for the remote-path input (tab completion). */
export const listRemoteDirs = (
  target: string,
  path: string,
  auth: string,
  keyPath: string | null,
) => invoke<string[]>("list_remote_dirs", { target, path, auth, keyPath });

/** Native picker for an SSH identity file (.pem 등) → absolute path (or null). */
export async function pickKeyFile(): Promise<string | null> {
  const res = await openDialog({
    multiple: false,
    filters: [
      { name: "SSH 키", extensions: ["pem", "key"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });
  return typeof res === "string" ? res : null;
}

/** Native folder picker → absolute path (or null if cancelled). */
export async function pickFolder(): Promise<string | null> {
  const res = await openDialog({ directory: true, multiple: false });
  return typeof res === "string" ? res : null;
}

/** Native file picker restricted to supported docs → absolute path (or null). */
export async function pickHtmlFile(): Promise<string | null> {
  const res = await openDialog({
    multiple: false,
    filters: [{ name: "문서", extensions: ["html", "htm", "md", "markdown", "mdown", "mkd"] }],
  });
  return typeof res === "string" ? res : null;
}

/** Open a file in the OS default app (i.e. the browser for .html). */
export const openInBrowser = (path: string) => openWithSystem(path);

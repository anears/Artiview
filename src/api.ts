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

/** URL the webview can use to load a local file inside an <iframe>. */
export const fileSrc = (path: string) => convertFileSrc(path);

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

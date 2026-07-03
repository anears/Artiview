// Mirror of the serde structs returned by the Rust backend (snake_case).

export interface Folder {
  id: number;
  path: string;
  added_at: number;
  file_count: number;
}

export interface FileEntry {
  id: number;
  path: string;
  name: string;
  title: string | null;
  heading: string | null;
  size: number;
  modified: number;
  created: number;
  favorite: boolean;
  last_opened: number | null;
  open_count: number;
  folder_id: number | null;
  missing: boolean;
  tags: string[];
}

export interface TagCount {
  name: string;
  count: number;
}

/** Direct file count for a directory (from the backend), used to build the tree. */
export interface DirCount {
  root_id: number;
  dir: string;
  count: number;
}

/** A node in the sidebar folder tree. */
export interface FolderNode {
  name: string;
  path: string;
  rootId: number;
  count: number; // recursive file count
  children: FolderNode[];
}

export interface ScanResult {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  /** Remote hostkeys that need a password before their folders can scan. */
  needs_auth: string[];
}

export type NavKind = "all" | "recent" | "favorites" | "folder" | "tag";

export interface Nav {
  kind: NavKind;
  folderPath?: string;
  tag?: string;
}

/** Best display name for a file: title → first heading → filename. */
export function displayName(f: FileEntry): string {
  return (f.title && f.title.trim()) || (f.heading && f.heading.trim()) || f.name;
}

/** Renderer kind derived from the file extension. */
export function fileKind(f: FileEntry): "html" | "md" {
  return /\.(md|markdown|mdown|mkd)$/i.test(f.path) ? "md" : "html";
}

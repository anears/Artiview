import type { DirCount, Folder, FolderNode } from "./types";
import { basename } from "./util";

const stripSlash = (p: string) => p.replace(/\/+$/, "");

/**
 * Build the sidebar folder tree from registered roots + per-directory counts.
 * Intermediate directories (that hold no files directly) are filled in, and
 * each node's `count` is the recursive number of files beneath it.
 */
export function buildFolderTree(folders: Folder[], dirs: DirCount[]): FolderNode[] {
  const roots: FolderNode[] = [];
  const byRoot = new Map<number, { root: FolderNode; nodes: Map<string, FolderNode> }>();

  for (const f of folders) {
    const path = stripSlash(f.path);
    const root: FolderNode = { name: basename(path), path, rootId: f.id, count: 0, children: [] };
    roots.push(root);
    byRoot.set(f.id, { root, nodes: new Map([[path, root]]) });
  }

  for (const d of dirs) {
    const entry = byRoot.get(d.root_id);
    if (!entry) continue;
    const { root, nodes } = entry;
    const dir = stripSlash(d.dir);

    root.count += d.count; // root is an ancestor of every dir under it
    if (dir === root.path || !dir.startsWith(root.path + "/")) continue;

    const segments = dir.slice(root.path.length + 1).split("/");
    let parent = root;
    let cur = root.path;
    for (const seg of segments) {
      cur = `${cur}/${seg}`;
      let node = nodes.get(cur);
      if (!node) {
        node = { name: seg, path: cur, rootId: d.root_id, count: 0, children: [] };
        nodes.set(cur, node);
        parent.children.push(node);
      }
      node.count += d.count;
      parent = node;
    }
  }

  const sortRec = (n: FolderNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortRec);
  return roots;
}

/** All ancestor paths of a directory up to (and including) a root. */
export function ancestorsWithin(rootPath: string, dir: string): string[] {
  const root = stripSlash(rootPath);
  const target = stripSlash(dir);
  if (target === root || !target.startsWith(root + "/")) return [root];
  const out = [root];
  let cur = root;
  for (const seg of target.slice(root.length + 1).split("/")) {
    cur = `${cur}/${seg}`;
    out.push(cur);
  }
  return out;
}

import type { ProjectEntry } from "@t3tools/contracts";

export interface FileTreeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: FileTreeNode[];
}

export interface FileTreeFileNode {
  kind: "file";
  name: string;
  path: string;
}

export type FileTreeNode = FileTreeDirectoryNode | FileTreeFileNode;

const SORT_LOCALE_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

function basenameOf(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, SORT_LOCALE_OPTIONS);
}

function compactDirectoryNode(node: FileTreeDirectoryNode): FileTreeDirectoryNode {
  const compactedChildren = node.children.map((child) =>
    child.kind === "directory" ? compactDirectoryNode(child) : child,
  );

  let compacted: FileTreeDirectoryNode = { ...node, children: compactedChildren };

  while (compacted.children.length === 1 && compacted.children[0]?.kind === "directory") {
    const onlyChild = compacted.children[0];
    compacted = {
      kind: "directory",
      name: `${compacted.name}/${onlyChild.name}`,
      path: onlyChild.path,
      children: onlyChild.children,
    };
  }

  return compacted;
}

export function buildFileTree(entries: ReadonlyArray<ProjectEntry>): FileTreeNode[] {
  // Group entries by parentPath
  const childrenByParent = new Map<string, ProjectEntry[]>();

  for (const entry of entries) {
    const parent = entry.parentPath ?? "";
    const siblings = childrenByParent.get(parent);
    if (siblings) {
      siblings.push(entry);
    } else {
      childrenByParent.set(parent, [entry]);
    }
  }

  function buildChildren(parentPath: string): FileTreeNode[] {
    const children = childrenByParent.get(parentPath) ?? [];

    const dirs: FileTreeDirectoryNode[] = [];
    const files: FileTreeFileNode[] = [];

    for (const entry of children) {
      if (entry.kind === "directory") {
        dirs.push({
          kind: "directory",
          name: basenameOf(entry.path),
          path: entry.path,
          children: buildChildren(entry.path),
        });
      } else {
        files.push({
          kind: "file",
          name: basenameOf(entry.path),
          path: entry.path,
        });
      }
    }

    const sortedDirs = dirs.toSorted(compareByName).map(compactDirectoryNode);
    const sortedFiles = files.toSorted(compareByName);

    return [...sortedDirs, ...sortedFiles];
  }

  return buildChildren("");
}

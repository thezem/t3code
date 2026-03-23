import { ChevronRightIcon, FolderIcon, FolderClosedIcon, PlusIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { cn } from "~/lib/utils";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import type { FileTreeNode } from "~/lib/buildFileTree";

interface FileExplorerTreeProps {
  nodes: FileTreeNode[];
  cwd: string;
  resolvedTheme: "light" | "dark";
  onFileClick: (path: string) => void;
  onMentionFile: (path: string) => void;
  onExpandDirectory?: (dirPath: string) => void;
  expandedDirs?: Set<string>;
  onToggleDirectory?: (dirPath: string) => void;
}

export const FileExplorerTree = memo(function FileExplorerTree({
  nodes,
  cwd: _cwd,
  resolvedTheme,
  onFileClick,
  onMentionFile,
  onExpandDirectory,
  expandedDirs = new Set(),
  onToggleDirectory,
}: FileExplorerTreeProps) {
  const toggleDirectory = useCallback(
    (path: string) => {
      const isCurrentlyExpanded = expandedDirs.has(path);
      if (!isCurrentlyExpanded && onExpandDirectory) {
        void onExpandDirectory(path);
      }
      if (onToggleDirectory) {
        onToggleDirectory(path);
      }
    },
    [expandedDirs, onExpandDirectory, onToggleDirectory],
  );

  const renderTreeNode = (node: FileTreeNode, depth: number): React.ReactNode => {
    const leftPadding = 8 + depth * 14;

    if (node.kind === "directory") {
      const isExpanded = expandedDirs.has(node.path);
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
                isExpanded && "rotate-90",
              )}
            />
            {isExpanded ? (
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            ) : (
              <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            )}
            <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
              {node.name}
            </span>
          </button>
          {isExpanded && (
            <div className="space-y-0.5">
              {node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={`file:${node.path}`}
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 hover:bg-background/80"
        style={{ paddingLeft: `${leftPadding}px` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span aria-hidden="true" className="size-3.5 shrink-0" />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => onFileClick(node.path)}
        >
          <VscodeEntryIcon
            pathValue={node.path}
            kind="file"
            theme={resolvedTheme}
            className="size-3.5 text-muted-foreground/70"
          />
          <span className="truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90">
            {node.name}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Mention ${node.name} in composer`}
          title="Insert @mention into composer"
          className="ml-auto hidden shrink-0 rounded p-0.5 text-muted-foreground/50 hover:bg-accent hover:text-foreground group-hover:inline-flex"
          onClick={(e) => {
            e.stopPropagation();
            onMentionFile(node.path);
          }}
        >
          <PlusIcon className="size-3" />
        </button>
      </div>
    );
  };

  return <div className="space-y-0.5">{nodes.map((node) => renderTreeNode(node, 0))}</div>;
});

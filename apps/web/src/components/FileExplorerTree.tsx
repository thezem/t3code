import { ChevronRightIcon, FolderIcon, FolderClosedIcon, PlusIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { cn } from "~/lib/utils";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { useFileExplorerExpanded } from "~/hooks/useFileExplorerExpanded";
import type { FileTreeNode } from "~/lib/buildFileTree";

interface FileExplorerTreeProps {
  nodes: FileTreeNode[];
  cwd: string;
  resolvedTheme: "light" | "dark";
  onFileClick: (path: string) => void;
  onMentionFile: (path: string) => void;
  onLazyLoadDirectory?: (path: string) => Promise<void>;
}

export const FileExplorerTree = memo(function FileExplorerTree({
  nodes,
  cwd,
  resolvedTheme,
  onFileClick,
  onMentionFile,
  onLazyLoadDirectory,
}: FileExplorerTreeProps) {
  // Use hook for persisted expansion state
  const { expanded: expandedDirectories, toggle } = useFileExplorerExpanded(cwd);

  const toggleDirectory = useCallback(
    (path: string) => {
      toggle(path);
    },
    [toggle],
  );

  const renderTreeNode = (node: FileTreeNode, depth: number): React.ReactNode => {
    const leftPadding = 8 + depth * 16;

    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? false;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full items-center gap-1 py-[3px] pr-2 text-left hover:bg-accent/50"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => {
              toggleDirectory(node.path);
              if (!isExpanded && onLazyLoadDirectory) {
                void onLazyLoadDirectory(node.path);
              }
            }}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-100 group-hover:text-foreground/70",
                isExpanded && "rotate-90",
              )}
            />
            {isExpanded ? (
              <FolderIcon className="size-4 shrink-0 text-muted-foreground/80" />
            ) : (
              <FolderClosedIcon className="size-4 shrink-0 text-muted-foreground/80" />
            )}
            <span className="truncate text-[13px] text-foreground/80 group-hover:text-foreground">
              {node.name}
            </span>
          </button>
          {isExpanded && (
            <div>{node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}</div>
          )}
        </div>
      );
    }

    return (
      <div
        key={`file:${node.path}`}
        className="group flex w-full items-center gap-1 py-[3px] pr-2 hover:bg-accent/50"
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
            className="size-4 shrink-0 text-muted-foreground/70"
          />
          <span className="truncate text-[13px] text-foreground/70 group-hover:text-foreground">
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

  return <div>{nodes.map((node) => renderTreeNode(node, 0))}</div>;
});

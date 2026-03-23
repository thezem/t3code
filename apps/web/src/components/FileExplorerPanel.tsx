import { RefreshCwIcon } from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectSearchEntriesQueryOptions, directoryEntriesQueryOptions } from "~/lib/projectReactQuery";
import { buildFileTree } from "~/lib/buildFileTree";
import { FileExplorerTree } from "./FileExplorerTree";
import { useTheme } from "~/hooks/useTheme";

interface FileExplorerPanelProps {
  cwd: string | null;
  onFileClick: (absolutePath: string) => void;
  onMentionFile: (relativePath: string) => void;
}

const FILE_EXPLORER_LIMIT = 200;
const INITIAL_MAX_DEPTH = 3;
const LAZY_LOAD_MAX_DEPTH = 3;

export function FileExplorerPanel({ cwd, onFileClick, onMentionFile }: FileExplorerPanelProps) {
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const [fetchedDirectories, setFetchedDirectories] = useState<Set<string>>(new Set());

  const queryOptions = projectSearchEntriesQueryOptions({
    cwd,
    query: "",
    limit: FILE_EXPLORER_LIMIT,
    // Note: Not limiting depth on initial query to ensure all files are visible
    // Lazy-loading handles additional entries if needed
    enabled: cwd !== null,
  });

  const { data, isLoading, isError } = useQuery(queryOptions);

  const treeNodes = useMemo(() => {
    if (!data?.entries) return [];
    return buildFileTree(data.entries);
  }, [data?.entries]);

  const handleLazyLoadDirectory = useCallback(
    async (dirPath: string) => {
      if (!cwd || fetchedDirectories.has(dirPath)) {
        return;
      }

      // Trigger lazy-load query
      // Use higher limit for lazy-loads to ensure we get all children
      const lazyLoadOptions = directoryEntriesQueryOptions({
        cwd,
        dirPath,
        // Don't limit depth for lazy-loads - we want all children of this directory
        maxDepth: undefined,
        limit: FILE_EXPLORER_LIMIT * 2,
      });

      const lazyLoadedData = await queryClient.fetchQuery(lazyLoadOptions);

      // Merge lazy-loaded entries into the main cache
      queryClient.setQueryData(queryOptions.queryKey, (oldData) => {
        if (!oldData) return oldData;
        // Combine entries, removing duplicates
        const existingPaths = new Set(oldData.entries.map((e) => e.path));
        const newEntries = lazyLoadedData.entries.filter((e) => !existingPaths.has(e.path));
        return {
          ...oldData,
          entries: [...oldData.entries, ...newEntries],
        };
      });

      // Mark as fetched
      setFetchedDirectories((prev) => new Set([...prev, dirPath]));
    },
    [cwd, fetchedDirectories, queryClient, queryOptions.queryKey],
  );

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
    setFetchedDirectories(new Set());
  };

  if (!cwd) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-muted-foreground/60">
        No active project.
        <br />
        Select a thread to browse its project files.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
        {/* future: search input */}
        <div className="flex-1" />
        {/* future: create file, collapse all */}
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Refresh file tree"
            title="Refresh"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            onClick={handleRefresh}
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {isLoading && (
          <div className="space-y-1 px-2 pt-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-5 animate-pulse rounded bg-muted/60"
                style={{ width: `${55 + (i % 5) * 8}%` }}
              />
            ))}
          </div>
        )}
        {isError && (
          <div className="px-3 py-4 text-center text-xs text-destructive/80">
            Failed to load project files.
          </div>
        )}
        {!isLoading && !isError && treeNodes.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground/60">
            No files found in this project.
          </div>
        )}
        {!isLoading && !isError && treeNodes.length > 0 && (
          <FileExplorerTree
            nodes={treeNodes}
            cwd={cwd}
            resolvedTheme={resolvedTheme}
            onFileClick={onFileClick}
            onMentionFile={onMentionFile}
            onLazyLoadDirectory={handleLazyLoadDirectory}
          />
        )}
      </div>
    </div>
  );
}

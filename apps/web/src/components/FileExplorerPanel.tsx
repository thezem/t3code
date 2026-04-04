import type { ProjectEntry } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFileExplorerStore } from "~/fileExplorerStore";
import {
  directoryEntriesQueryOptions,
  projectQueryKeys,
  projectSearchEntriesQueryOptions,
} from "~/lib/projectReactQuery";
import { buildFileTree, mergeProjectEntries } from "~/lib/buildFileTree";
import { FileExplorerTree } from "./FileExplorerTree";
import { useTheme } from "~/hooks/useTheme";

interface FileExplorerPanelProps {
  cwd: string | null;
  onFileClick: (absolutePath: string) => void;
  onMentionFile: (relativePath: string) => void;
}

const FILE_EXPLORER_LIMIT = 10_000;
const FILE_EXPLORER_INITIAL_MAX_DEPTH = 3;
const EMPTY_ENTRIES: ProjectEntry[] = [];
const EMPTY_EXPANDED_PATHS: string[] = [];

export function FileExplorerPanel({ cwd, onFileClick, onMentionFile }: FileExplorerPanelProps) {
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const toggleDirectory = useFileExplorerStore((state) => state.toggleDirectory);
  const expandedDirectoryPaths = useFileExplorerStore((state) =>
    cwd ? (state.expandedDirs[cwd] ?? EMPTY_EXPANDED_PATHS) : EMPTY_EXPANDED_PATHS,
  );
  const [lazyEntries, setLazyEntries] = useState<ProjectEntry[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, true>>({});
  const [loadedDirectories, setLoadedDirectories] = useState<Record<string, true>>({});

  const queryOptions = projectSearchEntriesQueryOptions({
    cwd,
    query: "",
    limit: FILE_EXPLORER_LIMIT,
    enabled: cwd !== null,
    maxDepth: FILE_EXPLORER_INITIAL_MAX_DEPTH,
  });

  const { data, isLoading, isError } = useQuery(queryOptions);

  const allEntries = useMemo(
    () => mergeProjectEntries(data?.entries ?? EMPTY_ENTRIES, lazyEntries),
    [data?.entries, lazyEntries],
  );

  const treeNodes = useMemo(() => {
    if (allEntries.length === 0) return [];
    return buildFileTree(allEntries);
  }, [allEntries]);

  const expandedDirectorySet = useMemo(
    () => new Set(expandedDirectoryPaths),
    [expandedDirectoryPaths],
  );

  useEffect(() => {
    setLazyEntries([]);
    setLoadingDirectories({});
    setLoadedDirectories({});
  }, [cwd]);

  const handleToggleDirectory = useCallback(
    (path: string, isExpanded: boolean) => {
      if (!cwd) {
        return;
      }

      toggleDirectory(cwd, path);

      if (isExpanded || loadedDirectories[path] || loadingDirectories[path]) {
        return;
      }

      setLoadingDirectories((current) => ({ ...current, [path]: true }));

      void queryClient
        .fetchQuery(
          directoryEntriesQueryOptions({
            cwd,
            dirPath: path,
            limit: FILE_EXPLORER_LIMIT,
          }),
        )
        .then((result) => {
          setLazyEntries((current) => mergeProjectEntries(current, result.entries));
          setLoadedDirectories((current) => {
            if (result.truncated) {
              return { ...current, [path]: true };
            }

            const next = { ...current };
            for (const entry of result.entries) {
              if (entry.kind === "directory") {
                next[entry.path] = true;
              }
            }
            return next;
          });
        })
        .catch((error) => {
          console.error("Failed to load directory entries:", error);
        })
        .finally(() => {
          setLoadingDirectories((current) => {
            const next = { ...current };
            delete next[path];
            return next;
          });
        });
    },
    [cwd, loadedDirectories, loadingDirectories, queryClient, toggleDirectory],
  );

  const handleRefresh = () => {
    setLazyEntries([]);
    setLoadingDirectories({});
    setLoadedDirectories({});
    void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
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
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {isLoading && (
          <div className="space-y-1 px-4 pt-2">
            {Array.from({ length: 8 }, (_, i) => `skeleton-loading-${i}`).map((key, i) => (
              <div
                key={key}
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
            resolvedTheme={resolvedTheme}
            expandedDirectoryPaths={expandedDirectorySet}
            onFileClick={onFileClick}
            onMentionFile={onMentionFile}
            onToggleDirectory={handleToggleDirectory}
          />
        )}
      </div>
    </div>
  );
}

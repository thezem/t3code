import type { ProjectSearchEntriesResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export function projectWriteFileMutationOptions() {
  return {
    mutationFn: async (input: { cwd: string; relativePath: string; contents: string }) => {
      const api = ensureNativeApi();
      return api.projects.writeFile(input);
    },
  };
}

export function projectReadFileQueryOptions(input: {
  cwd: string | null;
  relativePath: string | null;
}) {
  return queryOptions({
    queryKey: ["projects", "read-file", input.cwd, input.relativePath] as const,
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.relativePath) {
        throw new Error("Read file is unavailable.");
      }
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled: input.cwd !== null && input.relativePath !== null,
    staleTime: 5_000,
  });
}

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (cwd: string | null, query: string, limit: number) =>
    ["projects", "search-entries", cwd, query, limit] as const,
  directoryEntries: (cwd: string | null, dirPath: string, maxDepth?: number) =>
    ["projects", "directory-entries", cwd, dirPath, maxDepth] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
  maxDepth?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
        maxDepth: input.maxDepth,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function directoryEntriesQueryOptions(input: {
  cwd: string | null;
  dirPath: string;
  maxDepth?: number;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  const maxDepth = input.maxDepth ?? 3;
  return queryOptions({
    queryKey: projectQueryKeys.directoryEntries(input.cwd, input.dirPath, maxDepth),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Directory entry fetch is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.dirPath,
        limit,
        maxDepth,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

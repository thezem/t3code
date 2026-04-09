import type {
  EnvironmentId,
  ProjectListSkillsResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "~/environmentApi";

export function projectWriteFileMutationOptions() {
  return {
    mutationFn: async (input: {
      environmentId: EnvironmentId;
      cwd: string;
      relativePath: string;
      contents: string;
    }) => {
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.writeFile(input);
    },
  };
}

export function projectReadFileQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
}) {
  return queryOptions({
    queryKey: [
      "projects",
      "read-file",
      input.environmentId,
      input.cwd,
      input.relativePath,
    ] as const,
    queryFn: async () => {
      if (!input.environmentId || !input.cwd || !input.relativePath) {
        throw new Error("Read file is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled: input.environmentId !== null && input.cwd !== null && input.relativePath !== null,
    staleTime: 5_000,
  });
}

export const projectQueryKeys = {
  all: ["projects"] as const,
  skills: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["projects", "skills", environmentId, cwd] as const,
  searchEntries: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    query: string,
    limit: number,
    maxDepth?: number,
    rootPath?: string,
  ) =>
    [
      "projects",
      "search-entries",
      environmentId ?? null,
      cwd,
      query,
      limit,
      maxDepth,
      rootPath,
    ] as const,
  directoryEntries: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    dirPath: string,
    maxDepth?: number,
  ) => ["projects", "directory-entries", environmentId ?? null, cwd, dirPath, maxDepth] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_SKILLS_RESULT: ProjectListSkillsResult = {
  skills: [],
  issues: [],
};

export function projectSearchEntriesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  query: string;
  rootPath?: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
  maxDepth?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(
      input.environmentId,
      input.cwd,
      input.query,
      limit,
      input.maxDepth,
      input.rootPath,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Workspace entry search is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        rootPath: input.rootPath,
        limit,
        maxDepth: input.maxDepth,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function directoryEntriesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  dirPath: string;
  maxDepth?: number;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.directoryEntries(
      input.environmentId,
      input.cwd,
      input.dirPath,
      input.maxDepth,
    ),
    queryFn: async () => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Directory entry fetch is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: "",
        rootPath: input.dirPath,
        limit,
        maxDepth: input.maxDepth,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectSkillsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.skills(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Workspace skill lookup is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.listSkills({
        cwd: input.cwd,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? EMPTY_SKILLS_RESULT,
  });
}

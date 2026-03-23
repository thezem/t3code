import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface FileExplorerState {
  expandedDirs: Record<string, string[]>;
  toggleDirectory: (cwd: string, dirPath: string) => void;
  expandDirectory: (cwd: string, dirPath: string) => void;
  collapseDirectory: (cwd: string, dirPath: string) => void;
  setExpandedDirs: (cwd: string, dirPaths: string[]) => void;
}

const FILE_EXPLORER_STORAGE_KEY = "t3code:file-explorer-expanded:v1";

export const useFileExplorerStore = create<FileExplorerState>()(
  persist(
    (set) => ({
      expandedDirs: {},
      toggleDirectory: (cwd, dirPath) =>
        set((state) => {
          const expandedForCwd = state.expandedDirs[cwd] ?? [];
          const isExpanded = expandedForCwd.includes(dirPath);
          const nextExpanded = isExpanded
            ? expandedForCwd.filter((path) => path !== dirPath)
            : [...expandedForCwd, dirPath];
          return {
            expandedDirs: {
              ...state.expandedDirs,
              [cwd]: nextExpanded,
            },
          };
        }),
      expandDirectory: (cwd, dirPath) =>
        set((state) => {
          const expandedForCwd = state.expandedDirs[cwd] ?? [];
          if (expandedForCwd.includes(dirPath)) {
            return state;
          }
          return {
            expandedDirs: {
              ...state.expandedDirs,
              [cwd]: [...expandedForCwd, dirPath],
            },
          };
        }),
      collapseDirectory: (cwd, dirPath) =>
        set((state) => {
          const expandedForCwd = state.expandedDirs[cwd] ?? [];
          if (!expandedForCwd.includes(dirPath)) {
            return state;
          }
          return {
            expandedDirs: {
              ...state.expandedDirs,
              [cwd]: expandedForCwd.filter((path) => path !== dirPath),
            },
          };
        }),
      setExpandedDirs: (cwd, dirPaths) =>
        set((state) => ({
          expandedDirs: {
            ...state.expandedDirs,
            [cwd]: dirPaths,
          },
        })),
    }),
    {
      name: FILE_EXPLORER_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        expandedDirs: state.expandedDirs,
      }),
    },
  ),
);

import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

interface FileViewerState {
  open: boolean;
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
  openFile: (environmentId: EnvironmentId, cwd: string, relativePath: string) => void;
  close: () => void;
}

export const useFileViewerStore = create<FileViewerState>((set) => ({
  open: false,
  environmentId: null,
  cwd: null,
  relativePath: null,
  openFile: (environmentId, cwd, relativePath) =>
    set({ open: true, environmentId, cwd, relativePath }),
  close: () => set({ open: false }),
}));

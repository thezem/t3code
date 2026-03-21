import { create } from "zustand";

interface FileViewerState {
  open: boolean;
  cwd: string | null;
  relativePath: string | null;
  openFile: (cwd: string, relativePath: string) => void;
  close: () => void;
}

export const useFileViewerStore = create<FileViewerState>((set) => ({
  open: false,
  cwd: null,
  relativePath: null,
  openFile: (cwd, relativePath) => set({ open: true, cwd, relativePath }),
  close: () => set({ open: false }),
}));

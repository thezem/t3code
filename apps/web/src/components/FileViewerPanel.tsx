import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, XIcon } from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { projectReadFileQueryOptions, projectWriteFileMutationOptions } from "~/lib/projectReactQuery";
import { useFileViewerStore } from "~/fileViewerStore";
import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";

// ── Language detection ────────────────────────────────────────────────

function inferMonacoLanguage(relativePath: string): string {
  const dot = relativePath.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  const ext = relativePath.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
      return "html";
    case "md":
    case "mdx":
      return "markdown";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "sh":
    case "bash":
      return "shell";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}

// ── File content (editor) ─────────────────────────────────────────────

function FileContent({
  cwd,
  relativePath,
  monacoTheme,
  wordWrap,
  onToggleWordWrap,
}: {
  cwd: string;
  relativePath: string;
  monacoTheme: "vs-dark" | "vs";
  wordWrap: "on" | "off";
  onToggleWordWrap: () => void;
}) {
  const queryClient = useQueryClient();
  const language = inferMonacoLanguage(relativePath);
  const queryOptions = projectReadFileQueryOptions({ cwd, relativePath });

  const { data, isLoading, isError } = useQuery(queryOptions);

  // Local editor value — null means "not yet diverged from server content"
  const [editorValue, setEditorValue] = useState<string | null>(null);
  const isDirty = editorValue !== null && editorValue !== data?.contents;

  // Reset local state whenever the viewed file changes
  useEffect(() => {
    setEditorValue(null);
  }, [relativePath]);

  const saveMutation = useMutation(projectWriteFileMutationOptions());

  const handleSave = () => {
    if (!isDirty) return;
    saveMutation.mutate(
      { cwd, relativePath, contents: editorValue! },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
        },
      },
    );
  };

  // Keep refs to the latest callbacks so onMount bindings never capture stale closures.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const onToggleWordWrapRef = useRef(onToggleWordWrap);
  onToggleWordWrapRef.current = onToggleWordWrap;

  const handleEditorMount: OnMount = (editor, monaco) => {
    // Ctrl/Cmd+S → save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });
    // Alt+Z → toggle word wrap (matches VS Code's default)
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => {
      onToggleWordWrapRef.current();
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground/60">
        Failed to read file.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Dirty indicator bar + save button */}
      {isDirty && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border bg-muted/30 px-3 py-1">
          <span className="text-xs text-muted-foreground/70">Unsaved changes</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="inline-flex h-6 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveMutation.isPending ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              "Save"
            )}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <Editor
          language={language}
          theme={monacoTheme}
          value={editorValue ?? data.contents}
          onChange={(val) => setEditorValue(val ?? "")}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}

// ── Panel — fills the Sidebar container provided by FileViewerInlineSidebar ──

export function FileViewerPanel() {
  const { cwd, relativePath, close } = useFileViewerStore();
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";
  const [wordWrap, setWordWrap] = useState<"on" | "off">("off");
  const toggleWordWrap = () => setWordWrap((w) => (w === "off" ? "on" : "off"));

  if (!cwd || !relativePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-xs text-muted-foreground/50">
        No file selected.
      </div>
    );
  }

  const lastSlash = relativePath.lastIndexOf("/");
  const fileName = lastSlash !== -1 ? relativePath.slice(lastSlash + 1) : relativePath;
  const dirPath = lastSlash !== -1 ? relativePath.slice(0, lastSlash) : null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2.5 border-b border-border px-4",
          isElectron ? "drag-region h-[52px]" : "h-12",
        )}
      >
        <VscodeEntryIcon
          pathValue={relativePath}
          kind="file"
          theme={resolvedTheme}
          className="size-4 shrink-0 opacity-80"
        />

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate font-mono text-[13px] font-medium leading-tight text-foreground">
            {fileName}
          </span>
          {dirPath && (
            <span className="truncate font-mono text-[11px] leading-tight text-muted-foreground/50">
              {dirPath}
            </span>
          )}
        </div>

        {/* Word-wrap toggle — Alt+Z (matches VS Code) */}
        <button
          type="button"
          aria-label={wordWrap === "on" ? "Disable word wrap" : "Enable word wrap"}
          title={`Toggle word wrap (Alt+Z) — currently ${wordWrap === "on" ? "on" : "off"}`}
          onClick={toggleWordWrap}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-semibold transition-colors",
            wordWrap === "on"
              ? "bg-accent text-foreground"
              : "text-muted-foreground/60 hover:bg-accent hover:text-foreground",
          )}
        >
          ⏎
        </button>

        <button
          type="button"
          aria-label="Close file viewer"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          onClick={close}
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* Monaco editor */}
      <FileContent
        cwd={cwd}
        relativePath={relativePath}
        monacoTheme={monacoTheme}
        wordWrap={wordWrap}
        onToggleWordWrap={toggleWordWrap}
      />
    </div>
  );
}

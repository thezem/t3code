import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { XIcon } from "lucide-react";
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

function FileContent(props: {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  wordWrap: "on" | "off";
}) {
  const language = inferMonacoLanguage(props.relativePath);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground/60">
      <div className="max-w-sm space-y-2">
        <p>
          Inline file viewing is temporarily unavailable while the file read API is being migrated.
        </p>
        <p className="font-mono text-xs text-muted-foreground/50">
          {props.cwd}/{props.relativePath} ({language}, wrap {props.wordWrap})
        </p>
      </div>
    </div>
  );
}

// ── Panel — fills the Sidebar container provided by FileViewerInlineSidebar ──

export function FileViewerPanel() {
  const { environmentId, cwd, relativePath, close } = useFileViewerStore();
  const { resolvedTheme } = useTheme();
  const [wordWrap, setWordWrap] = useState<"on" | "off">("off");
  const toggleWordWrap = () => setWordWrap((w) => (w === "off" ? "on" : "off"));

  if (!environmentId || !cwd || !relativePath) {
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
        environmentId={environmentId}
        cwd={cwd}
        relativePath={relativePath}
        wordWrap={wordWrap}
      />
    </div>
  );
}

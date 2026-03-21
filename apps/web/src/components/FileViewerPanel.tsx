import { Suspense, use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon, XIcon } from "lucide-react";
import { getSharedHighlighter, type SupportedLanguages } from "@pierre/diffs";
import { projectReadFileQueryOptions } from "~/lib/projectReactQuery";
import { useFileViewerStore } from "~/fileViewerStore";
import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";

// ── Theme ─────────────────────────────────────────────────────────────
// Syntax token colors from One Dark Pro (dark mode) or pierre-light (light mode).
// The panel background/borders come from the app theme — not forced dark.

const FILE_VIEWER_DARK_THEME = "one-dark-pro" as const;
const FILE_VIEWER_LIGHT_THEME = "pierre-light" as const;
type FileViewerTheme = typeof FILE_VIEWER_DARK_THEME | typeof FILE_VIEWER_LIGHT_THEME;

function resolveFileViewerTheme(resolvedAppTheme: "light" | "dark"): FileViewerTheme {
  return resolvedAppTheme === "dark" ? FILE_VIEWER_DARK_THEME : FILE_VIEWER_LIGHT_THEME;
}

// ── Language detection ────────────────────────────────────────────────

function inferLanguage(relativePath: string): string {
  const dot = relativePath.lastIndexOf(".");
  return dot !== -1 ? relativePath.slice(dot + 1).toLowerCase() : "text";
}

// ── Shiki highlighter cache ───────────────────────────────────────────

const highlighterCache = new Map<string, Promise<any>>();

function getFileViewerHighlighter(language: string, theme: FileViewerTheme): Promise<any> {
  const key = `${language}:${theme}`;
  let cached = highlighterCache.get(key);
  if (!cached) {
    cached = getSharedHighlighter({
      themes: [theme],
      langs: [language as SupportedLanguages],
      preferredHighlighter: "shiki-js",
    }).catch(() => {
      highlighterCache.delete(key);
      if (language !== "text") return getFileViewerHighlighter("text", theme);
      throw new Error("Shiki init failed");
    });
    highlighterCache.set(key, cached);
  }
  return cached;
}

// ── Shiki code block ──────────────────────────────────────────────────

function ShikiCode({
  code,
  language,
  theme,
}: {
  code: string;
  language: string;
  theme: FileViewerTheme;
}) {
  const highlighter = use(getFileViewerHighlighter(language, theme));
  const html = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme });
    } catch {
      return highlighter.codeToHtml(code, { lang: "text", theme });
    }
  }, [highlighter, code, language, theme]);

  // file-viewer-shiki class triggers the CSS that strips the forced background
  return (
    <div
      className="file-viewer-shiki min-w-0 text-[13px] leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── File content loader ───────────────────────────────────────────────

function FileContent({
  cwd,
  relativePath,
  theme,
}: {
  cwd: string;
  relativePath: string;
  theme: FileViewerTheme;
}) {
  const language = inferLanguage(relativePath);
  const { data, isLoading, isError } = useQuery(
    projectReadFileQueryOptions({ cwd, relativePath }),
  );

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
    <div className="min-h-0 flex-1 overflow-auto">
      <Suspense
        fallback={
          <pre className="p-4 font-mono text-[13px] leading-relaxed text-foreground/80">
            {data.contents}
          </pre>
        }
      >
        <ShikiCode code={data.contents} language={language} theme={theme} />
      </Suspense>
    </div>
  );
}

// ── Panel — fills the Sidebar container provided by FileViewerInlineSidebar ──

export function FileViewerPanel() {
  const { cwd, relativePath, close } = useFileViewerStore();
  const { resolvedTheme } = useTheme();
  const theme = resolveFileViewerTheme(resolvedTheme);

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

        <button
          type="button"
          aria-label="Close file viewer"
          className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          onClick={close}
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* Code content */}
      <FileContent cwd={cwd} relativePath={relativePath} theme={theme} />
    </div>
  );
}

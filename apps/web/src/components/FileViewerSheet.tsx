import { Suspense, use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectReadFileQueryOptions } from "~/lib/projectReactQuery";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName, type DiffThemeName } from "~/lib/diffRendering";
import {
  Sheet,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetPanel,
} from "~/components/ui/sheet";
import { getSharedHighlighter, type SupportedLanguages } from "@pierre/diffs";
import { Loader2Icon } from "lucide-react";

// ── Language inference ───────────────────────────────────────────────

function inferLanguageFromPath(relativePath: string): string {
  const ext = relativePath.slice(relativePath.lastIndexOf(".") + 1).toLowerCase();
  return ext || "text";
}

// ── Shiki highlighting (mirrors SuspenseShikiCodeBlock in ChatMarkdown) ──

const highlighterPromiseCache = new Map<string, Promise<any>>();

function getHighlighterPromise(language: string): Promise<any> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;
  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch(() => {
    highlighterPromiseCache.delete(language);
    return language === "text"
      ? Promise.reject(new Error("Shiki failed to init"))
      : getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

function ShikiFileContent({
  code,
  language,
  themeName,
}: {
  code: string;
  language: string;
  themeName: DiffThemeName;
}) {
  const highlighter = use(getHighlighterPromise(language));
  const html = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch {
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [highlighter, code, language, themeName]);

  return (
    <div
      className="chat-markdown-shiki overflow-x-auto text-[12px]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── File content loader ──────────────────────────────────────────────

function FileContentBody({
  cwd,
  relativePath,
  themeName,
}: {
  cwd: string;
  relativePath: string;
  themeName: DiffThemeName;
}) {
  const language = inferLanguageFromPath(relativePath);
  const { data, isLoading, isError } = useQuery(
    projectReadFileQueryOptions({ cwd, relativePath }),
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="px-4 py-8 text-center text-sm text-destructive/80">
        Failed to read file contents.
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <pre className="overflow-x-auto p-4 font-mono text-xs">{data.contents}</pre>
      }
    >
      <ShikiFileContent
        code={data.contents}
        language={language}
        themeName={themeName}
      />
    </Suspense>
  );
}

// ── Public component ─────────────────────────────────────────────────

interface FileViewerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cwd: string;
  relativePath: string | null;
}

export function FileViewerSheet({
  open,
  onOpenChange,
  cwd,
  relativePath,
}: FileViewerSheetProps) {
  const { resolvedTheme } = useTheme();
  const themeName = resolveDiffThemeName(resolvedTheme);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right" className="max-w-2xl">
        <SheetHeader>
          <SheetTitle className="truncate font-mono text-sm font-normal">
            {relativePath ?? ""}
          </SheetTitle>
          {/* future: toolbar — open in editor, copy, edit mode */}
        </SheetHeader>
        <SheetPanel scrollFade={false}>
          {relativePath && (
            <FileContentBody
              cwd={cwd}
              relativePath={relativePath}
              themeName={themeName}
            />
          )}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

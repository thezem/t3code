import type { EnvironmentId } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";

interface FileExplorerPanelProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  onFileClick: (absolutePath: string) => void;
  onMentionPath: (relativePath: string) => void;
}

export function FileExplorerPanel({
  environmentId,
  cwd,
  onFileClick: _onFileClick,
  onMentionPath: _onMentionPath,
}: FileExplorerPanelProps) {
  const explorerStatus = useMemo(() => {
    if (!environmentId || !cwd) {
      return "No active project.";
    }
    return "File explorer is temporarily unavailable while the project file APIs are being migrated.";
  }, [cwd, environmentId]);

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
            title="Refresh unavailable"
            disabled
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/40"
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="px-3 py-4 text-center text-xs text-muted-foreground/60">
          {explorerStatus}
          {environmentId && cwd ? (
            <>
              <br />
              Browse files from the chat or sidebar until the explorer query surface returns.
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

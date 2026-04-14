import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { isElectron } from "../../env";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";

export function SidebarBrowserPill() {
  if (!isElectron) {
    return null;
  }

  const [browserUrl, setBrowserUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const bridge = window.desktopBridge;
    if (!bridge) {
      setBrowserUrl(null);
      return;
    }

    void bridge
      .getServerExposureState()
      .then((state) => {
        if (!disposed) {
          setBrowserUrl(state.endpointUrl);
        }
      })
      .catch(() => {
        if (!disposed) {
          setBrowserUrl(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  if (!browserUrl) {
    return null;
  }

  const parsedBrowserUrl = new URL(browserUrl);
  const browserHost = parsedBrowserUrl.host;
  const browserPort = parsedBrowserUrl.port || "80";

  const handleOpenBrowser = () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    void bridge.openExternal(browserUrl).then((opened) => {
      if (opened) return;
      toastManager.add({
        type: "error",
        title: "Could not open browser",
        description: `Open ${browserUrl} manually.`,
      });
    });
  };

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/35 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
          <GlobeIcon className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/65">
            Browser access
          </p>
          <p className="truncate text-xs font-medium text-foreground">{browserHost}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Listening on 0.0.0.0:{browserPort}
          </p>
        </div>
      </div>
      <Button
        size="xs"
        variant="outline"
        className="shrink-0"
        onClick={handleOpenBrowser}
        aria-label={`Open ${browserHost} in your browser`}
      >
        <ExternalLinkIcon className="size-3.5" />
        Open
      </Button>
    </div>
  );
}

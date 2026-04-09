import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  Suspense,
  lazy,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import ChatView from "../components/ChatView";
import { FileExplorerPanel } from "../components/FileExplorerPanel";
import { FileViewerPanel } from "../components/FileViewerPanel";
import { useFileViewerStore } from "../fileViewerStore";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { selectEnvironmentState, selectThreadByRef, useStore } from "../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { Schema } from "effect";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const FILE_VIEWER_DEFAULT_WIDTH = 420;
const FILE_VIEWER_MIN_WIDTH = 280;
const FILE_VIEWER_MAX_WIDTH_VW_RATIO = 0.5;
const FILE_VIEWER_WIDTH_STORAGE_KEY = "chat_file_viewer_width";
const FILE_EXPLORER_DEFAULT_WIDTH = 320;
const FILE_EXPLORER_MIN_WIDTH = 260;
const FILE_EXPLORER_MAX_WIDTH_VW_RATIO = 0.4;
const FILE_EXPLORER_WIDTH_STORAGE_KEY = "chat_file_explorer_width";
const FILE_EXPLORER_OPEN_STORAGE_KEY = "chat_file_explorer_open";
const MOBILE_LAYOUT_MEDIA_QUERY = "(max-width: 767px)";

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-205 p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

const FileViewerResizablePanel = () => {
  const { open } = useFileViewerStore();
  const isMobile = useMediaQuery(MOBILE_LAYOUT_MEDIA_QUERY);
  const [width, setWidth] = useState(
    () =>
      getLocalStorageItem(FILE_VIEWER_WIDTH_STORAGE_KEY, Schema.Finite) ??
      FILE_VIEWER_DEFAULT_WIDTH,
  );
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!open || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const outer = outerRef.current;
      if (!outer) return;
      const currentWidth = outer.getBoundingClientRect().width;
      outer.style.transitionDuration = "0ms";
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startWidth: currentWidth,
        currentWidth,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [open],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const delta = drag.startX - e.clientX;
    const maxWidth = window.innerWidth * FILE_VIEWER_MAX_WIDTH_VW_RATIO;
    const nextWidth = Math.max(FILE_VIEWER_MIN_WIDTH, Math.min(maxWidth, drag.startWidth + delta));
    drag.currentWidth = nextWidth;
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (outer) outer.style.width = `${nextWidth}px`;
    if (inner) {
      inner.style.width = `${nextWidth}px`;
      inner.style.minWidth = `${nextWidth}px`;
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const finalWidth = drag.currentWidth;
    dragRef.current = null;
    const outer = outerRef.current;
    if (outer) outer.style.transitionDuration = "";
    setWidth(finalWidth);
    setLocalStorageItem(FILE_VIEWER_WIDTH_STORAGE_KEY, finalWidth, Schema.Finite);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  if (isMobile) {
    return null;
  }

  return (
    <div
      ref={outerRef}
      className="relative flex-none h-dvh overflow-hidden border-l border-border bg-card text-foreground transition-[width] duration-200 ease-linear"
      style={{ width: open ? width : 0 }}
    >
      <div ref={innerRef} className="h-full" style={{ width, minWidth: width }}>
        <FileViewerPanel />
      </div>
      {/* Drag-to-resize handle on the left edge */}
      <div
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize z-10 hover:bg-border/60 transition-colors"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
};

const FileExplorerResizablePanel = (props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) => {
  const { environmentId, threadId } = props;
  const isMobile = useMediaQuery(MOBILE_LAYOUT_MEDIA_QUERY);
  const threadRef = useMemo(() => ({ environmentId, threadId }), [environmentId, threadId]);
  const thread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const openFile = useFileViewerStore((store) => store.openFile);
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const [width, setWidth] = useState(
    () =>
      getLocalStorageItem(FILE_EXPLORER_WIDTH_STORAGE_KEY, Schema.Finite) ??
      FILE_EXPLORER_DEFAULT_WIDTH,
  );
  const [isOpen, setIsOpen] = useState(
    () => getLocalStorageItem(FILE_EXPLORER_OPEN_STORAGE_KEY, Schema.Boolean) ?? true,
  );
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);
  const activeProjectRef = useMemo(
    () =>
      thread
        ? { environmentId: thread.environmentId, projectId: thread.projectId }
        : draftThread
          ? { environmentId: draftThread.environmentId, projectId: draftThread.projectId }
          : null,
    [draftThread, thread],
  );
  const activeProject = useStore(
    useMemo(() => createProjectSelectorByRef(activeProjectRef), [activeProjectRef]),
  );
  const activeProjectCwd = activeProject?.cwd ?? null;

  const handleFileClick = useCallback(
    (relativePath: string) => {
      if (activeProject?.environmentId && activeProjectCwd) {
        openFile(activeProject.environmentId, activeProjectCwd, relativePath);
      }
    },
    [activeProject?.environmentId, activeProjectCwd, openFile],
  );

  const handleMentionPath = useCallback(
    (relativePath: string) => {
      const currentPrompt = getComposerDraft(threadRef)?.prompt ?? "";
      const mention = `@${relativePath}`;
      const separator = currentPrompt.length > 0 && !currentPrompt.endsWith(" ") ? " " : "";
      setPrompt(threadRef, `${currentPrompt}${separator}${mention} `);
    },
    [getComposerDraft, setPrompt, threadRef],
  );

  const handleToggleOpen = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      setLocalStorageItem(FILE_EXPLORER_OPEN_STORAGE_KEY, next, Schema.Boolean);
      return next;
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const outer = outerRef.current;
    if (!outer) return;
    const currentWidth = outer.getBoundingClientRect().width;
    outer.style.transitionDuration = "0ms";
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: currentWidth,
      currentWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const delta = drag.startX - e.clientX;
    const maxWidth = window.innerWidth * FILE_EXPLORER_MAX_WIDTH_VW_RATIO;
    const nextWidth = Math.max(
      FILE_EXPLORER_MIN_WIDTH,
      Math.min(maxWidth, drag.startWidth + delta),
    );
    drag.currentWidth = nextWidth;
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (outer) outer.style.width = `${nextWidth}px`;
    if (inner) {
      inner.style.width = `${nextWidth}px`;
      inner.style.minWidth = `${nextWidth}px`;
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const finalWidth = drag.currentWidth;
    dragRef.current = null;
    const outer = outerRef.current;
    if (outer) outer.style.transitionDuration = "";
    setWidth(finalWidth);
    setLocalStorageItem(FILE_EXPLORER_WIDTH_STORAGE_KEY, finalWidth, Schema.Finite);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  if (isMobile) {
    return null;
  }

  if (!isOpen) {
    return (
      <div className="relative flex h-dvh flex-none flex-col items-center justify-center border-l border-border bg-card text-foreground w-12">
        <button
          type="button"
          aria-label="Show file explorer"
          title="Show file explorer"
          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          onClick={handleToggleOpen}
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={outerRef}
      className="relative flex h-dvh flex-none overflow-hidden border-l border-border bg-card text-foreground transition-[width] duration-200 ease-linear"
      style={{ width }}
    >
      <div ref={innerRef} className="h-full" style={{ width, minWidth: width }}>
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Files
            </span>
            <button
              type="button"
              aria-label="Hide file explorer"
              title="Hide file explorer"
              className="inline-flex items-center justify-center rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              onClick={handleToggleOpen}
            >
              <ChevronLeftIcon className="size-3.5" />
            </button>
          </div>
          <FileExplorerPanel
            environmentId={activeProject?.environmentId ?? null}
            cwd={activeProjectCwd}
            onFileClick={handleFileClick}
            onMentionPath={handleMentionPath}
          />
        </div>
      </div>
      <div
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-border/60 transition-colors"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
};

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadByRef(store, threadRef) !== undefined);
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const diffOpen = search.diff === "1";
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  const [hasOpenedDiff, setHasOpenedDiff] = useState(diffOpen);
  const closeDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: { diff: undefined },
    });
  }, [navigate, threadRef]);
  const openDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [navigate, threadRef]);

  useEffect(() => {
    if (diffOpen) {
      setHasOpenedDiff(true);
    }
  }, [diffOpen]);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            routeKind="server"
          />
        </SidebarInset>
        <FileViewerResizablePanel />
        <FileExplorerResizablePanel
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
        />
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
      <FileViewerResizablePanel />
      <FileExplorerResizablePanel
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
      />
      <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </DiffPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});

# File Explorer Implementation — Session Notes

## What Was Built

A **File Explorer** feature added to the left sidebar, with:
- A **Files tab** alongside the existing Threads tab
- A file tree (expandable dirs, VSCode-style icons)
- A **File Viewer panel** that opens inline between the sidebar and the chat area
- Drag-to-resize on the file viewer panel
- A `[+]` button on each file to insert `@filepath` mentions into the composer

---

## Files Changed

### Backend / Contracts

**`packages/contracts/src/project.ts`**
- Changed `ProjectSearchEntriesInput.query` from `TrimmedNonEmptyString` → `Schema.Trim` (allows empty string to list all files)
- Added `ProjectReadFileInput` and `ProjectReadFileResult` schemas

**`packages/contracts/src/ws.ts`**
- Added `projectsReadFile: "projects.readFile"` to `WS_METHODS`
- Added it to the request body union

**`packages/contracts/src/ipc.ts`**
- Added `readFile` to `NativeApi.projects` interface

**`apps/server/src/wsServer.ts`**
- Added handler for `projectsReadFile` using `resolveWorkspaceWritePath` (path traversal guard) + `fileSystem.readFileString`

### Web App — Data Layer

**`apps/web/src/wsNativeApi.ts`**
- Added `readFile` to `projects`

**`apps/web/src/lib/projectReactQuery.ts`**
- Removed `&& input.query.length > 0` guard (file listing needs empty query)
- Added `projectReadFileQueryOptions`

**`apps/web/src/fileViewerStore.ts`** *(new)*
- Zustand store: `open`, `cwd`, `relativePath`, `openFile(cwd, path)`, `close()`

**`apps/web/src/composerDraftStore.ts`**
- Added `appendMentionToPrompt(threadId, relativePath)` — appends ` @path ` to current draft

### Web App — UI

**`apps/web/src/lib/buildFileTree.ts`** *(new)*
- Converts flat `ProjectEntry[]` to a nested tree, with compact single-child directory chains

**`apps/web/src/components/FileExplorerTree.tsx`** *(new)*
- Recursive tree renderer: expand/collapse dirs, VSCode icons, hover `[+]` mention button

**`apps/web/src/components/FileExplorerPanel.tsx`** *(new)*
- Wraps the tree with refresh button, loading skeletons, empty/error states
- Queries with `projectSearchEntriesQueryOptions({ cwd, query: "", limit: 200 })`

**`apps/web/src/components/FileViewerPanel.tsx`** *(new)*
- Renders file content with Shiki syntax highlighting
- Theme: `one-dark-pro` token colors on app-theme background (no forced dark bg)
- Uses `file-viewer-shiki` CSS class to strip Shiki's inline `background-color`

**`apps/web/src/components/Sidebar.tsx`**
- Added Threads / Files tab bar with `useLocalStorage` persistence
- File click calls `useFileViewerStore().openFile(cwd, path)`
- Added `cn` to utils import (was missing, caused a runtime error)

**`apps/web/src/index.css`**
```css
.file-viewer-shiki .shiki { background: transparent !important; }
.file-viewer-shiki pre.shiki { padding: 1rem; margin: 0; }
```

**`apps/web/src/routes/_chat.$threadId.tsx`**
- Added `FileViewerResizablePanel` component (see below)
- Placed as a flex sibling before `<SidebarInset>` in both render paths

---

## The Layout Problem (and Fix)

### Problem
The first attempt used `SidebarProvider + Sidebar side="left" collapsible="offcanvas"` — the same pattern as the diff panel on the right.

This broke because the Shadcn `Sidebar` component renders its panel as `position: fixed; left: 0`. Every `side="left"` sidebar anchors to the same viewport edge. The file viewer was **covering the app sidebar** entirely.

The diff panel works with `side="right"` because it anchors to a different edge (`right: 0`), so there's no conflict.

### Fix
Replaced the `SidebarProvider + Sidebar` with a plain **inline-flow resizable div** (`FileViewerResizablePanel`) that lives in normal document flow:

```
Parent flex row:
  [App Sidebar gap div]      ← normal flow, creates sidebar space
  [FileViewerResizablePanel] ← normal flow, width: 0 or Xpx
  [SidebarInset flex-1]      ← chat view, fills remaining space
  [DiffPanelInlineSidebar]   ← SidebarProvider side="right", fixed right:0
```

**How the resize works:**
- `pointerdown` on right-edge handle → capture pointer, record `startX` + `startWidth`, disable CSS transition
- `pointermove` → directly set `outer.style.width` and `inner.style.width` (DOM, no React re-render)
- `pointerup` → re-enable transition, call `setWidth(finalWidth)`, persist to `localStorage`

**Open/close animation:**
- Outer div: `transition-[width] duration-200` — transitions between `0` and `Xpx`
- Inner div: stays at full `width`/`minWidth` so content doesn't reflow during close animation

---

## Key Challenges

| Challenge | Fix |
|-----------|-----|
| Empty query rejected by contract | Changed `query` schema from `TrimmedNonEmptyString` → `Schema.Trim` |
| `cn is not defined` in Sidebar.tsx | Added `cn` to the import from `../lib/utils` |
| One Dark Pro forced dark background | CSS override: `.file-viewer-shiki .shiki { background: transparent !important }` |
| File viewer covered the app sidebar | Replaced fixed-position `Sidebar side="left"` with a plain inline-flow resizable div |
| Resize state in pointer handlers | Used refs (`dragRef`, `outerRef`, `innerRef`) — no stale closure issues |

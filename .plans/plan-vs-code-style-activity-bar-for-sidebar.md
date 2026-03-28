# Plan: VS Code-Style Activity Bar for Sidebar

## Context
The sidebar currently shows "Threads" and "Files" as a horizontal text tab bar below the logo header. The goal is to replace this with a narrow vertical activity bar (like VS Code's) — icon-only buttons with tooltips, stacked on the left side of the sidebar. Settings moves from a footer into the activity bar bottom. Names become tooltips.

## Single File to Modify
`apps/web/src/components/Sidebar.tsx`

---

## Changes

### 1 — Add icon imports (top of file)
Add `FilesIcon` and `MessagesSquareIcon` to the existing lucide-react import block:
```typescript
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ChevronRightIcon,
  FilesIcon,           // NEW
  FolderIcon,
  GitPullRequestIcon,
  MessagesSquareIcon,  // NEW
  PlusIcon,
  RocketIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
```

---

### 2 — Remove the horizontal tab bar (lines 1702–1728)
Delete the entire `{/* Tab bar */}` div block.

---

### 3 — Wrap content in activity bar + panel layout (lines 1730–1908)
Replace the current conditional `{sidebarTab === "files" ? ... : ...}` block with a `flex` row wrapper containing:
- Left: narrow activity bar (`w-11`, `44px`)
- Right: existing `SidebarContent` (unchanged inner content)

```tsx
{/* Activity bar + content panel */}
<div className="flex min-h-0 flex-1">

  {/* Activity Bar */}
  <div className="flex w-11 shrink-0 flex-col items-center border-r border-border/60 py-1">

    {/* Nav items */}
    <div className="flex flex-col items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Threads"
              className={cn(
                "flex size-9 items-center justify-center rounded-md transition-colors",
                sidebarTab === "threads"
                  ? "text-foreground border-l-2 border-foreground/70"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setSidebarTab("threads")}
            >
              <MessagesSquareIcon className="size-4" />
            </button>
          }
        />
        <TooltipPopup side="right">Threads</TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Files"
              className={cn(
                "flex size-9 items-center justify-center rounded-md transition-colors",
                sidebarTab === "files"
                  ? "text-foreground border-l-2 border-foreground/70"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setSidebarTab("files")}
            >
              <FilesIcon className="size-4" />
            </button>
          }
        />
        <TooltipPopup side="right">Files</TooltipPopup>
      </Tooltip>
    </div>

    {/* Push settings to bottom */}
    <div className="flex-1" />

    {/* Settings / Back */}
    <div className="pb-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={isOnSettings ? "Back" : "Settings"}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              onClick={
                isOnSettings
                  ? () => window.history.back()
                  : () => void navigate({ to: "/settings" })
              }
            >
              {isOnSettings ? (
                <ArrowLeftIcon className="size-4" />
              ) : (
                <SettingsIcon className="size-4" />
              )}
            </button>
          }
        />
        <TooltipPopup side="right">
          {isOnSettings ? "Back" : "Settings"}
        </TooltipPopup>
      </Tooltip>
    </div>
  </div>

  {/* Content panel — existing content, unchanged */}
  {sidebarTab === "files" ? (
    <SidebarContent className="gap-0">
      <FileExplorerPanel
        cwd={activeProjectCwd}
        onFileClick={handleFileClick}
        onMentionFile={handleMentionFile}
      />
    </SidebarContent>
  ) : (
    <SidebarContent className="gap-0">
      {/* ...all existing threads/projects JSX verbatim... */}
    </SidebarContent>
  )}
</div>
```

> **Note:** The `TooltipTrigger` pattern used in this file puts the icon *inside* the `render` prop button (not as a child of `TooltipTrigger`). See line 1678–1689 (RocketIcon pattern) for reference.

---

### 4 — Remove `SidebarSeparator` and `SidebarFooter` (lines 1910–1935)
Delete both — settings/back has moved into the activity bar bottom.

---

## Visual Result

```
┌──────────────────────────────────────┐
│  SidebarHeader (logo, drag region)   │  ← unchanged
├──────┬───────────────────────────────┤
│  [T] │                               │  ← MessagesSquare icon (Threads)
│  [F] │   Content panel               │  ← Files icon
│      │   (threads list or file tree) │
│      │                               │
│      │                               │
│  [⚙] │                               │  ← Settings icon at bottom
└──────┴───────────────────────────────┘
```

Active icon: `text-foreground border-l-2 border-foreground/70`
Inactive icon: `text-muted-foreground hover:text-foreground`
Tooltips: appear on `side="right"` with name label

---

## Verification
1. `bun run dev:web` — visually check the activity bar renders correctly
2. Click Threads icon → threads list shows, icon gets left accent border
3. Click Files icon → file explorer shows, icon gets left accent border
4. Click Settings icon → navigates to settings, icon becomes ArrowLeft "Back"
5. Click Back icon → goes back, icon reverts to Settings
6. Hover each icon → tooltip appears to the right with correct label
7. `bun run typecheck` — 0 errors
8. `bun lint` — 0 errors

# File Explorer Issues - Implementation Plan

## Context

The file explorer in T3Code has three related issues:

1. **Limited file visibility**: Only ~80-200 files are shown, so deeper nested directories and their contents don't appear in the tree
2. **Default expansion**: All root-level directories start expanded by default when the panel loads
3. **State not persisting**: When switching between "threads" and "files" tabs, the directory expansion state resets because it's stored in component-level `useState` that gets unmounted on tab switch

These issues stem from:

- Low default query limit (80 entries from `DEFAULT_SEARCH_ENTRIES_LIMIT`)
- Directory expansion state managed in `FileExplorerTree` component-level state (ephemeral)
- Tree unmounting on sidebar tab changes, resetting expansions to defaults

## Solution Overview

### 1. Implement Smart Lazy-Loading with Depth-Based Fetching (Depth Issue)

**Files to modify:**

- `apps/server/src/workspaceEntries.ts` (add optional maxDepth parameter)
- `packages/contracts/src/project.ts` (add maxDepth to ProjectSearchEntriesInput)
- `apps/web/src/lib/projectReactQuery.ts` (add new query variant for lazy-loading)
- `apps/web/src/components/FileExplorerPanel.tsx` (implement fetch strategy)
- `apps/web/src/components/FileExplorerTree.tsx` (trigger lazy-load on expand)

**Strategy:**

1. **Initial load**: Fetch root directories + all files up to depth 2-3
   - Server query with `maxDepth: 2` or `3` limits results to first few levels
   - Ensures users see immediate structure without huge initial fetch

2. **Lazy-loading**: Track which directories have been fetched
   - When user expands a directory that hasn't been fetched yet, trigger new query for that subtree
   - Query only from that directory downward to limit scope
   - Cache results in React Query

3. **Caching**: Leverage React Query's built-in caching
   - Query key includes the directory path: `['fileEntries', cwd, dirPath]`
   - 15-second stale time (existing default) prevents excessive refetches

**Why:** Balances UX (complete initial view of shallow directories) with performance (efficient lazy-loading for deep nesting). Users see all important structure immediately, drill down only as needed.

---

### 2. Persist Directory Expansion State (State Loss Issue)

**Files to modify:**

- `apps/web/src/components/FileExplorerTree.tsx` (refactor state management)
- `apps/web/src/components/FileExplorerPanel.tsx` (connect to persistence)
- Create `apps/web/src/fileExplorerStore.ts` for persisted expansion state

**Changes:**

- Move `expandedDirectories` state from local component `useState` to a new Zustand store (`fileExplorerStore.ts`)
- Add localStorage persistence with `t3code:file-explorer-expanded:v1` key
- Store structure: `Record<projectCwd, Set<dirPath>>` - tracks which directories are expanded per project
- Pass expanded state and toggle callbacks to FileExplorerTree as props
- Use Effect Schema to validate/normalize stored state on load

**Why:** Component-level state is lost when the component unmounts (tab switching). Moving to Zustand with localStorage ensures state survives:

- Switching between "threads" and "files" tabs
- Page refreshes and browser closes
- Matches the pattern already used in the app (terminalStateStore, composerDraftStore)

**Implementation pattern:** Follow `terminalStateStore.ts` or `composerDraftStore.ts` which use Zustand + persist middleware with localStorage.

---

### 3. Change Default Expansion Behavior

**Files to modify:**

- `apps/web/src/components/FileExplorerTree.tsx`

**Current behavior:**

- Root-level directories (depth === 0) expand by default
- All others start collapsed

**Required change:**

- Start with all directories collapsed by default
- Only expand directories that the user explicitly clicks on
- Relies on persisted expansion state (fix #2) to remember user's choices

**Why:** Cleaner initial view. Users expand only what they need. Combined with state persistence, users' expansion choices are remembered across sessions.

---

## Critical Files to Examine

| File                                            | Current Role                       | Changes Needed                                                 |
| ----------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `apps/server/src/workspaceEntries.ts`           | Core file listing logic            | Add optional `maxDepth` param to limit recursion depth         |
| `packages/contracts/src/project.ts`             | API schema definitions             | Add `maxDepth?: number` to `ProjectSearchEntriesInput`         |
| `apps/web/src/lib/projectReactQuery.ts`         | React Query config & hooks         | Add new `fetchDirectoryEntriesQueryOptions()` for lazy-loading |
| `apps/web/src/components/FileExplorerPanel.tsx` | Fetches files, manages panel state | Implement 2-phase fetch strategy: initial + lazy               |
| `apps/web/src/components/FileExplorerTree.tsx`  | Renders tree, manages local state  | Trigger lazy-load on expand; accept expansion state as prop    |
| `apps/web/src/fileExplorerStore.ts`             | (new) Zustand store                | Create to persist expansion state with localStorage            |
| `apps/web/src/terminalStateStore.ts`            | Example persisted store            | Reference pattern for file explorer store                      |

---

## Implementation Steps

### Phase A: Server-Side Depth Limiting (10 min)

1. **Update contract schema** in `packages/contracts/src/project.ts`
   - Add optional `maxDepth?: number` parameter to `ProjectSearchEntriesInput`
   - Document that `maxDepth` limits directory recursion depth

2. **Implement depth limiting** in `apps/server/src/workspaceEntries.ts`
   - Modify `searchWorkspaceEntries()` to accept and respect `maxDepth` parameter
   - When recursing through directories, stop at specified depth
   - Return complete entries up to that depth

### Phase B: Client-Side Lazy-Loading (20 min)

3. **Add lazy-load query option** in `apps/web/src/lib/projectReactQuery.ts`
   - Create `fetchDirectoryEntriesQueryOptions(cwd, dirPath, maxDepth)` for on-demand fetches
   - Keep existing `projectSearchEntriesQueryOptions()` for initial root load
   - Initial query uses `maxDepth: 3`; lazy-load queries use `maxDepth: 3` for subtrees

4. **Implement lazy-loading strategy** in `apps/web/src/components/FileExplorerPanel.tsx`
   - Initial render: fetch root with `maxDepth: 3`
   - Track which directories have been fetched (maintain in component state or store)
   - Pass `onExpandDirectory` callback to tree that checks if dir needs fetching

5. **Update FileExplorerTree** to trigger lazy-loads `apps/web/src/components/FileExplorerTree.tsx`
   - Accept `onExpandDirectory` callback prop
   - When user expands a directory, check if its contents are loaded
   - If not, call callback to trigger lazy-load query
   - Show loading spinner while fetching
   - Use persisted expansion state instead of local useState

### Phase C: State Persistence (15 min)

6. **Create file explorer state store** `apps/web/src/fileExplorerStore.ts`
   - Use Zustand + persist middleware (reference `terminalStateStore.ts`)
   - Store structure: `{ expandedDirs: Record<projectCwd, Set<dirPath>> }`
   - Add actions: `toggleDirectory(cwd, dirPath)`, `expandDirectory(cwd, dirPath)`, `collapseDirectory(cwd, dirPath)`
   - localStorage key: `t3code:file-explorer-expanded:v1`
   - Use Effect Schema for validation on restore

7. **Connect expansion state to FileExplorerPanel & FileExplorerTree**
   - Import `useFileExplorerStore()` in FileExplorerPanel
   - Pass persisted expansion state and toggles to FileExplorerTree
   - Remove local `useState` in FileExplorerTree

### Phase D: UX Polish (5 min)

8. **Disable default directory expansion** in `FileExplorerTree`
   - Change condition from `if (depth === 0)` to `if (false)` (never auto-expand)
   - All directories start collapsed, preserving persisted state from previous session

### Phase E: Testing (10 min)

9. **Test all three fixes**
   - [ ] Deep files visible: expand `/apps/server/src/terminal/layers` → see files inside
   - [ ] Expansion persists on tab switch: expand dirs, click "threads" tab, click "files" → expanded state preserved
   - [ ] Expansion persists on refresh: expand dirs, refresh page → state restored
   - [ ] Lazy-loading works: expand deep directory → no loading spinner, quick response (cached)
   - [ ] First time opening deep dir: expand directory not in initial fetch → loading spinner, then content loads
   - [ ] All collapsed initially: file explorer opens with no directories expanded

---

## Verification Checklist

### Fix 1: Deep File Visibility (Lazy-Loading)

- [ ] Expand `/apps/server/src/terminal/layers` (empty folder) → renders with no files shown
- [ ] Expand deep nested directories (>3 levels) → files and folders appear after lazy-load
- [ ] First-time open of deep dir shows brief loading indicator (if not pre-fetched)
- [ ] Second access to same deep dir is instant (React Query cache hit)

### Fix 2: State Persistence (Expansion Memory)

- [ ] Expand 3-4 directories in file explorer
- [ ] Switch to "threads" tab, then back to "files" → all expanded dirs still expanded
- [ ] Refresh page → all expanded dirs still expanded
- [ ] localStorage key `t3code:file-explorer-expanded:v1` exists and contains valid JSON

### Fix 3: Default Expansion

- [ ] Open fresh file explorer (clear localStorage if needed) → all directories start collapsed
- [ ] Clicking a collapsed directory expands it → state persisted for future sessions
- [ ] Project hierarchy is visible but compact on initial load

### General Quality Checks

- [ ] No console errors or React warnings
- [ ] File explorer performance is smooth (no lag when expanding/collapsing)
- [ ] Per-project expansion works: switch projects → different expansion states per project
- [ ] Very large projects load without memory issues
- [ ] Lazy-load spinner UX is smooth and not jarring

---

## Risks & Mitigations

**Risk:** Initial fetch with `maxDepth: 3` might miss some first-level directory contents

- **Mitigation:** If depth of 3 isn't enough, increase to 4 during testing. Lazy-load ensures everything is eventually discoverable.

**Risk:** Multiple lazy-load queries could hammer the server if user expands many dirs at once

- **Mitigation:** React Query caching (15s stale time) prevents duplicate requests. Consider query deduplication if needed.

**Risk:** Server-side depth limiting adds complexity to `workspaceEntries.ts`

- **Mitigation:** Implementation is straightforward (track depth while recursing). Add unit tests for depth limits.

**Risk:** Per-project expansion state in localStorage could grow large over time

- **Mitigation:** Current implementation is compact (`Set<dirPath>`). If needed, add cleanup for abandoned projects via app settings.

**Risk:** Lazy-load spinner UX might feel sluggish on slow connections

- **Mitigation:** Spinner only shows for dirs not in initial fetch (>3 levels). Most real use cases pre-fetch, so rare.

**Risk:** Breaking change to contract (adding `maxDepth` param)

- **Mitigation:** Make `maxDepth` optional with default behavior (no limiting). Backward compatible with old client/server pairs.

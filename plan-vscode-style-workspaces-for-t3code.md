# Plan: VSCode-style Workspaces for t3code

## Context

Currently, t3code has "Projects" (each tied to a single `cwd`). There is no concept of grouping multiple projects together. Users want VSCode-style **Workspaces** — named collections of multiple projects — so that:

1. They can quickly switch between different contexts (e.g. "Work", "Personal", "OSS")
2. The AI has full context of **all folders** in the active workspace, not just the current project's directory

---

## What a Workspace Is

- A **named group of projects** (e.g. "My SaaS" groups projects `/frontend`, `/backend`, `/infra`)
- Persisted **server-side in SQLite** (synced to client via existing WebSocket read model)
- **Active workspace** is stored client-side in localStorage (UI/session concept)
- The sidebar shows only projects belonging to the active workspace (or all if "All Projects" default workspace is active)

---

## Multi-Folder AI Context Design

**Claude Agent SDK** (native support): Already has `additionalDirectories` in `ClaudeQueryOptions`. We just need to populate it with the other workspace folder paths.

**Codex**: Does not natively support multi-dir. Workaround: inject the other workspace directory paths as a system prompt prefix (e.g. `"This workspace also includes: /path/to/other, /path/to/another"`).

**File Explorer** (`workspaceEntries.ts`): Currently searches a single `cwd`. Needs to aggregate results across all workspace project roots.

---

## Implementation Plan

### Phase 1 — Contracts (`packages/contracts/src/`)

**`orchestration.ts`** — Add:

- `WorkspaceId` branded type (like `ProjectId`)
- `OrchestrationWorkspace` schema: `{ id, name, projectIds: ProjectId[], createdAt, updatedAt, deletedAt }`
- Workspace commands: `CreateWorkspace`, `UpdateWorkspace`, `DeleteWorkspace`, `AddProjectToWorkspace`, `RemoveProjectFromWorkspace`
- Workspace events: `WorkspaceCreated`, `WorkspaceUpdated`, `WorkspaceDeleted`, `ProjectAddedToWorkspace`, `ProjectRemovedFromWorkspace`
- Extend `OrchestrationReadModel` to include `workspaces: OrchestrationWorkspace[]`

**`provider.ts`** — Add:

- `additionalContextDirectories: Schema.optional(Schema.Array(Schema.String))` to `ProviderSessionStartInput`

**`project.ts`** — Add workspace-aware search input:

- `ProjectSearchEntriesInput` extend to support `additionalCwds?: string[]`

---

### Phase 2 — Server: Persistence & Orchestration

**New DB migration** (`apps/server/src/persistence/Migrations/`):

- `016_workspaces.ts`: Create `ProjectionWorkspaces` table:
  ```sql
  CREATE TABLE ProjectionWorkspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    projectIds TEXT NOT NULL, -- JSON array
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    deletedAt TEXT
  );
  ```

**New service** (`apps/server/src/persistence/Services/WorkspaceQueryService.ts`):

- CRUD helpers using Effect.ts `@effect/sql-sqlite-bun` pattern (follow existing Services like `ThreadQueryService.ts`)

**Orchestration decider** (`apps/server/src/orchestration/decider.ts`):

- Handle workspace commands: validate, emit workspace events

**Orchestration projector** (`apps/server/src/orchestration/projector.ts`):

- Handle workspace events: upsert into `ProjectionWorkspaces` table
- Include workspace list in read model snapshot

**WebSocket server** (`apps/server/src/wsServer.ts`):

- Add handlers for workspace CRUD methods
- Include workspaces in `orchestration.getSnapshot` response

---

### Phase 3 — Server: Multi-Folder AI Context

**`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`**:

- Extend `resolveThreadWorkspaceCwd()` → new helper `resolveThreadWorkspaceContext()` that:
  1. Resolves primary `cwd` (same as before)
  2. Looks up which workspace the thread's project belongs to
  3. Collects `workspaceRoot` of all **other** projects in that workspace
  4. Returns `{ cwd, additionalContextDirectories: string[] }`
- Pass `additionalContextDirectories` in `ProviderSessionStartInput`

**`apps/server/src/provider/Layers/ClaudeAdapter.ts`** (line ~2579):

- Change `additionalDirectories: [input.cwd]` → `additionalDirectories: [input.cwd, ...(input.additionalContextDirectories ?? [])]`

**`apps/server/src/workspaceEntries.ts`**:

- Add a new exported function `searchWorkspaceEntriesMultiRoot(inputs: ProjectSearchEntriesInput[])` that fans out searches to multiple cwds and merges/ranks results

---

### Phase 4 — Client: State & Types

**`apps/web/src/types.ts`** — Add:

```typescript
interface Workspace {
  id: WorkspaceId;
  name: string;
  projectIds: ProjectId[];
  createdAt: string;
  updatedAt: string;
}
```

**`apps/web/src/store.ts`** — Add:

- `workspaces: Workspace[]` to `AppState`
- `activeWorkspaceId: WorkspaceId | null` (localStorage-persisted separately)
- Sync workspaces from server read model in `syncServerReadModel()`
- New localStorage key: `"t3code:active-workspace:v1"` (just the ID)

**Derived selector**:

- `selectVisibleProjects(state)`: returns `state.projects` filtered to those in `activeWorkspace.projectIds` (or all if no active workspace / "All" selected)

---

### Phase 5 — Client: UI

**New component: `WorkspaceSelector`** (`apps/web/src/components/WorkspaceSelector.tsx`):

- Dropdown at the very top of the sidebar (above project list)
- Shows current workspace name (or "All Projects")
- Options: list of workspaces + "All Projects" + "Manage Workspaces…"
- On select: updates `activeWorkspaceId` in localStorage

**New component: `WorkspaceManager`** (`apps/web/src/components/WorkspaceManager.tsx`):

- Modal or inline panel for creating/renaming/deleting workspaces
- Add/remove projects from a workspace (multi-select list of existing projects)

**`apps/web/src/components/Sidebar.tsx`**:

- Add `<WorkspaceSelector />` at the top of `<SidebarHeader>`
- Filter displayed projects using `selectVisibleProjects`

**`apps/web/src/routes/_chat.settings.tsx`** (optional):

- Link to workspace management from settings page

---

## Critical Files to Modify

| File                                                             | Change                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/contracts/src/orchestration.ts`                        | Add `WorkspaceId`, `OrchestrationWorkspace`, workspace commands/events, extend read model |
| `packages/contracts/src/provider.ts`                             | Add `additionalContextDirectories` to `ProviderSessionStartInput`                         |
| `apps/server/src/persistence/Migrations/016_workspaces.ts`       | New migration                                                                             |
| `apps/server/src/persistence/Services/WorkspaceQueryService.ts`  | New CRUD service                                                                          |
| `apps/server/src/orchestration/decider.ts`                       | Workspace command handlers                                                                |
| `apps/server/src/orchestration/projector.ts`                     | Workspace event projection                                                                |
| `apps/server/src/wsServer.ts`                                    | Workspace WebSocket methods                                                               |
| `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` | Multi-dir context resolution                                                              |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts`               | Pass `additionalDirectories`                                                              |
| `apps/server/src/workspaceEntries.ts`                            | Multi-root file search                                                                    |
| `apps/web/src/types.ts`                                          | `Workspace` interface                                                                     |
| `apps/web/src/store.ts`                                          | Workspaces state, `activeWorkspaceId`, `selectVisibleProjects`                            |
| `apps/web/src/components/Sidebar.tsx`                            | Add `WorkspaceSelector`, filter projects                                                  |
| `apps/web/src/components/WorkspaceSelector.tsx`                  | New component                                                                             |
| `apps/web/src/components/WorkspaceManager.tsx`                   | New component                                                                             |

---

## Existing Patterns to Reuse

- **Effect Schema** definitions: follow patterns in `packages/contracts/src/orchestration.ts`
- **DB migrations**: follow `apps/server/src/persistence/Migrations/015_*.ts`
- **Services**: follow `apps/server/src/persistence/Services/ThreadQueryService.ts`
- **Decider/Projector pattern**: follow existing command/event handling in `decider.ts` / `projector.ts`
- **Zustand store**: follow `apps/web/src/store.ts` pure reducer pattern
- **localStorage hook**: `apps/web/src/hooks/useLocalStorage.ts`
- **Sidebar UI**: follow existing `SidebarHeader`, `SidebarMenu` component patterns in `apps/web/src/components/Sidebar.tsx`

---

## Trade-offs & Notes

| Decision                                         | Trade-off                                                      |
| ------------------------------------------------ | -------------------------------------------------------------- |
| Projects still bound to one thread (primary cwd) | Simplifies git/worktree logic; only context directories change |
| `additionalDirectories` for Claude               | Claude Agent SDK natively supports this — low risk, high value |
| Codex multi-dir                                  | Out of scope for now — will be added in a future iteration     |
| Workspaces in server SQLite                      | Consistent with projects; survives browser data clears         |
| Active workspace in localStorage                 | Fast, no server round-trip for UI switching                    |
| Soft-delete (`deletedAt`)                        | Consistent with existing project soft-delete pattern           |

---

## Verification

1. **Unit tests**: Add tests for new `decider.ts` workspace commands and `store.ts` selectors
2. **Manual flow**:
   - Create a workspace via `WorkspaceManager`
   - Add 2+ existing projects to it
   - Switch to the workspace in the sidebar dropdown — verify only those projects appear
   - Open a thread in one of the projects — verify the AI session receives `additionalDirectories` for the other workspace folders
   - Check Claude responds with knowledge of files from both directories
3. **File search**: Open FileExplorer panel while in a multi-project workspace — verify files from all projects appear in search results
4. **Persistence**: Refresh the browser — verify workspaces reload from server and active workspace is restored from localStorage

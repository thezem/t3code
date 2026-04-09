# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun run dev            # All apps in parallel (server, web, desktop)
bun run dev:server     # Server only
bun run dev:web        # Web app only (port 5733)
bun run dev:desktop    # Electron desktop only

# Build
bun run build          # Build all (via Turbo)
bun run build:desktop  # Desktop + CLI
bun run build:contracts # Contracts package

# Lint, Format, Typecheck — ALL must pass before task completion
bun fmt                # Format with oxfmt
bun fmt:check          # Check formatting without changes
bun lint               # Lint with oxlint
bun typecheck          # TypeScript type checking across all packages

# Tests — NEVER run `bun test`, always use:
bun run test           # All tests (Vitest)

# Run tests for a specific workspace
bun run -w @t3tools/server test
bun run -w @t3tools/web test
```

## Release Workflow

### Pre-Release Validation (Local)

Before creating a release, **always run these checks locally** to ensure CI will pass:

```bash
# 1. Run all quality checks (must all pass before proceeding)
bun run typecheck    # TypeScript type checking
bun lint             # Linting with oxlint
bun run test         # All tests (Vitest)

# Verify results:
# ✅ Typecheck: 0 errors
# ✅ Lint: 0 errors, 0 warnings
# ✅ Tests: All passing (skip/todo tests are OK)
```

**IMPORTANT**: Do NOT proceed to release if any of these checks fail. Fix issues locally first, then re-validate.

### Creating a Release Tag

Once all local checks pass, create and push the release tag:

```bash
# 1. Ensure you're on main branch with clean working tree
git status

# 2. Create the release tag with format: v<major>.<minor>.<patch>[-<prerelease>]
# Examples: v0.0.13, v0.0.13-zem0.1, v1.0.0-rc1
git tag v0.0.13-zem0.1 -m "Release v0.0.13-zem0.1"

# 3. Push tag to your fork (replace 'thezem' with your username)
git push origin v0.0.13-zem0.1

# Or force-push if tag already exists and needs updating:
git push -f origin v0.0.13-zem0.1
```

### Release CI Pipeline

After pushing a tag, GitHub Actions automatically:

1. **Preflight** — Validates git checkout, typecheck, lint, tests
2. **Build** — Builds desktop app and CLI
3. **Publish** — Publishes CLI to npm (if configured)
4. **GitHub Release** — Creates release on GitHub with changelog

**Monitor CI**: Watch the Actions tab at https://github.com/thezem/t3code/actions

### Common Release Issues & Fixes

| Issue                               | Cause                                     | Fix                                                                           |
| ----------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| Symlink error: "File name too long" | File stored as symlink in git             | `git rm --cached FILE && git add FILE && git commit`                          |
| TypeScript error                    | Type mismatch not caught locally          | Fix type, re-validate with `bun run typecheck`                                |
| Lint errors                         | Linting issues                            | Run `bun lint` and fix, or add `// oxlint-disable` comment with justification |
| Test timeout                        | Hook-using component in incompatible test | Mark as `.todo()` and file issue for refactor                                 |

## Architecture Overview

T3 Code is a **minimal web GUI for coding agents** (Claude and Codex) built as a Turbo monorepo with Bun.

### Data Flow

```
Web Client (React SPA, port 5733)
  ↕ WebSocket (bidirectional push)
Server (Node.js / Effect.ts runtime)
  ├── Orchestration  — agent command processing, domain events
  ├── Provider Layer — Claude agent SDK / Codex app-server integration
  ├── Terminal Mgr   — PTY sessions via node-pty
  ├── Git Mgr        — git operations and state
  └── SQLite         — persistence via @effect/sql-sqlite-bun

Desktop (Electron) wraps web client via IPC bridge
```

### Package Roles

- **`apps/server`** — Node.js WebSocket server. Entry: `src/index.ts` (Effect.ts CLI). Core files: `wsServer.ts` (request routing), `orchestration/`, `provider/`, `terminal/`, `git/`, `persistence/`. Publishes as the `t3` CLI.
- **`apps/web`** — React 19 / Vite SPA. Uses TanStack Router (file-based), TanStack Query, Zustand, xterm.js. Key component: `ChatView.tsx`.
- **`apps/desktop`** — Electron wrapper. Main process: `src/main.ts`. IPC bridges for file picker, theme, auto-update (electron-updater), and `t3://` custom protocol.
- **`packages/contracts`** — Shared Effect Schema definitions for WebSocket protocol, provider events, session types. **Schema-only — no runtime logic.**
- **`packages/shared`** — Shared runtime utilities (git, logging, shell, net). Uses explicit subpath exports (`@t3tools/shared/git`), **no barrel index**.

### Server: Codex App Server Integration

Codex sessions run as `codex app-server` (JSON-RPC over stdio) per provider session:

- `codexAppServerManager.ts` — session startup/resume, turn lifecycle
- `providerManager.ts` — provider dispatch and thread event logging
- `wsServer.ts` — routes `NativeApi` methods over WebSocket
- Web consumes events via WebSocket push on channel `orchestration.domainEvent`

### Server: Claude Agent SDK Integration

Claude sessions use `@anthropic-ai/claude-agent-sdk`. Provider dispatch mirrors the Codex pattern through `providerManager.ts` and the orchestration layer.

### Key Tech

- **Effect.ts** — server runtime, service layers, error handling, SQL
- **React 19** with React Compiler (babel-plugin-react-compiler)
- **TanStack Router** — file-based routing in `apps/web/src/routes/`
- **Vitest** with `@effect/vitest` for Effect-aware tests
- **oxlint + oxfmt** — Rust-based linter and formatter (not ESLint/Prettier)
- **Turbo** — task orchestration and build caching across workspaces

### Core Priorities

1. Performance and reliability first.
2. Correctness and robustness over short-term convenience.
3. Long-term maintainability — extract shared logic, avoid duplication across files.

### Environment Variables

| Variable               | Purpose                              |
| ---------------------- | ------------------------------------ |
| `T3CODE_HOME`          | Config directory (default: `~/.t3`)  |
| `T3CODE_PORT`          | Server port                          |
| `T3CODE_AUTH_TOKEN`    | API auth token                       |
| `T3CODE_NO_BROWSER`    | Skip opening browser on start        |
| `T3CODE_LOG_WS_EVENTS` | Enable WebSocket event debug logging |
| `VITE_WS_URL`          | WebSocket server URL (web build)     |

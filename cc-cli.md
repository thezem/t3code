# Claude Code CLI — Comprehensive Integration Guide

> How t3code spawns, manages, and orchestrates Claude Code (and Codex) — everything you need to replicate this architecture in your own project.

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Package & SDK Dependencies](#package--sdk-dependencies)
4. [Process Spawning](#process-spawning)
   - [Desktop → Server (Electron)](#desktop--server-electron)
   - [Server → Claude (Agent SDK)](#server--claude-agent-sdk)
   - [Server → Codex (JSON-RPC over stdio)](#server--codex-json-rpc-over-stdio)
5. [Environment Variables](#environment-variables)
6. [Claude Agent SDK Integration](#claude-agent-sdk-integration)
   - [The `query()` Function](#the-query-function)
   - [Query Options](#query-options)
   - [SDK Message Types](#sdk-message-types)
   - [AsyncIterable → Effect Stream Bridge](#asynciterable--effect-stream-bridge)
7. [Session Management](#session-management)
   - [Session Lifecycle](#session-lifecycle)
   - [Session Context Shape](#session-context-shape)
   - [Resume Cursor Strategy](#resume-cursor-strategy)
8. [Permission Modes](#permission-modes)
9. [Multi-Turn Prompt Queue](#multi-turn-prompt-queue)
10. [Tool Approval / `canUseTool`](#tool-approval--canusetool)
11. [Hooks](#hooks)
12. [Canonical Runtime Event Mapping](#canonical-runtime-event-mapping)
13. [Interrupt & Stop Semantics](#interrupt--stop-semantics)
14. [Orchestration Architecture](#orchestration-architecture)
    - [Command → Event Pipeline](#command--event-pipeline)
    - [Queue-Backed Workers](#queue-backed-workers)
    - [Provider Command Reactor](#provider-command-reactor)
15. [WebSocket Protocol](#websocket-protocol)
16. [Persistence (SQLite)](#persistence-sqlite)
17. [Directory & File Layout](#directory--file-layout)
18. [Configuration Files](#configuration-files)
    - [CLAUDE.md](#claudemd)
    - [AGENTS.md](#agentsmd)
    - [Runtime Config (settings.json equivalent)](#runtime-config-settingsjson-equivalent)
19. [Startup & Shutdown Flow](#startup--shutdown-flow)
20. [Worktree Management](#worktree-management)
21. [Checkpoint System](#checkpoint-system)
22. [Logging](#logging)
23. [How to Replicate This Architecture](#how-to-replicate-this-architecture)

---

## Overview

t3code is a **web GUI for coding agents** (Claude Code and Codex). It is a Turbo monorepo built with Bun. The server is a Node.js/Effect.ts WebSocket server that acts as a broker between the browser React app and the underlying AI runtimes.

**Key design principles:**

- All client ↔ server communication goes through **WebSocket only** (no REST for core ops)
- The orchestration engine is **event-sourced** — all state is derived from persisted events in SQLite
- Providers (Claude, Codex) are **adapters** behind a common interface — the orchestration layer is entirely provider-agnostic
- The Claude adapter uses `@anthropic-ai/claude-agent-sdk` directly — no separate subprocess like Codex
- The Electron desktop wraps the same server binary and opens the web UI inside a BrowserWindow

```
┌─────────────────────────────────┐
│  Browser (React + Vite)         │
│  wsTransport (state machine)    │
│  Typed push decode at boundary  │
└──────────┬──────────────────────┘
           │ ws://localhost:3773
┌──────────▼──────────────────────┐
│  apps/server (Node.js)          │
│  WebSocket + HTTP static server │
│  ServerPushBus (ordered pushes) │
│  OrchestrationEngine            │
│  ProviderService                │
│  CheckpointReactor              │
└──────────┬──────────────────────┘
           │ claude-agent-sdk (async iterable)
           │ OR JSON-RPC over stdio
┌──────────▼──────────────────────┐
│  Claude Code / Codex App Server │
└─────────────────────────────────┘
```

---

## System Architecture

### Package Roles

| Package              | Role                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`        | Node.js WebSocket server. Entry: `src/index.ts` (Effect.ts CLI). Core dirs: `orchestration/`, `provider/`, `terminal/`, `git/`, `persistence/`. Published as the `t3` CLI binary. |
| `apps/web`           | React 19 / Vite SPA. Uses TanStack Router, TanStack Query, Zustand, xterm.js. Key component: `ChatView.tsx`.                                                                      |
| `apps/desktop`       | Electron wrapper. Main process: `src/main.ts`. Spawns the server as a child process; IPC bridges for file picker, theme, auto-update, `t3://` protocol.                           |
| `packages/contracts` | Shared Effect Schema definitions for WebSocket protocol, provider events, session types. **Schema-only — zero runtime logic.**                                                    |
| `packages/shared`    | Shared runtime utilities (git, logging, shell, net). Uses explicit subpath exports (`@t3tools/shared/git`), no barrel index.                                                      |

### Data Flow (User Turn)

```
Browser action
  → WsTransport (typed request)
    → wsServer (decode + route)
      → orchestration.dispatchCommand
        → OrchestrationEngine (persist + publish domain events)
          → ProviderCommandReactor (domain intent → ProviderService)
            → ProviderService (adapter routing)
              → ClaudeAdapter / CodexAdapter
                ← SDK async iterable / JSON-RPC stdio
              ← ProviderRuntimeEvent stream
            ← ProviderRuntimeIngestion (normalize)
          ← orchestration domain events
        ← OrchestrationEngine projections
      ← ServerPushBus (ordered push: orchestration.domainEvent)
    ← Browser receives typed push
```

---

## Package & SDK Dependencies

### Server (`apps/server/package.json`)

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.77",
    "@effect/platform-node": "catalog:",
    "@effect/sql-sqlite-bun": "catalog:",
    "effect": "catalog:",
    "node-pty": "^1.1.0"
  }
}
```

The **`@anthropic-ai/claude-agent-sdk`** package is the only Claude-specific dependency. It internally manages the Claude Code CLI process — your server code never spawns `claude` directly.

### Desktop (`apps/desktop/package.json`)

```json
{
  "dependencies": {
    "electron": "...",
    "electron-updater": "..."
  }
}
```

The desktop app does not import the Claude SDK at all — it only spawns the server and loads the web UI.

---

## Process Spawning

### Desktop → Server (Electron)

**File:** `apps/desktop/src/main.ts`

The Electron main process spawns the compiled server binary as a child Node.js process using `ChildProcess.spawn()`:

```typescript
import * as ChildProcess from "node:child_process";

function startBackend(): void {
  if (isQuitting || backendProcess) return;

  const backendEntry = resolveBackendEntry(); // resolves to apps/server/dist/index.mjs
  const captureBackendLogs = app.isPackaged && backendLogSink !== null;

  const child = ChildProcess.spawn(process.execPath, [backendEntry], {
    cwd: resolveBackendCwd(),
    // process.execPath in Electron points to the Electron binary.
    // ELECTRON_RUN_AS_NODE=1 makes it behave as plain Node.js (no GUI).
    env: {
      ...backendEnv(),
      ELECTRON_RUN_AS_NODE: "1",
    },
    // In packaged builds: capture stdout/stderr to rotating log files.
    // In development: inherit stdio so logs flow to the terminal.
    stdio: captureBackendLogs ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  backendProcess = child;

  // Reset the restart counter as soon as the process successfully spawns
  child.once("spawn", () => {
    restartAttempt = 0;
  });

  // Trigger exponential-backoff restart on error or unexpected exit
  child.on("error", (error) => {
    backendProcess = null;
    scheduleBackendRestart(error.message);
  });

  child.on("exit", (code, signal) => {
    backendProcess = null;
    if (isQuitting) return;
    scheduleBackendRestart(`code=${code} signal=${signal}`);
  });
}
```

#### Restart Strategy (Exponential Backoff)

```typescript
let restartAttempt = 0;

function scheduleBackendRestart(reason: string): void {
  if (isQuitting || restartTimer) return;
  // Delay: 500ms, 1s, 2s, 4s, 8s, capped at 10s
  const delayMs = Math.min(500 * 2 ** restartAttempt, 10_000);
  restartAttempt += 1;

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBackend();
  }, delayMs);
}
```

#### Graceful Shutdown

```typescript
function stopBackend(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM"); // Ask nicely
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL"); // Force kill after 2 seconds
      }
    }, 2_000).unref();
  }
}
```

There is also an async variant `stopBackendAndWaitForExit(timeoutMs = 5_000)` used during `app.before-quit` to ensure the server has fully exited before the Electron app closes.

---

### Server → Claude (Agent SDK)

The server **does not** spawn Claude Code directly. Instead, `@anthropic-ai/claude-agent-sdk` handles process management internally. The server calls the SDK's `query()` function, which returns an async iterable of messages:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: makePromptAsyncIterable(), // See: Multi-Turn Prompt Queue
  options: {
    cwd: input.cwd,
    model: input.model,
    permissionMode: claudeOptions?.permissionMode,
    maxThinkingTokens: claudeOptions?.maxThinkingTokens,
    pathToClaudeCodeExecutable: claudeOptions?.binaryPath, // optional custom binary
    resume: resumeState?.resume,
    resumeSessionAt: resumeState?.resumeSessionAt,
    signal: abortController.signal,
    includePartialMessages: true,
    canUseTool: makeCanUseTool(), // approval callback
    hooks: makeClaudeHooks(), // lifecycle hooks
  },
});
// result is AsyncIterable<SDKMessage> + control methods
```

`result` implements `ClaudeQueryRuntime`:

```typescript
interface ClaudeQueryRuntime extends AsyncIterable<SDKMessage> {
  readonly interrupt: () => Promise<void>;
  readonly setModel: (model?: string) => Promise<void>;
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>;
  readonly close: () => void;
}
```

---

### Server → Codex (JSON-RPC over stdio)

**File:** `apps/server/src/codexAppServerManager.ts`

Codex uses a completely different approach — a long-running subprocess with JSON-RPC communication over stdio:

```typescript
import { spawn } from "node:child_process";
import readline from "node:readline";

const child = spawn(codexBinaryPath, ["app-server"], {
  cwd: resolvedCwd,
  env: {
    ...process.env,
    ...(codexHomePath ? { CODEX_HOME: codexHomePath } : {}),
  },
  stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr all piped
  shell: process.platform === "win32",
});

// Parse JSON-RPC responses one line at a time
const output = readline.createInterface({ input: child.stdout });
output.on("line", (line) => {
  const response = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
  // dispatch to pending request resolver or event handler
});
```

**JSON-RPC methods used:**

| Method          | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `initialize`    | Start codex session                                              |
| `model/list`    | List available models                                            |
| `account/read`  | Get account info                                                 |
| `thread/start`  | Create new thread with `{ model, cwd, approvalPolicy, sandbox }` |
| `thread/resume` | Resume from stored thread ID                                     |
| `turn/start`    | Send user input for a turn                                       |

This is NOT how Claude works — Claude uses the SDK's async iterable, not a subprocess with JSON-RPC.

---

## Environment Variables

### Variables the Server Reads

| Variable               | Purpose                                      | Default                              |
| ---------------------- | -------------------------------------------- | ------------------------------------ |
| `T3CODE_MODE`          | `"web"` or `"desktop"`                       | `"web"`                              |
| `T3CODE_PORT`          | HTTP/WebSocket server port                   | `3773` (auto-selected in web mode)   |
| `T3CODE_HOST`          | Bind address                                 | Auto (web) / `"127.0.0.1"` (desktop) |
| `T3CODE_HOME`          | Base directory for all app state             | `~/.t3`                              |
| `T3CODE_AUTH_TOKEN`    | WebSocket auth token (set by desktop)        | `undefined`                          |
| `T3CODE_NO_BROWSER`    | Skip opening browser on start                | `false`                              |
| `T3CODE_LOG_WS_EVENTS` | Enable WebSocket event debug logging         | `false`                              |
| `VITE_WS_URL`          | Overrides the WebSocket URL in the web build | —                                    |

### Variables Passed by Desktop to Server

```typescript
function backendEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env, // Inherit everything from Electron's env
    T3CODE_MODE: "desktop",
    T3CODE_NO_BROWSER: "1",
    T3CODE_PORT: String(backendPort), // randomly selected free port
    T3CODE_HOME: BASE_DIR, // e.g. ~/.t3
    T3CODE_AUTH_TOKEN: backendAuthToken, // randomly generated UUID
  };
}
```

`ELECTRON_RUN_AS_NODE: "1"` is also passed — this is specific to Electron and tells the Electron binary to behave as a plain Node.js process.

### Variables Passed to Codex

```typescript
env: {
  ...process.env,
  ...(codexHomePath ? { CODEX_HOME: codexHomePath } : {}),
}
```

Claude does not need extra env vars — the SDK reads the Anthropic API key from `ANTHROPIC_API_KEY` (standard env var from the shell).

---

## Claude Agent SDK Integration

### The `query()` Function

`query()` is the single entry point for Claude sessions. It accepts a `prompt` (async iterable of user messages for multi-turn) and `options`, and returns an async iterable of `SDKMessage` objects plus runtime control methods.

```typescript
import {
  query,
  type Options as ClaudeQueryOptions,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type CanUseTool,
} from "@anthropic-ai/claude-agent-sdk";
```

### Query Options

```typescript
interface ClaudeQueryOptions {
  cwd?: string; // Working directory for the agent
  model?: string; // e.g. "claude-opus-4-5"
  permissionMode?: PermissionMode; // See: Permission Modes
  maxThinkingTokens?: number | null; // Extended thinking budget
  pathToClaudeCodeExecutable?: string; // Override claude binary path
  resume?: string; // Opaque session ID to resume
  resumeSessionAt?: string; // ISO timestamp to resume at
  signal?: AbortSignal; // For interruption
  includePartialMessages?: boolean; // Stream partial tool results
  canUseTool?: CanUseTool; // Approval callback
  hooks?: ClaudeHooks; // Lifecycle hooks
  env?: Record<string, string>; // Extra env for the subprocess
  additionalDirectories?: string[]; // Extra dirs agent can access
}
```

### SDK Message Types

The async iterable yields these message types:

| Type          | Subtype                    | Meaning                                     |
| ------------- | -------------------------- | ------------------------------------------- |
| `"assistant"` | —                          | Assistant message (text or tool use blocks) |
| `"user"`      | —                          | Tool results returned to the model          |
| `"result"`    | `"success"`                | Turn completed successfully                 |
| `"result"`    | `"error_during_execution"` | Turn failed or was interrupted              |
| `"system"`    | `"init"`                   | Session initialized, contains `session_id`  |

Plus streaming delta events for partial content (when `includePartialMessages: true`).

### AsyncIterable → Effect Stream Bridge

The SDK returns a native async iterable. t3code bridges this to an Effect `Stream` in two ways:

**Preferred (Effect built-in):**

```typescript
const sdkMessageStream = Stream.fromAsyncIterable(
  session.result,
  (cause) =>
    new ProviderAdapterProcessError({
      provider: "claudeAgent",
      sessionId,
      detail: "Claude runtime stream failed.",
      cause,
    }),
);
```

**Portable fallback (used in the actual implementation):**

```typescript
const sdkMessageStream = Stream.async<SDKMessage, ProviderAdapterProcessError>((emit) => {
  let cancelled = false;

  void (async () => {
    try {
      for await (const message of session.result) {
        if (cancelled) break;
        emit.single(message);
      }
      emit.end();
    } catch (cause) {
      emit.fail(
        new ProviderAdapterProcessError({
          provider: "claudeAgent",
          sessionId,
          detail: "Claude runtime stream failed.",
          cause,
        }),
      );
    }
  })();

  // Cleanup: set cancelled flag to stop consuming the async iterable
  return Effect.sync(() => {
    cancelled = true;
  });
});
```

---

## Session Management

### Session Lifecycle

```
Client sends ThreadTurnStartCommand
  → OrchestrationEngine persists intent event
  → ProviderCommandReactor picks it up
  → ProviderService.startSession(input)
  → ClaudeAdapter.startSession(input) called
  → query() called → ClaudeQueryRuntime created
  → Session stored in ProviderSessionDirectory (SQLite)
  → Returns ProviderSession with threadId, status, resumeCursor

Client sends turns
  → ProviderCommandReactor calls ProviderService.sendTurn()
  → Message pushed to the prompt queue (AsyncIterable)
  → Claude SDK receives next prompt → runs the agent
  → SDK messages stream back → mapped to ProviderRuntimeEvents
  → Events ingested by ProviderRuntimeIngestion
  → Orchestration domain events emitted
  → Pushed to browser via ServerPushBus
```

### Session Context Shape

The Claude adapter keeps this context object per session in memory:

```typescript
interface ClaudeSessionContext {
  session: ProviderSession;
  readonly promptQueue: Queue.Queue<PromptQueueItem>; // Effect queue for multi-turn input
  readonly query: ClaudeQueryRuntime; // The async iterable + controls
  streamFiber: Fiber.Fiber<void, Error> | undefined; // Background stream consumer
  readonly startedAt: string; // ISO timestamp
  readonly basePermissionMode: PermissionMode | undefined;
  resumeSessionId: string | undefined; // Claude's internal session ID
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly inFlightTools: Map<number, ToolInFlight>;
  turnState: ClaudeTurnState | undefined;
  lastAssistantUuid: string | undefined;
  lastThreadStartedId: string | undefined;
  stopped: boolean;
}
```

### Resume Cursor Strategy

The resume cursor is **adapter-owned opaque state** — nothing outside the Claude adapter reads or writes it. This is a key architectural decision:

```typescript
// Internal shape — only ClaudeAdapter reads/writes this
interface ClaudeResumeState {
  readonly threadId?: ThreadId; // Claude's conversation thread ID
  readonly resume?: string; // UUID: opaque session ID from Claude
  readonly resumeSessionAt?: string; // ISO timestamp: resume from specific point
  readonly turnCount?: number; // Used to validate resume feasibility
}

// Serialized into resumeCursor as opaque JSON in the DB
// Read back at next session start:
function readClaudeResumeState(resumeCursor: unknown): ClaudeResumeState | undefined {
  // parse + validate the opaque JSON
  // reject synthetic thread IDs (claude-thread-*) that can't actually resume
  // reject non-UUID session IDs
  // return undefined if cursor is invalid → start fresh session
}
```

**Rules:**

1. Serialize only adapter-owned fields into `resumeCursor`
2. Parse/validate only inside the Claude adapter
3. Never overload the orchestration `threadId` as Claude's internal thread ID
4. If the resume cursor is invalid or missing, start a fresh session silently

---

## Permission Modes

Claude Code supports these permission modes (passed directly to the SDK):

| Mode                  | Behavior                                           |
| --------------------- | -------------------------------------------------- |
| `"default"`           | Standard Claude Code behavior                      |
| `"acceptEdits"`       | Auto-approve file edits, ask for commands          |
| `"bypassPermissions"` | Allow everything without asking                    |
| `"plan"`              | Plan mode — only proposes changes, doesn't execute |
| `"dontAsk"`           | Never ask for permissions                          |

t3code maps these to two user-facing runtime modes:

| UI Mode         | SDK permissionMode    | Codex equivalent                                         |
| --------------- | --------------------- | -------------------------------------------------------- |
| **Full access** | `"bypassPermissions"` | `approvalPolicy: never`, `sandbox: danger-full-access`   |
| **Supervised**  | `"default"`           | `approvalPolicy: on-request`, `sandbox: workspace-write` |

The permission mode is passed through `ProviderStartOptions`:

```typescript
// packages/contracts/src/orchestration.ts
export const ClaudeProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  permissionMode: Schema.optional(TrimmedNonEmptyString),
  maxThinkingTokens: Schema.optional(NonNegativeInt),
});
```

---

## Multi-Turn Prompt Queue

Claude Code supports multi-turn conversations through an async-iterable prompt input. t3code implements this using an Effect `Queue`:

```typescript
// PromptQueueItem is either a message or a termination signal
type PromptQueueItem =
  | { readonly type: "message"; readonly message: SDKUserMessage }
  | { readonly type: "terminate" };

// Queue is created when the session starts
const promptQueue = Queue.unbounded<PromptQueueItem>();

// The prompt async iterable reads from the queue
async function* makePromptAsyncIterable(): AsyncIterable<SDKUserMessage> {
  while (true) {
    const item = await Queue.take(promptQueue);
    if (item.type === "terminate") break;
    yield item.message;
  }
}

// When sendTurn() is called, enqueue the message:
await Queue.offer(promptQueue, { type: "message", message: userMessage });

// When the session is stopped:
await Queue.offer(promptQueue, { type: "terminate" });
```

User messages are structured as `SDKUserMessage`:

```typescript
function buildUserMessage(input: {
  readonly sdkContent: Array<Record<string, unknown>>;
}): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: input.sdkContent, // array of text/image blocks
    },
  } as SDKUserMessage;
}
```

Content blocks can be:

- `{ type: "text", text: string }` — plain text prompt
- `{ type: "image", source: { type: "base64", media_type: string, data: string } }` — image attachment

Supported image MIME types: `image/gif`, `image/jpeg`, `image/png`, `image/webp`

---

## Tool Approval / `canUseTool`

The `canUseTool` callback is how t3code intercepts Claude's tool calls for user approval:

```typescript
type CanUseTool = (toolName: string, toolInput: unknown) => Promise<PermissionResult>;

// PermissionResult is either:
// { behavior: "allow" }
// { behavior: "deny", message?: string }
// { behavior: "allowPermanently", ruleType: PermissionRuleType, ... }
// { behavior: "denyPermanently", ruleType: PermissionRuleType, ... }
```

t3code's implementation:

```typescript
function makeCanUseTool(): CanUseTool {
  return async (toolName, toolInput) => {
    if (currentPermissionMode === "bypassPermissions") {
      return { behavior: "allow" };
    }

    // Create a pending approval deferred
    const decision = Deferred.make<ProviderApprovalDecision>();
    const requestId = ApprovalRequestId.make();

    context.pendingApprovals.set(requestId, {
      requestType: classifyRequestType(toolName),
      detail: summarizeToolRequest(toolName, toolInput as Record<string, unknown>),
      suggestions: [],
      decision,
    });

    // Emit request.opened event → browser shows approval dialog
    emitApprovalRequestEvent(requestId, toolName, toolInput);

    // Wait for user response (resolves when user clicks Allow/Deny)
    const userDecision = await Deferred.await(decision);

    // Clean up
    context.pendingApprovals.delete(requestId);

    return mapDecisionToPermissionResult(userDecision);
  };
}
```

Tool names are classified to determine what type of approval to show:

```typescript
function classifyToolItemType(toolName: string): CanonicalItemType {
  const normalized = toolName.toLowerCase();

  if (normalized.includes("bash") || normalized.includes("command") || ...) {
    return "command_execution";
  }
  if (normalized.includes("edit") || normalized.includes("write") || ...) {
    return "file_change";
  }
  if (normalized.includes("agent") || normalized.includes("subagent")) {
    return "collab_agent_tool_call";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  // ... etc
  return "dynamic_tool_call";
}
```

---

## Hooks

The SDK supports lifecycle hooks passed via `hooks` in query options. t3code uses these for adapter-originated lifecycle signals:

```typescript
import type { Hooks as ClaudeHooks } from "@anthropic-ai/claude-agent-sdk";

function makeClaudeHooks(): ClaudeHooks {
  return {
    // Called after each tool use completes
    PostToolUse: async (toolName, input, result) => {
      // emit checkpoint signals, log tool completions, etc.
    },
    // Called when Claude stops (turn ends)
    Stop: async (result) => {
      // emit turn completion signals
    },
  };
}
```

Hooks fire **inside** the SDK, synchronously within the SDK's turn lifecycle, before the next message is emitted to the async iterable. Use them for:

- Emitting checkpoint/milestone receipts
- Capturing intermediate state
- Logging tool use audit trails

---

## Canonical Runtime Event Mapping

The Claude adapter translates raw SDK messages into canonical `ProviderRuntimeEvent` shapes that the rest of the orchestration layer understands (and that Codex also uses). This is what keeps the orchestration layer provider-agnostic.

| SDK Message                               | Canonical Event                                        |
| ----------------------------------------- | ------------------------------------------------------ |
| `assistant` message with text block       | `content.delta` (streaming) → `item.completed` (final) |
| `assistant` message with thinking block   | `content.delta` (kind: `reasoning_text`)               |
| `assistant` message with `tool_use` block | `tool.started` → streaming input → `tool.completed`    |
| User `tool_result` block                  | Tool output stream events                              |
| `result` with `subtype: "success"`        | `turn.completed` (status: `"completed"`)               |
| `result` with interruption                | `turn.completed` (status: `"interrupted"`)             |
| `result` with error                       | `turn.completed` (status: `"failed"`)                  |
| `system` with `init`                      | `session.started` (contains Claude's session ID)       |
| `ExitPlanMode` tool                       | Captured as proposed plan content                      |
| Approval via `canUseTool`                 | `request.opened` → `request.resolved`                  |

Turn status mapping:

```typescript
function turnStatusFromResult(result: SDKResultMessage): ProviderRuntimeTurnStatus {
  if (result.subtype === "success") return "completed";
  if (isInterruptedResult(result)) return "interrupted";
  const errors = resultErrorsText(result);
  if (errors.includes("cancel")) return "cancelled";
  return "failed";
}

function isInterruptedResult(result: SDKResultMessage): boolean {
  const errors = resultErrorsText(result);
  if (errors.includes("interrupt")) return true;
  return (
    result.subtype === "error_during_execution" &&
    result.is_error === false &&
    (errors.includes("request was aborted") || errors.includes("aborted"))
  );
}
```

---

## Interrupt & Stop Semantics

**Interrupt a running turn** (user clicks stop mid-generation):

```typescript
// ClaudeQueryRuntime.interrupt()
await context.query.interrupt();
// SDK sends interrupt signal to Claude Code process
// Next message from the iterable will be a result with interrupted status
```

**Stop a session** (session closed, project switched):

```typescript
// 1. Push terminate signal to the prompt queue
await Queue.offer(context.promptQueue, { type: "terminate" });

// 2. Abort the AbortController used when query() was called
abortController.abort();

// 3. Close the query runtime
context.query.close();

// 4. Interrupt any running stream fiber
if (context.streamFiber) {
  await Fiber.interrupt(context.streamFiber);
}

context.stopped = true;
```

**Change model mid-session:**

```typescript
await context.query.setModel("claude-opus-4-5");
```

**Change permission mode mid-session:**

```typescript
await context.query.setPermissionMode("bypassPermissions");
```

---

## Orchestration Architecture

### Command → Event Pipeline

All operations go through a strict pipeline. Nothing talks directly to the provider from outside the pipeline:

```
1. Client: orchestration.dispatchCommand (WebSocket)
         ↓
2. OrchestrationEngine
   - Validate command against current state
   - Persist intent event to SQLite
   - Update in-memory read model projection
   - Publish domain event to subscribers
         ↓
3. ProviderCommandReactor (subscribes to domain events)
   - Reacts to ThreadTurnStartRequested → calls ProviderService.startSession()
   - Reacts to TurnSendRequested → calls ProviderService.sendTurn()
   - Reacts to ApprovalResponseProvided → resolves pending approval Deferred
   - Reacts to SessionStopRequested → calls ProviderService.stopSession()
         ↓
4. ProviderService (adapter routing)
   - Routes to ClaudeAdapter or CodexAdapter based on ProviderKind
   - Persists session binding in ProviderSessionDirectory (SQLite)
         ↓
5. ClaudeAdapter (SDK calls)
   - All Claude Code interactions happen here
   - Emits ProviderRuntimeEvent stream
         ↓
6. ProviderRuntimeIngestion (consumes adapter stream)
   - Translates ProviderRuntimeEvents to orchestration commands
   - Re-enters the pipeline via OrchestrationEngine
         ↓
7. OrchestrationEngine → ServerPushBus → Browser
```

### Queue-Backed Workers

Three long-running workers process work asynchronously:

| Worker                     | Purpose                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `ProviderRuntimeIngestion` | Consumes provider runtime streams, emits orchestration commands     |
| `ProviderCommandReactor`   | Reacts to orchestration events, dispatches provider calls           |
| `CheckpointReactor`        | Captures git checkpoints on turn start/complete, publishes receipts |

All three use `DrainableWorker` from `@t3tools/shared/DrainableWorker` — a queue-backed worker that exposes `drain()` for deterministic test synchronization. This is critical for making tests wait for all async work to settle without polling.

```typescript
// From packages/shared/src/DrainableWorker.ts
interface DrainableWorker {
  drain(): Promise<void>; // Resolves when queue is empty and no work is in-flight
}
```

### Provider Command Reactor

**File:** `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

Handles the mapping from orchestration domain intent to provider operations:

```typescript
// Provider selection (inferred from model string or explicit provider field)
const provider = inferProviderForModel(model) ?? defaultProvider;
// "claude-*" models → "claudeAgent"
// "gpt-*"   models → "codex"

// Provider-aware start:
await providerService.startSession({
  threadId,
  provider, // "claudeAgent" | "codex"
  cwd: project.cwd,
  model,
  providerOptions: {
    claudeAgent: {
      binaryPath: settings.claudeBinaryPath,
      permissionMode: settings.permissionMode,
      maxThinkingTokens: settings.maxThinkingTokens,
    },
  },
  resumeCursor: existingSession?.resumeCursor, // opaque, adapter-owned
});
```

Worktree branch naming convention:

```typescript
const WORKTREE_BRANCH_PREFIX = "t3code";
// Generated branches: "t3code/feature-name" or "t3code/<8-char-hex-hash>"
const TEMP_WORKTREE_BRANCH_PATTERN = /^t3code\/[0-9a-f]{8}$/;
```

---

## WebSocket Protocol

### Transport Layer

**File:** `apps/web/src/wsTransport.ts`

Connection states: `connecting → open → reconnecting → closed → disposed`

- Outbound requests are queued while disconnected and flushed on reconnect
- Inbound pushes are decoded and validated against Effect Schema at the boundary
- Subscribers can opt into `replayLatest` to get the last push on subscribe
- Decode failures produce structured `WsDecodeDiagnostic` with `code`, `reason`, path info

### Message Format

**Requests (client → server):** JSON-RPC style

```json
{ "id": "req-123", "method": "orchestration.dispatchCommand", "params": { ... } }
```

**Responses (server → client):**

```json
{ "id": "req-123", "result": { ... } }
// or
{ "id": "req-123", "error": { "code": -32600, "message": "..." } }
```

**Push events (server → client):** Typed envelopes

```json
{
  "channel": "orchestration.domainEvent",
  "sequence": 42,       // monotonic per connection
  "data": { ... }       // channel-specific, schema-validated
}
```

### Push Channels

| Channel                     | Purpose                            |
| --------------------------- | ---------------------------------- |
| `server.welcome`            | Initial state hydration on connect |
| `server.configUpdated`      | Settings changed                   |
| `terminal.event`            | PTY terminal output                |
| `orchestration.domainEvent` | All session/turn/approval events   |

### NativeApi Methods (WebSocket RPC)

```typescript
// Provider operations
providers.startSession(input);
providers.sendTurn(input);
providers.interruptTurn(input);
providers.respondToRequest(input); // approval responses
providers.stopSession(input);

// System
shell.openInEditor(input);
server.getConfig();
```

---

## Persistence (SQLite)

**File:** `apps/server/src/persistence/Layers/Sqlite.ts`

Uses `@effect/sql-sqlite-bun` for SQLite. Database path: `~/.t3/userdata/state.sqlite`

### Provider Session Table Schema

```sql
-- ProviderSessionRuntime table
CREATE TABLE provider_session_runtime (
  thread_id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,          -- "codex" | "claudeAgent"
  adapter_key TEXT NOT NULL,            -- unique per session
  runtime_mode TEXT NOT NULL,           -- "full-access" | "approval-required"
  status TEXT NOT NULL,                 -- "connecting"|"ready"|"running"|"error"|"closed"
  last_seen_at TEXT NOT NULL,           -- ISO timestamp
  resume_cursor_json TEXT,              -- OPAQUE — adapter-owned, never parsed outside adapter
  runtime_payload_json TEXT             -- additional runtime metadata
);
```

### Event Store (Orchestration)

All orchestration events are stored as an append-only event log. The current state is always re-derived from events (event sourcing). This enables:

- Session recovery after crashes
- Checkpoint revert (roll back to any prior state)
- Full audit trail of all agent actions

---

## Directory & File Layout

```
~/.t3/                          (T3CODE_HOME)
├── userdata/                   (or "dev/" in development)
│   ├── state.sqlite            Main database (sessions, events, projects)
│   ├── keybindings.json        User keyboard shortcut overrides
│   ├── anonymous-id            Telemetry anonymous ID
│   ├── logs/
│   │   ├── server.log          Rotating server log
│   │   ├── terminals/          Per-PTY-session log files
│   │   └── provider/
│   │       └── events.log      Provider runtime events (NDJSON format)
│   └── attachments/            Image/file attachments for turns
└── worktrees/                  Git worktrees
    └── t3code/
        └── <branch-name>/      Isolated git worktree checkouts
```

```
/repo-root/
├── CLAUDE.md                   Claude Code guidance (read by claude CLI)
├── AGENTS.md                   Agent development guidelines (read by Codex/general agents)
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── main.ts                     CLI entry + config parsing
│   │       ├── config.ts                   Runtime configuration service
│   │       ├── serverLayers.ts             Effect service composition
│   │       ├── wsServer.ts                 WebSocket server + routing
│   │       ├── codexAppServerManager.ts    Codex process lifecycle
│   │       ├── processRunner.ts            Generic process spawning utilities
│   │       ├── provider/
│   │       │   ├── Services/ClaudeAdapter.ts       Service tag definition
│   │       │   ├── Layers/ClaudeAdapter.ts         Full implementation (94KB)
│   │       │   ├── Services/ProviderService.ts     Cross-provider service contract
│   │       │   ├── Layers/ProviderService.ts       Routing implementation
│   │       │   └── Layers/ProviderAdapterRegistry.ts  Provider lookup
│   │       ├── orchestration/
│   │       │   ├── Layers/OrchestrationEngine.ts   Event sourcing core
│   │       │   ├── Layers/ProviderCommandReactor.ts Command handling
│   │       │   ├── Layers/ProviderRuntimeIngestion.ts Stream ingestion
│   │       │   ├── Layers/CheckpointReactor.ts     Git checkpoint management
│   │       │   └── Layers/RuntimeReceiptBus.ts     Typed completion signals
│   │       └── persistence/
│   │           ├── Layers/Sqlite.ts                Database setup + migrations
│   │           └── Layers/ProviderSessionRuntime.ts Session storage
│   ├── web/                    React SPA
│   └── desktop/
│       └── src/main.ts         Electron main process
├── packages/
│   ├── contracts/src/
│   │   ├── orchestration.ts    Orchestration command/event schemas
│   │   ├── provider.ts         Provider contracts + session types
│   │   ├── providerRuntime.ts  Runtime event type definitions
│   │   ├── model.ts            Model definitions + provider mapping
│   │   └── ws.ts               WebSocket protocol schemas
│   └── shared/src/
│       ├── DrainableWorker.ts  Queue-backed async worker
│       ├── model.ts            Model resolution utilities
│       └── git.ts              Git operations
└── .plans/
    └── 17-claude-agent.md      Full Claude integration plan (7 phases)
```

---

## Configuration Files

### CLAUDE.md

Located at the repo root. Claude Code reads this automatically when running in the project directory. Use it for:

- Build/test/lint commands the agent needs to know
- Architecture overview and key design decisions
- Environment variables reference
- Code style preferences
- What the agent should/shouldn't do

```markdown
# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Commands

bun run dev # All apps in parallel
bun run test # All tests (never use `bun test` directly)
bun fmt # Format
bun lint # Lint
bun typecheck # Type check

## Architecture

...
```

**Important:** `CLAUDE.md` is a guidance file for Claude Code, not a configuration file for the SDK. The SDK reads it from the working directory as part of its system context.

### AGENTS.md

Also at the repo root. Read by Codex and general agents (not Claude-specific). Contains:

- Task completion requirements
- Project-wide conventions
- Reference repos/docs
- Things the agent must always do or never do

```markdown
# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before completing tasks.
- NEVER run `bun test`. Always use `bun run test`.
```

### Runtime Config (settings.json equivalent)

t3code doesn't use a `settings.json` — runtime configuration is stored in SQLite and managed through the web UI. The equivalent of Claude Code's `.claude/settings.json` for this system is:

```typescript
// Server config shape — populated from env vars + CLI flags
interface ServerConfigShape {
  mode: "web" | "desktop";
  port: number;
  host: string | undefined;
  t3Home: string; // ~/.t3
  authToken: string | undefined;
  noBrowser: boolean;
  logWebSocketEvents: boolean;
  // Derived paths:
  stateDir: string; // ~/.t3/userdata
  sqlitePath: string; // ~/.t3/userdata/state.sqlite
  logsDir: string; // ~/.t3/userdata/logs
  attachmentsDir: string; // ~/.t3/userdata/attachments
  worktreesDir: string; // ~/.t3/worktrees
}
```

### VSCode Settings (`.vscode/settings.json`)

Project-level VS Code settings for the repo contributors. Not related to Claude Code runtime — just editor preferences, TypeScript paths, etc.

---

## Startup & Shutdown Flow

### Web Mode (direct CLI)

```bash
# Development
bun run dev          # Turbo: starts server + web + desktop in parallel
bun run dev:server   # Server only (with Vite HMR proxy)
bun run dev:web      # Web app only (Vite dev server, port 5733)

# Production
node dist/index.mjs --mode web --port 3773
```

### Desktop Mode (Electron)

1. Electron main process starts (`apps/desktop/src/main.ts`)
2. `startBackend()` spawns the server as a child process
3. Server reads `T3CODE_MODE=desktop`, `T3CODE_AUTH_TOKEN`, `T3CODE_PORT`
4. Server binds to `127.0.0.1:$PORT` (desktop: local only)
5. Electron opens `BrowserWindow` pointing to `http://127.0.0.1:$PORT`
6. Browser connects to WebSocket at the same origin
7. Server sends `server.welcome` → browser hydrates initial state

**Startup sequence inside the server:**

```
index.ts → parse CLI flags + env vars
  → resolve ServerConfig
  → makeServerProviderLayer() (compose Effect service layers)
  → SqlitePersistence.live (open/migrate SQLite)
  → ServerReadiness (wait for barriers)
  → wsServer starts
  → OrchestrationEngine starts (replay events from SQLite)
  → ProviderCommandReactor starts (subscribe to domain events)
  → CheckpointReactor starts
  → send server.welcome to connected clients
```

### Shutdown

```
SIGTERM received
  → stop accepting new connections
  → ProviderCommandReactor: stopAll() for all active sessions
  → ClaudeAdapter: abort all AbortControllers, push terminate to all prompt queues
  → wait for in-flight Effect fibers to drain
  → SQLite connection closed
  → process exits
```

---

## Worktree Management

Git worktrees allow Claude to work in isolated branches without affecting the main checkout.

**Directory:** `~/.t3/worktrees/t3code/<branch-name>/`

**Branch naming:**

```
t3code/feature-name        # Named worktrees
t3code/<8-char-hex-hash>   # Temporary auto-generated worktrees
```

**Pattern for temporary branches:**

```typescript
const TEMP_WORKTREE_BRANCH_PATTERN = /^t3code\/[0-9a-f]{8}$/;
```

The `GitManager` service (in `packages/shared/src/git.ts`) handles:

- Creating worktrees (`git worktree add`)
- Detecting worktree vs. main checkout
- Commit, diff, status operations
- Cleanup of temporary worktrees

Worktrees are passed to Claude as `cwd` in the session start input, so the agent works in the isolated branch.

---

## Checkpoint System

**File:** `apps/server/src/orchestration/Layers/CheckpointReactor.ts`

Checkpoints capture git state at important milestones so users can roll back.

**Checkpoint triggers:**

- Automatic: Before each turn starts (pre-turn snapshot)
- Automatic: After each turn completes (post-turn snapshot)
- Manual: Via `checkpoint.create` command from the UI

**Stored per checkpoint:**

- Git commit hash (or tree hash if uncommitted)
- Turn ID association
- ISO timestamp
- Diff from previous checkpoint

**Rollback strategy for Claude:**

- Option A: If SDK supports session rewind natively — use `resumeSessionAt` with a prior timestamp
- Option B: Stop session, clear/rewrite `resumeCursor` to last safe resumable point, force fresh session start from orchestration state

**Runtime receipts:**

The `RuntimeReceiptBus` emits typed signals when async milestones complete:

```typescript
type RuntimeReceipt =
  | { type: "checkpoint.captured"; turnId: TurnId; commitHash: string }
  | { type: "turn.quiescent"; turnId: TurnId }
  | { type: "diff.finalized"; turnId: TurnId };
```

Tests and orchestration code wait on these receipts instead of polling.

---

## Logging

### Server Logs

**Location:** `~/.t3/userdata/logs/server.log` (packaged desktop builds)

**Format:** Structured JSON via Effect Logger

In development, logs go to stdout/stderr (inherited from Electron).

### Provider Event Log

**Location:** `~/.t3/userdata/logs/provider/events.log`

**Format:** NDJSON (Newline-Delimited JSON) — one event object per line

Every `ProviderRuntimeEvent` is logged here with timestamp. Useful for debugging Claude interactions.

### Terminal Logs

**Location:** `~/.t3/userdata/logs/terminals/<session-id>.log`

Per-PTY-session logs for terminal output.

### Desktop Backend Logs

In packaged Electron builds, the server's stdout/stderr is captured to rotating log files in the app's data directory (not `~/.t3`). File rotation is handled in `captureBackendOutput()` in the Electron main process.

---

## How to Replicate This Architecture

To build a project that spawns and manages Claude Code similarly, here is the exact recipe:

### 1. Install the Claude Agent SDK

```bash
npm install @anthropic-ai/claude-agent-sdk
# or
bun add @anthropic-ai/claude-agent-sdk
```

Current version used: `^0.2.77`

### 2. Call `query()` with a multi-turn prompt queue

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Create a prompt input queue for multi-turn
const promptQueue: Array<{ resolve: (msg: SDKUserMessage | null) => void }> = [];

async function* makePrompt(): AsyncIterable<SDKUserMessage> {
  while (true) {
    const item = await new Promise<SDKUserMessage | null>((resolve) => {
      promptQueue.push({ resolve });
    });
    if (item === null) break; // terminate signal
    yield item;
  }
}

const session = query({
  prompt: makePrompt(),
  options: {
    cwd: "/path/to/project",
    model: "claude-opus-4-5",
    permissionMode: "default", // or "bypassPermissions" for full access
    includePartialMessages: true,
    signal: abortController.signal,
    canUseTool: async (toolName, input) => {
      // return { behavior: "allow" } or { behavior: "deny", message: "..." }
      return { behavior: "allow" };
    },
  },
});

// Consume the message stream
for await (const message of session) {
  switch (message.type) {
    case "assistant":
      // handle assistant text/tool-use
      break;
    case "result":
      // turn complete: message.subtype === "success" | "error_during_execution"
      break;
    case "system":
      // message.subtype === "init" — contains session_id for resumption
      break;
  }
}

// Send a turn:
promptQueue.shift()?.resolve({
  type: "user",
  session_id: "",
  parent_tool_use_id: null,
  message: { role: "user", content: [{ type: "text", text: "Hello!" }] },
} as SDKUserMessage);

// Interrupt a running turn:
await session.interrupt();

// Change model mid-session:
await session.setModel("claude-sonnet-4-5");

// Change permission mode mid-session:
await session.setPermissionMode("bypassPermissions");

// End session:
abortController.abort();
```

### 3. Handle Resume

Store `session_id` from the `system init` message. Pass it back as `resume` to continue:

```typescript
// First session — capture session_id:
let savedSessionId: string | undefined;
for await (const message of session) {
  if (message.type === "system" && message.subtype === "init") {
    savedSessionId = message.session_id;
  }
}

// Resumed session:
const resumedSession = query({
  prompt: makePrompt(),
  options: {
    cwd: "/path/to/project",
    resume: savedSessionId,
    // resumeSessionAt: "2026-03-22T12:00:00Z", // optional: resume from specific point
  },
});
```

### 4. Spawn a Server Process (Optional Electron Wrapper)

If you're building an Electron app that wraps a Node.js server:

```typescript
import * as ChildProcess from "node:child_process";

const child = ChildProcess.spawn(process.execPath, ["/path/to/server.mjs"], {
  cwd: projectDir,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1", // critical for Electron
    MY_APP_PORT: String(port),
    MY_APP_AUTH_TOKEN: authToken,
  },
  stdio: "inherit", // or ["ignore", "pipe", "pipe"] to capture logs
});

// Restart on unexpected exit
child.on("exit", (code, signal) => {
  if (!isQuitting) scheduleRestart();
});

// Graceful shutdown
child.kill("SIGTERM");
setTimeout(() => child.kill("SIGKILL"), 2000);
```

### 5. Create CLAUDE.md at Your Repo Root

```markdown
# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

npm test # Run tests
npm run build # Build
npm run lint # Lint

## Architecture

[Your architecture description here]

## Important Rules

[What Claude should/shouldn't do]
```

### 6. Handle Tool Approval for Supervised Mode

```typescript
const pendingApprovals = new Map<
  string,
  {
    resolve: (result: { behavior: "allow" | "deny" }) => void;
  }
>();

const canUseTool = async (toolName: string, input: unknown) => {
  const requestId = crypto.randomUUID();

  // Send approval request to the UI
  sendToUI({ type: "approval_requested", requestId, toolName, input });

  // Wait for user response
  const result = await new Promise<{ behavior: "allow" | "deny" }>((resolve) => {
    pendingApprovals.set(requestId, { resolve });
  });

  pendingApprovals.delete(requestId);
  return result;
};

// When UI responds:
function handleApprovalResponse(requestId: string, approved: boolean) {
  pendingApprovals.get(requestId)?.resolve({
    behavior: approved ? "allow" : "deny",
  });
}
```

### 7. Key Architectural Decisions to Copy

1. **Opaque resume cursor** — store Claude's `session_id` as an opaque blob; never let higher layers parse it
2. **Provider-agnostic orchestration** — define canonical event types that multiple providers can emit; keep provider-specific logic entirely within adapter boundaries
3. **Queue-backed workers** — use bounded queues for ingestion/reaction to keep work ordered and prevent races
4. **Event sourcing** — store all events to SQLite; derive state by replaying events; enables recovery and rollback
5. **WebSocket-only protocol** — no REST for stateful operations; push events to all subscribers when state changes
6. **DrainableWorker** — expose `drain()` from all background workers for deterministic test synchronization
7. **SIGTERM → wait 2s → SIGKILL** — graceful shutdown pattern for all child processes
8. **Exponential backoff restart** — cap at 10s, reset counter on successful spawn

---

_Generated from codebase analysis — see `.plans/17-claude-agent.md` for the full integration plan and `.docs/` for additional architecture documentation._

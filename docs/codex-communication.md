# Codex Communication Architecture

This document explains how t3code communicates with the Codex AI agent, tracing the full message flow from the web client through the server to the Codex process and back.

---

## Overview

Codex runs as a subprocess (`codex app-server`) communicating over **JSON-RPC 2.0 via stdio** (newline-delimited JSON on stdin/stdout). The server wraps this in three layers before events reach the web client over WebSocket.

```
Web Client (React SPA, port 5733)
    ↕  WebSocket / Effect RPC
Server (ws.ts)
    ↕  ProviderService  (cross-provider router)
    ↕  CodexAdapter     (native → canonical event mapping)
    ↕  CodexAppServerManager  (JSON-RPC over stdio)
Codex Process  (`codex app-server`)
```

---

## Key Files

| File                                                 | Role                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/server/src/codexAppServerManager.ts`           | Spawns and manages the Codex child process; sends/receives raw JSON-RPC                 |
| `apps/server/src/provider/Layers/CodexAdapter.ts`    | Wraps the manager; maps Codex-native `ProviderEvent` → canonical `ProviderRuntimeEvent` |
| `apps/server/src/provider/Layers/ProviderService.ts` | Cross-provider router; publishes runtime events via PubSub                              |
| `apps/server/src/ws.ts`                              | Effect RPC server over WebSocket; routes client calls to provider services              |
| `packages/contracts/src/provider.ts`                 | Native `ProviderEvent` schemas                                                          |
| `packages/contracts/src/providerRuntime.ts`          | Canonical `ProviderRuntimeEvent` schemas (40+ event types)                              |
| `packages/contracts/src/rpc.ts`                      | WebSocket RPC method definitions (`WsRpcGroup`)                                         |
| `apps/server/src/provider/codexAppServer.ts`         | Utilities: initialize params, process kill, account probe                               |
| `apps/server/src/provider/codexAccount.ts`           | Account snapshot parsing, model filtering by subscription tier                          |
| `apps/server/src/provider/codexCliVersion.ts`        | Semver parsing, minimum version enforcement (≥ 0.37.0)                                  |

---

## Layer 1 — CodexAppServerManager (stdio JSON-RPC)

### Process Lifecycle

`CodexAppServerManager` spawns `codex app-server` as a child process and communicates via `readline` on its stdout:

```
spawn("codex app-server")
  ├─ Send:    { id: 1, method: "initialize",    params: buildCodexInitializeParams() }
  ├─ Receive: { id: 1, result: { ... } }
  ├─ Send:    { method: "initialized" }                  ← notification (no id)
  ├─ Send:    { id: 2, method: "account/read",  params: {} }
  ├─ Receive: { id: 2, result: { ... } }                 → readCodexAccountSnapshot()
  ├─ Send:    { id: 3, method: "model/list",    params: {} }
  ├─ Receive: { id: 3, result: { models: [...] } }
  ├─ Send:    { id: 4, method: "thread/start" | "thread/resume", params: { ... } }
  ├─ Receive: { id: 4, result: { thread: { id: "t-..." } } }
  └─ Emit:    session.ready
```

### JSON-RPC Message Types

```typescript
// Client → Codex: request (expects response)
{ id: string | number; method: string; params?: unknown }

// Codex → Client: response
{ id: string | number; result?: unknown; error?: { code, message, data? } }

// Codex → Client: notification (no id, no response sent)
{ method: string; params?: unknown }
```

Outgoing requests are tracked in a `Map<id, PendingRpcRequest>` with timeouts (default 30 s). Incoming lines are parsed, and routed to either `handleServerResponse`, `handleServerNotification`, or `handleServerRequest`.

### Turn Lifecycle

```
Client calls sendTurn()
  ├─ Send:    { id: N, method: "turn/start", params: {
  │               threadId, input: [...], model, effort,
  │               collaborationMode: { mode, settings }
  │           } }
  ├─ Receive: { id: N, result: { turn: { id: "turn-..." } } }
  └─ Emit:    session.running (activeTurnId set)

Codex streams notifications:
  { method: "turn/started",             params: { turn: { id, model } } }
  { method: "item/agentMessage/delta",  params: { delta: "..." } }
  { method: "item/reasoning/textDelta", params: { delta: "..." } }
  { method: "item/commandExecution/outputDelta", params: { delta: "..." } }
  ...
  { method: "turn/completed",           params: { turn: { id, status } } }
```

### Approval & User-Input Requests

Codex uses **server-side JSON-RPC requests** (Codex sends a request; the server must reply) for gated operations:

```
Codex → Server (request, id=10):
  { id: 10, method: "item/commandExecution/requestApproval",
    params: { command: "npm test", ... } }

  CodexAppServerManager:
    ├─ Store in pendingApprovals map  { jsonRpcId: 10, requestId: "req-uuid", ... }
    ├─ Emit ProviderEvent { kind: "request", method: "item/commandExecution/requestApproval" }
    └─ (waits; response sent when client approves)

Client approves via ProviderService.respondToRequest()
  → Send: { id: 10, result: { decision: "approved" } }
  → Emit: request.resolved runtime event
```

User-input requests follow the same pattern via `item/tool/requestUserInput` / `respondToUserInput()`.

---

## Layer 2 — CodexAdapter (event normalization)

`CodexAdapter` subscribes to the manager's `EventEmitter` and normalises every `ProviderEvent` into a canonical `ProviderRuntimeEvent` through `mapToRuntimeEvents()`:

| Codex method                            | Canonical event type    | Notes                                       |
| --------------------------------------- | ----------------------- | ------------------------------------------- |
| `turn/started`                          | `turn.started`          |                                             |
| `turn/completed`                        | `turn.completed`        |                                             |
| `item/started`                          | `item.started`          |                                             |
| `item/completed`                        | `item.completed`        |                                             |
| `item/agentMessage/delta`               | `content.delta`         | `streamKind: "assistant_text"`              |
| `item/reasoning/textDelta`              | `content.delta`         | `streamKind: "reasoning_text"`              |
| `item/commandExecution/outputDelta`     | `content.delta`         | `streamKind: "command_output"`              |
| `item/fileChange/outputDelta`           | `content.delta`         | `streamKind: "file_change_output"`          |
| `item/commandExecution/requestApproval` | `request.opened`        | `requestType: "command_execution_approval"` |
| `item/fileChange/requestApproval`       | `request.opened`        | `requestType: "file_change_approval"`       |
| `item/fileRead/requestApproval`         | `request.opened`        | `requestType: "file_read_approval"`         |
| `item/tool/requestUserInput`            | `user-input.requested`  | includes questions array                    |
| `thread/started`                        | `thread.started`        |                                             |
| `session/connecting`                    | `session.state.changed` | `state: "starting"`                         |
| `session/ready`                         | `session.state.changed` | `state: "ready"`                            |

The adapter also handles attachment resolution (base64-encodes local image files before sending to Codex).

---

## Layer 3 — ProviderService (cross-provider routing)

`ProviderService` is the single entrypoint for all provider operations from `ws.ts`. It:

1. Resolves the correct adapter (`"codex"` | `"claude"`) from the session directory.
2. Delegates operations: `startSession`, `sendTurn`, `interruptTurn`, `respondToRequest`, `respondToUserInput`, `stopSession`.
3. Publishes all `ProviderRuntimeEvent` objects to an Effect `PubSub` so multiple subscribers (orchestration, checkpointing, WebSocket push) receive every event.

---

## Layer 4 — WebSocket RPC (ws.ts)

The web client connects to `GET /ws` (with an optional `?token=` query param). Effect's `RpcServer` handles method dispatch via `WsRpcGroup`. Provider-related calls flow through `ProviderService` or the orchestration layer, which internally fans events back out to all subscribers over the WebSocket connection.

---

## Full Turn Message Flow (End-to-End)

```
Browser
  │  WS RPC: sendTurn({ threadId, input: "write tests", modelSelection })
  ▼
ws.ts  →  ProviderService.sendTurn()
  │
  ▼
CodexAdapter.sendTurn()
  ├─ Resolve attachments (base64 images)
  ▼
CodexAppServerManager.sendTurn()
  ├─ → stdin: { id:N, method:"turn/start", params:{...} }
  ├─ ← stdout: { id:N, result:{ turn:{ id:"turn-1" } } }
  └─ Emit ProviderEvent: session.running
  │
  ▼  (Codex streams notifications on stdout)
  ├─ "turn/started"             → turn.started
  ├─ "item/agentMessage/delta"  → content.delta (assistant_text)
  ├─ "item/commandExecution/requestApproval"
  │     → request.opened  →  PubSub  →  WS push to browser
  │        browser responds
  │     → CodexAppServerManager sends JSON-RPC response
  │     → request.resolved  →  PubSub  →  WS push
  ├─ "item/commandExecution/outputDelta" → content.delta (command_output)
  └─ "turn/completed"           → turn.completed
  │
  ▼
PubSub  →  WebSocket push  →  Browser
```

---

## Session Persistence & Resume

`ProviderSessionDirectory` persists:

- `threadId` — the Codex thread identifier (`t-...`)
- `resumeCursor` — opaque cursor from the last completed turn, passed to `thread/resume` on reconnect
- Serialized session state and event log

On reconnect, `CodexAppServerManager.startSession()` sends `thread/resume` instead of `thread/start`, allowing Codex to continue an existing conversation.

---

## Codex CLI Version Requirements

`codexCliVersion.ts` enforces a minimum version of **0.37.0**. If the installed Codex CLI is older, session startup is rejected with a descriptive error before any process is spawned.

---

## Event Schema Reference

### ProviderEvent (native, `packages/contracts/src/provider.ts`)

```typescript
interface ProviderEvent {
  id: EventId;
  kind: "session" | "notification" | "request" | "error";
  provider: "codex";
  threadId: ThreadId;
  createdAt: IsoDateTime;
  method: string; // e.g. "item/agentMessage/delta"
  message?: string;
  turnId?: TurnId;
  itemId?: ProviderItemId;
  requestId?: ApprovalRequestId;
  requestKind?: ProviderRequestKind;
  textDelta?: string;
  payload?: unknown; // raw Codex params
}
```

### ProviderRuntimeEvent (canonical, `packages/contracts/src/providerRuntime.ts`)

All events share a common envelope:

```typescript
interface ProviderRuntimeEventBase {
  type: string; // e.g. "content.delta"
  eventId: EventId;
  provider: ProviderKind; // "codex" | "claude"
  threadId: ThreadId;
  createdAt: IsoDateTime;
  turnId?: TurnId;
  itemId?: RuntimeItemId;
  requestId?: RuntimeRequestId;
  providerRefs?: { providerTurnId?; providerItemId?; providerRequestId? };
  raw?: { source; method; payload };
  payload: TypeSpecificPayload;
}
```

Full list of ~40 event types includes: `session.started`, `session.state.changed`, `session.exited`, `thread.started`, `thread.state.changed`, `thread.token-usage.updated`, `turn.started`, `turn.completed`, `turn.aborted`, `turn.plan.updated`, `turn.proposed.delta`, `turn.proposed.completed`, `item.started`, `item.updated`, `item.completed`, `content.delta`, `request.opened`, `request.resolved`, `user-input.requested`, `user-input.resolved`, `task.started`, `task.progress`, `task.completed`, `account.updated`, `account.rate-limits.updated`, `model.rerouted`, `config.warning`, `deprecation.notice`, `mcp.oauth.completed`.

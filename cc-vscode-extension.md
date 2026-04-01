# VS Code Extension: Claude Code Orchestration

### A Roadmap for Replicating t3code's Architecture Inside VS Code

---

> **What this document is:** A full plan and guide for building a VS Code extension that spawns, manages, and orchestrates Claude Code (via `@anthropic-ai/claude-agent-sdk`) using the same patterns as t3code — multi-turn sessions, approval flows, resume cursors, canonical event streaming, WebView UI — adapted for the VS Code extension host environment.

---

## Table of Contents

1. [Mental Model: t3code → VS Code](#mental-model-t3code--vs-code)
2. [Extension Architecture Overview](#extension-architecture-overview)
3. [Phase 0: Project Scaffold](#phase-0-project-scaffold)
4. [Phase 1: SDK Integration & Session Spawning](#phase-1-sdk-integration--session-spawning)
5. [Phase 2: Multi-Turn Prompt Queue](#phase-2-multi-turn-prompt-queue)
6. [Phase 3: Permission & Approval System](#phase-3-permission--approval-system)
7. [Phase 4: Session Persistence & Resume](#phase-4-session-persistence--resume)
8. [Phase 5: WebView UI Panel](#phase-5-webview-ui-panel)
9. [Phase 6: Canonical Event Mapping](#phase-6-canonical-event-mapping)
10. [Phase 7: Orchestration Layer](#phase-7-orchestration-layer)
11. [Phase 8: Hooks & Lifecycle Signals](#phase-8-hooks--lifecycle-signals)
12. [Phase 9: CLAUDE.md Awareness](#phase-9-claudemd-awareness)
13. [Phase 10: Status Bar, Commands & Keybindings](#phase-10-status-bar-commands--keybindings)
14. [Phase 11: Configuration via VS Code Settings](#phase-11-configuration-via-vs-code-settings)
15. [Phase 12: Interrupt, Stop & Restart](#phase-12-interrupt-stop--restart)
16. [Phase 13: Worktree & Git Integration](#phase-13-worktree--git-integration)
17. [Phase 14: Testing Strategy](#phase-14-testing-strategy)
18. [Architecture Cheat Sheet: t3code vs Extension](#architecture-cheat-sheet-t3code-vs-extension)
19. [Gotchas & Things That'll Bite You](#gotchas--things-thatll-bite-you)

---

## Mental Model: t3code → VS Code

Before writing a single line, understand what maps where. t3code is a standalone Node.js server with a React web frontend. A VS Code extension has its own runtime model with strict boundaries you have to work within.

```
t3code                              VS Code Extension Equivalent
──────────────────────────────      ──────────────────────────────────────────
Electron main process            →  Extension Host (Node.js, runs your extension)
Node.js WebSocket server         →  Extension Host (same process, no need for WS)
React web app (browser)          →  WebviewPanel (sandboxed iframe inside VS Code)
WebSocket (browser ↔ server)     →  postMessage / onDidReceiveMessage (webview ↔ host)
SQLite (state.sqlite)            →  context.globalState / context.workspaceState (or SQLite via better-sqlite3)
ChildProcess.spawn (Electron)    →  (Not needed — extension host is already Node.js)
@anthropic-ai/claude-agent-sdk   →  @anthropic-ai/claude-agent-sdk (same, runs in host)
T3CODE_HOME (~/.t3)              →  context.globalStorageUri.fsPath
WorkspaceFolder (project cwd)    →  vscode.workspace.workspaceFolders[0].uri.fsPath
CLAUDE.md in repo root           →  CLAUDE.md in workspace root (SDK reads it automatically)
ServerPushBus                    →  EventEmitter or vscode.EventEmitter inside host
ProviderCommandReactor           →  SessionManager class (your orchestration layer)
OrchestrationEngine              →  CommandQueue + EventEmitter
```

**The big win:** In a VS Code extension, there is no separate server process to spawn. The extension host _is_ the Node.js process. You call `query()` directly. The architecture simplifies significantly — but you still want the same separation of concerns.

---

## Extension Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host (Node.js)                                  │
│                                                                    │
│  ┌──────────────────┐    ┌─────────────────────────────────────┐  │
│  │  CommandRegistry  │    │         SessionManager              │  │
│  │  (VS Code cmds)  │───▶│  startSession / sendTurn / stop     │  │
│  └──────────────────┘    │  pendingApprovals Map               │  │
│                           │  resumeCursorStore                  │  │
│  ┌──────────────────┐    │  promptQueue (AsyncIterable)        │  │
│  │  EventBus        │◀───│  streamFiber (background loop)      │  │
│  │  (typed emitter) │    └──────────────┬──────────────────────┘  │
│  └────────┬─────────┘                   │ query() call            │
│           │                             ▼                          │
│           │                   @anthropic-ai/claude-agent-sdk       │
│           │                   (manages claude process internally)   │
│           │                                                        │
│  ┌────────▼────────────────────────────────────────────────────┐  │
│  │  WebviewPanel ("Claude Code")                                │  │
│  │  postMessage ↔ onDidReceiveMessage                          │  │
│  │  React/Svelte/Vanilla SPA (bundled into extension)          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Persistence Layer                                            │  │
│  │  context.globalState.update() for small state               │  │
│  │  better-sqlite3 at globalStorageUri for full event store     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

**Data flow for a user turn:**

```
User types in WebviewPanel
  → webview postMessage({ type: "sendTurn", text: "..." })
  → extension onDidReceiveMessage handler
  → SessionManager.sendTurn()
  → pushes to promptQueue
  → Claude SDK receives next prompt
  → SDK messages stream back (async for-await loop)
  → mapped to canonical ClaudeEvent objects
  → EventBus.emit("turn.delta", event)
  → webview panel.webview.postMessage({ type: "turn.delta", ... })
  → React component re-renders
```

---

## Phase 0: Project Scaffold

### Recommended Stack

| Concern            | Choice                           | Why                                       |
| ------------------ | -------------------------------- | ----------------------------------------- |
| Extension language | TypeScript                       | Required for VS Code types                |
| Bundler            | `esbuild`                        | Fast, handles CJS/ESM, VS Code standard   |
| WebView UI         | React + Vite OR Svelte           | Same as t3code (React) or leaner (Svelte) |
| State (simple)     | `context.globalState`            | Built-in, no deps                         |
| State (full)       | `better-sqlite3`                 | Same as t3code pattern, works in Node.js  |
| SDK                | `@anthropic-ai/claude-agent-sdk` | The exact same package as t3code          |

### File Structure

```
my-claude-extension/
├── package.json               Extension manifest (contributes, activationEvents)
├── tsconfig.json
├── esbuild.config.js          Build: extension host + webview bundled separately
├── src/
│   ├── extension.ts           Entry point — activate() / deactivate()
│   ├── sessionManager.ts      Core: spawns Claude, manages session lifecycle
│   ├── promptQueue.ts         Multi-turn async-iterable queue
│   ├── approvalManager.ts     canUseTool implementation
│   ├── eventBus.ts            Typed event emitter
│   ├── persistence.ts         Resume cursor + state storage
│   ├── canonicalEvents.ts     SDK message → canonical event mapping
│   ├── hooks.ts               Claude lifecycle hooks
│   ├── panel.ts               WebviewPanel creation + postMessage bridge
│   └── commands.ts            VS Code command registrations
└── webview-ui/
    ├── src/
    │   ├── main.tsx            Webview entry point
    │   ├── App.tsx             Main chat component
    │   ├── transport.ts        postMessage abstraction (mirrors wsTransport.ts)
    │   └── components/
    │       ├── ChatView.tsx
    │       ├── ApprovalDialog.tsx
    │       └── StatusBar.tsx
    └── vite.config.ts
```

### `package.json` Skeleton

```json
{
  "name": "claude-code-extension",
  "displayName": "Claude Code",
  "version": "0.0.1",
  "engines": { "vscode": "^1.85.0" },
  "main": "./dist/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "claude.startSession", "title": "Claude: Start Session" },
      { "command": "claude.sendTurn", "title": "Claude: Send Turn" },
      { "command": "claude.interrupt", "title": "Claude: Interrupt" },
      { "command": "claude.stopSession", "title": "Claude: Stop Session" },
      { "command": "claude.openPanel", "title": "Claude: Open Chat Panel" }
    ],
    "configuration": {
      "title": "Claude Code",
      "properties": {
        "claudeCode.model": {
          "type": "string",
          "default": "claude-opus-4-5",
          "description": "Claude model to use"
        },
        "claudeCode.permissionMode": {
          "type": "string",
          "enum": ["default", "bypassPermissions", "acceptEdits"],
          "default": "default"
        },
        "claudeCode.binaryPath": {
          "type": "string",
          "description": "Custom path to claude executable (leave empty for PATH)"
        },
        "claudeCode.maxThinkingTokens": {
          "type": "number",
          "default": null
        }
      }
    },
    "keybindings": [
      {
        "command": "claude.openPanel",
        "key": "ctrl+shift+a",
        "mac": "cmd+shift+a"
      }
    ],
    "viewsContainers": {
      "activitybar": [{ "id": "claude-sidebar", "title": "Claude", "icon": "$(symbol-misc)" }]
    }
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.77"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0"
  }
}
```

### `src/extension.ts` — Activation Entry

```typescript
import * as vscode from "vscode";
import { SessionManager } from "./sessionManager";
import { PanelManager } from "./panel";
import { registerCommands } from "./commands";

let sessionManager: SessionManager | undefined;
let panelManager: PanelManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Instantiate core services
  sessionManager = new SessionManager(context);
  panelManager = new PanelManager(context, sessionManager);

  // Register all VS Code commands
  registerCommands(context, sessionManager, panelManager);

  // Auto-open panel on activation (optional)
  // panelManager.openOrReveal();
}

export function deactivate(): void {
  // Graceful shutdown — stop all active sessions
  sessionManager?.stopAll();
}
```

---

## Phase 1: SDK Integration & Session Spawning

This is the core of the whole extension. Everything else is UI and plumbing around this.

### The Session Lifecycle (same as t3code)

```typescript
// src/sessionManager.ts
import { query, type SDKMessage, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import * as vscode from "vscode";
import { PromptQueue } from "./promptQueue";
import { ApprovalManager } from "./approvalManager";
import { makeClaudeHooks } from "./hooks";
import { EventBus } from "./eventBus";
import { ResumeCursorStore } from "./persistence";

export interface SessionStartOptions {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly model: string;
  readonly permissionMode?: PermissionMode;
  readonly maxThinkingTokens?: number | null;
  readonly binaryPath?: string;
  readonly resumeCursor?: unknown; // opaque — only parsed inside this class
}

interface ActiveSession {
  readonly sessionId: string; // Claude's internal session ID (from system init)
  readonly promptQueue: PromptQueue;
  readonly approvalManager: ApprovalManager;
  readonly abortController: AbortController;
  readonly streamLoop: Promise<void>; // the background for-await loop
  status: "running" | "idle" | "stopped";
  turnCount: number;
}

export class SessionManager {
  private sessions = new Map<string, ActiveSession>(); // keyed by workspaceFolder.name
  private eventBus: EventBus;
  private cursorStore: ResumeCursorStore;

  constructor(private context: vscode.ExtensionContext) {
    this.eventBus = new EventBus();
    this.cursorStore = new ResumeCursorStore(context);
  }

  async startSession(options: SessionStartOptions): Promise<string> {
    const sessionKey = options.workspaceFolder.name;

    // Stop any existing session for this workspace
    if (this.sessions.has(sessionKey)) {
      await this.stopSession(sessionKey);
    }

    const cwd = options.workspaceFolder.uri.fsPath;
    const config = vscode.workspace.getConfiguration("claudeCode");
    const resumeState = this.cursorStore.read(sessionKey);

    const promptQueue = new PromptQueue();
    const approvalManager = new ApprovalManager(this.eventBus);
    const abortController = new AbortController();

    // ─── THE CORE CALL ─────────────────────────────────────────────────
    const queryRuntime = query({
      prompt: promptQueue.asAsyncIterable(),
      options: {
        cwd,
        model: options.model ?? config.get("model") ?? "claude-opus-4-5",
        permissionMode: options.permissionMode ?? config.get("permissionMode"),
        maxThinkingTokens: options.maxThinkingTokens ?? config.get("maxThinkingTokens") ?? null,
        pathToClaudeCodeExecutable: options.binaryPath ?? config.get("binaryPath") ?? undefined,
        resume: resumeState?.resume,
        resumeSessionAt: resumeState?.resumeSessionAt,
        signal: abortController.signal,
        includePartialMessages: true,
        canUseTool: approvalManager.makeCanUseTool(),
        hooks: makeClaudeHooks(this.eventBus, sessionKey),
      },
    });
    // ───────────────────────────────────────────────────────────────────

    // Start the background stream consumer loop
    const streamLoop = this.runStreamLoop(queryRuntime, sessionKey);

    const session: ActiveSession = {
      sessionId: "", // filled in when we get the system init message
      promptQueue,
      approvalManager,
      abortController,
      streamLoop,
      status: "idle",
      turnCount: 0,
    };

    this.sessions.set(sessionKey, session);
    this.eventBus.emit("session.started", { sessionKey });

    return sessionKey;
  }

  // Background loop: consumes the async iterable and emits canonical events
  private async runStreamLoop(
    queryRuntime: AsyncIterable<SDKMessage>,
    sessionKey: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    try {
      for await (const message of queryRuntime) {
        this.handleSdkMessage(message, sessionKey);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        this.eventBus.emit("session.error", { sessionKey, error });
      }
    } finally {
      const s = this.sessions.get(sessionKey);
      if (s) s.status = "stopped";
      this.eventBus.emit("session.closed", { sessionKey });
    }
  }

  async sendTurn(sessionKey: string, text: string, attachments?: Attachment[]): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error(`No active session for ${sessionKey}`);

    session.turnCount++;
    session.status = "running";
    this.eventBus.emit("turn.started", { sessionKey, turnCount: session.turnCount });

    // Build the SDK user message and push it to the queue
    await session.promptQueue.push(buildUserMessage(text, attachments));
  }

  async interrupt(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    // queryRuntime exposes interrupt() — need to store the reference
    // See: Phase 1b — storing the ClaudeQueryRuntime reference
    await (session as any).queryRuntime?.interrupt();
  }

  async stopSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    // 1. Push terminate signal to the prompt queue
    session.promptQueue.terminate();

    // 2. Abort the AbortController
    session.abortController.abort();

    // 3. Wait for the stream loop to finish
    await session.streamLoop.catch(() => {});

    this.sessions.delete(sessionKey);
  }

  stopAll(): void {
    for (const key of this.sessions.keys()) {
      this.stopSession(key).catch(() => {});
    }
  }

  get events(): EventBus {
    return this.eventBus;
  }
}
```

> 💡 **Key insight:** Unlike t3code, you don't need `ChildProcess.spawn()` at all. The SDK spawns claude internally. Your extension host _is_ the Node.js process. `query()` is called directly — zero process management on your end.

---

## Phase 2: Multi-Turn Prompt Queue

Same pattern as t3code — an async generator that yields messages as they arrive, and blocks when idle.

```typescript
// src/promptQueue.ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type QueueItem = { type: "message"; message: SDKUserMessage } | { type: "terminate" };

export class PromptQueue {
  private pending: Array<QueueItem> = [];
  private waiters: Array<(item: QueueItem) => void> = [];
  private terminated = false;

  push(message: SDKUserMessage): void {
    if (this.terminated) return;
    const item: QueueItem = { type: "message", message };

    if (this.waiters.length > 0) {
      // Someone is already waiting — deliver immediately
      this.waiters.shift()!(item);
    } else {
      this.pending.push(item);
    }
  }

  terminate(): void {
    this.terminated = true;
    const item: QueueItem = { type: "terminate" };
    // Wake all waiters with the terminate signal
    for (const waiter of this.waiters) {
      waiter(item);
    }
    this.waiters = [];
  }

  asAsyncIterable(): AsyncIterable<SDKUserMessage> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        return {
          async next(): Promise<IteratorResult<SDKUserMessage>> {
            // If there are pending items, deliver immediately
            if (self.pending.length > 0) {
              const item = self.pending.shift()!;
              if (item.type === "terminate") return { done: true, value: undefined as any };
              return { done: false, value: item.message };
            }

            // Block until something is pushed
            const item = await new Promise<QueueItem>((resolve) => {
              self.waiters.push(resolve);
            });

            if (item.type === "terminate") return { done: true, value: undefined as any };
            return { done: false, value: item.message };
          },
        };
      },
    };
  }
}

// Build a user message (text + optional images)
export function buildUserMessage(
  text: string,
  attachments?: Array<{ mimeType: string; dataBase64: string }>,
): SDKUserMessage {
  const content: Array<Record<string, unknown>> = [];

  if (text.trim().length > 0) {
    content.push({ type: "text", text: text.trim() });
  }

  for (const att of attachments ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: att.mimeType, data: att.dataBase64 },
    });
  }

  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content },
  } as SDKUserMessage;
}
```

---

## Phase 3: Permission & Approval System

This is where VS Code diverges most interestingly from t3code. Instead of a custom React dialog in a WebView, you get VS Code's native UI components for free.

### Approval Strategy Options

| Option              | VS Code API                            | Feel                    | Complexity |
| ------------------- | -------------------------------------- | ----------------------- | ---------- |
| Quick Pick          | `vscode.window.showQuickPick`          | Native, keyboard-driven | Low        |
| Information Message | `vscode.window.showInformationMessage` | Toast-like, simple      | Very Low   |
| WebView dialog      | `panel.webview.postMessage`            | Fully custom UI         | High       |
| Status bar button   | `vscode.StatusBarItem`                 | Subtle, non-blocking    | Medium     |

**Recommended:** Information Message for quick, Quick Pick for detailed.

```typescript
// src/approvalManager.ts
import * as vscode from "vscode";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { EventBus } from "./eventBus";

export class ApprovalManager {
  constructor(private eventBus: EventBus) {}

  makeCanUseTool(): CanUseTool {
    return async (toolName: string, toolInput: unknown): Promise<PermissionResult> => {
      const config = vscode.workspace.getConfiguration("claudeCode");
      const permissionMode = config.get<string>("permissionMode");

      // Full access mode — allow everything silently
      if (permissionMode === "bypassPermissions") {
        return { behavior: "allow" };
      }

      // Supervised mode — ask the user
      return this.askUserForApproval(toolName, toolInput);
    };
  }

  private async askUserForApproval(
    toolName: string,
    toolInput: unknown,
  ): Promise<PermissionResult> {
    const detail = summarizeTool(toolName, toolInput);
    const toolType = classifyToolType(toolName);

    // Emit event so the WebView can also show the approval (optional)
    this.eventBus.emit("approval.requested", { toolName, detail, toolType });

    // ── Option A: VS Code native information message (fast, non-blocking)
    const choice = await vscode.window.showInformationMessage(
      `Claude wants to run: ${detail}`,
      { modal: false },
      "Allow",
      "Allow Always",
      "Deny",
    );

    this.eventBus.emit("approval.resolved", { toolName, choice });

    switch (choice) {
      case "Allow":
        return { behavior: "allow" };
      case "Allow Always":
        return { behavior: "allowPermanently", ruleType: "prefix", rule: toolName };
      case "Deny":
        return { behavior: "deny" };
      default:
        return { behavior: "deny" }; // dismissed = deny
    }
  }
}

// ── Option B: Quick Pick for more detail ──────────────────────────────────────
async function askWithQuickPick(toolName: string, detail: string): Promise<PermissionResult> {
  const items: vscode.QuickPickItem[] = [
    { label: "$(check) Allow", description: "Run this once", detail },
    { label: "$(check-all) Allow Always", description: `Always allow ${toolName}` },
    { label: "$(x) Deny", description: "Block this tool call" },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: `Claude: Tool Approval`,
    placeHolder: `${toolName} — Allow or deny?`,
    ignoreFocusOut: true, // Don't dismiss if user clicks elsewhere
  });

  if (!picked || picked.label.includes("Deny")) return { behavior: "deny" };
  if (picked.label.includes("Always"))
    return { behavior: "allowPermanently", ruleType: "prefix", rule: toolName };
  return { behavior: "allow" };
}

function classifyToolType(toolName: string): string {
  const n = toolName.toLowerCase();
  if (n.includes("bash") || n.includes("command")) return "command_execution";
  if (n.includes("edit") || n.includes("write")) return "file_change";
  if (n.includes("agent") || n.includes("subagent")) return "subagent";
  if (n.includes("mcp")) return "mcp_tool_call";
  return "tool_call";
}

function summarizeTool(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return toolName;
  const inp = input as Record<string, unknown>;
  const cmd = inp.command ?? inp.cmd;
  if (typeof cmd === "string") return `${toolName}: ${cmd.slice(0, 120)}`;
  return `${toolName}: ${JSON.stringify(input).slice(0, 120)}`;
}
```

> 💡 **Pro tip:** Use `ignoreFocusOut: true` on all approval UI. Claude's output continues in the background and VS Code might steal focus. Without this, the approval dialog dismisses the moment the user glances at the terminal output Claude is generating.

---

## Phase 4: Session Persistence & Resume

The resume cursor is adapter-owned opaque state — same rule as t3code. Store it using `context.globalState` for simplicity, or SQLite for full event sourcing.

### Simple: `context.globalState`

```typescript
// src/persistence.ts
import * as vscode from "vscode";

export interface ClaudeResumeCursor {
  readonly version: 1;
  readonly resume?: string; // Claude's session UUID
  readonly resumeSessionAt?: string; // ISO timestamp
  readonly turnCount?: number;
}

const CURSOR_KEY_PREFIX = "claude.resumeCursor.";

export class ResumeCursorStore {
  constructor(private context: vscode.ExtensionContext) {}

  read(sessionKey: string): ClaudeResumeCursor | undefined {
    const raw = this.context.globalState.get<unknown>(`${CURSOR_KEY_PREFIX}${sessionKey}`);
    return isValidCursor(raw) ? raw : undefined;
  }

  async write(sessionKey: string, cursor: ClaudeResumeCursor): Promise<void> {
    await this.context.globalState.update(`${CURSOR_KEY_PREFIX}${sessionKey}`, cursor);
  }

  async clear(sessionKey: string): Promise<void> {
    await this.context.globalState.update(`${CURSOR_KEY_PREFIX}${sessionKey}`, undefined);
  }
}

function isValidCursor(raw: unknown): raw is ClaudeResumeCursor {
  if (!raw || typeof raw !== "object") return false;
  const c = raw as Record<string, unknown>;
  return c.version === 1;
}
```

### Where the Resume Cursor Gets Updated

In `handleSdkMessage`, when you see a `system init` message:

```typescript
private handleSdkMessage(message: SDKMessage, sessionKey: string): void {
  const session = this.sessions.get(sessionKey);
  if (!session) return;

  switch (message.type) {
    case "system":
      if (message.subtype === "init") {
        // Capture Claude's session ID — this is what we'll use to resume
        const sessionId = (message as any).session_id as string | undefined;
        if (sessionId) {
          (session as any).sessionId = sessionId;
          // Persist the resume cursor immediately
          this.cursorStore.write(sessionKey, {
            version: 1,
            resume: sessionId,
            resumeSessionAt: new Date().toISOString(),
            turnCount: session.turnCount,
          });
        }
        this.eventBus.emit("session.initialized", { sessionKey, sessionId });
      }
      break;

    case "assistant":
      this.handleAssistantMessage(message, sessionKey);
      break;

    case "result":
      this.handleResultMessage(message, sessionKey);
      // Update cursor with latest turn count after each completion
      this.cursorStore.write(sessionKey, {
        version: 1,
        resume: (session as any).sessionId,
        resumeSessionAt: new Date().toISOString(),
        turnCount: session.turnCount,
      });
      break;
  }
}
```

### Advanced: SQLite for Full Event Sourcing

If you want t3code-level full event sourcing, use `better-sqlite3` (works great in VS Code extensions):

```typescript
import Database from "better-sqlite3";
import * as path from "path";

const dbPath = path.join(context.globalStorageUri.fsPath, "claude-events.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,    -- JSON
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resume_cursors (
    session_key TEXT PRIMARY KEY,
    cursor_json TEXT NOT NULL,  -- opaque JSON
    updated_at TEXT NOT NULL
  );
`);
```

This gives you full replay, history browsing, and crash recovery — but is significantly more complex.

---

## Phase 5: WebView UI Panel

The WebView is the equivalent of t3code's React web app. It runs in a sandboxed iframe inside VS Code and communicates with the extension host via `postMessage`.

### Panel Creation

```typescript
// src/panel.ts
import * as vscode from "vscode";
import * as path from "path";
import type { SessionManager } from "./sessionManager";

export class PanelManager {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private sessionManager: SessionManager,
  ) {
    // Bridge all session events to the webview
    sessionManager.events.onAny((eventType, data) => {
      this.postToWebview({ type: eventType, ...data });
    });
  }

  openOrReveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "claudeCode", // viewType (unique ID)
      "Claude Code", // Title shown in tab
      vscode.ViewColumn.Beside, // Open beside current editor
      {
        enableScripts: true, // Required for any JS in the webview
        retainContextWhenHidden: true, // Keep webview state when tab is hidden
        localResourceRoots: [
          // Allow the webview to load files from your extension's dist/
          vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview")),
        ],
      },
    );

    this.panel.webview.html = this.getHtmlContent();

    // Handle messages FROM the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleWebviewMessage(message),
      undefined,
      this.context.subscriptions,
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private handleWebviewMessage(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case "sendTurn": {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;
        this.sessionManager
          .sendTurn(workspaceFolder.name, message.text as string)
          .catch((err) => this.postToWebview({ type: "error", message: err.message }));
        break;
      }
      case "startSession": {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;
        this.sessionManager
          .startSession({ workspaceFolder, model: message.model as string })
          .catch((err) => this.postToWebview({ type: "error", message: err.message }));
        break;
      }
      case "interrupt": {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;
        this.sessionManager.interrupt(workspaceFolder.name);
        break;
      }
      case "approvalResponse": {
        this.sessionManager.resolveApproval(
          message.requestId as string,
          message.approved as boolean,
        );
        break;
      }
    }
  }

  postToWebview(message: Record<string, unknown>): void {
    this.panel?.webview.postMessage(message);
  }

  private getHtmlContent(): string {
    const webview = this.panel!.webview;

    // Convert local paths to webview URIs (required for security)
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview", "main.js")),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview", "main.css")),
    );

    // Content Security Policy — required for VS Code webviews
    const nonce = generateNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" nonce="${nonce}" />
  <title>Claude Code</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
```

### Webview Transport (mirrors wsTransport.ts)

Inside the webview, you don't have WebSockets — you use the VS Code webview API. Wrap it the same way t3code wraps WebSocket:

```typescript
// webview-ui/src/transport.ts
// This runs INSIDE the webview iframe, not in the extension host

declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();

type Listener<T> = (data: T) => void;
const listeners = new Map<string, Set<Listener<unknown>>>();

// Receive events FROM the extension host
window.addEventListener("message", (event) => {
  const message = event.data as { type: string; [key: string]: unknown };
  const handlers = listeners.get(message.type);
  if (handlers) {
    for (const handler of handlers) {
      handler(message);
    }
  }
});

export function on<T>(eventType: string, listener: Listener<T>): () => void {
  if (!listeners.has(eventType)) listeners.set(eventType, new Set());
  listeners.get(eventType)!.add(listener as Listener<unknown>);
  return () => listeners.get(eventType)?.delete(listener as Listener<unknown>);
}

// Send messages TO the extension host
export function send(message: Record<string, unknown>): void {
  vscode.postMessage(message);
}

// Usage in a React component:
// const cleanup = on("turn.delta", (data) => setMessages(prev => [...prev, data]));
// send({ type: "sendTurn", text: inputValue });
```

---

## Phase 6: Canonical Event Mapping

Same as t3code — translate raw SDK messages into clean, typed events your UI understands. This keeps the UI decoupled from SDK internals.

```typescript
// src/canonicalEvents.ts
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

export type ClaudeEvent =
  | { type: "session.initialized"; sessionId: string }
  | { type: "turn.started"; turnId: string }
  | {
      type: "content.delta";
      turnId: string;
      text: string;
      kind: "assistant_text" | "reasoning_text";
    }
  | { type: "tool.started"; toolName: string; itemId: string; title: string }
  | { type: "tool.input_delta"; itemId: string; partialJson: string }
  | { type: "tool.completed"; itemId: string; output: string; isError: boolean }
  | { type: "turn.completed"; status: "completed" | "interrupted" | "failed" | "cancelled" }
  | { type: "approval.requested"; requestId: string; toolName: string; detail: string }
  | { type: "approval.resolved"; requestId: string; approved: boolean }
  | { type: "session.error"; message: string }
  | { type: "session.closed" };

export function mapSdkMessage(message: SDKMessage): ClaudeEvent[] {
  const events: ClaudeEvent[] = [];

  switch (message.type) {
    case "system":
      if ((message as any).subtype === "init") {
        events.push({ type: "session.initialized", sessionId: (message as any).session_id ?? "" });
      }
      break;

    case "assistant": {
      const content = (message.message as any)?.content ?? [];
      for (const block of content) {
        if (block.type === "text" && block.text) {
          events.push({
            type: "content.delta",
            turnId: (message as any).uuid ?? "",
            text: block.text,
            kind: "assistant_text",
          });
        }
        if (block.type === "thinking" && block.thinking) {
          events.push({
            type: "content.delta",
            turnId: (message as any).uuid ?? "",
            text: block.thinking,
            kind: "reasoning_text",
          });
        }
        if (block.type === "tool_use") {
          const itemType = classifyToolName(block.name);
          events.push({
            type: "tool.started",
            toolName: block.name,
            itemId: block.id,
            title: titleForTool(itemType),
          });
        }
      }
      break;
    }

    case "result": {
      const result = message as SDKResultMessage;
      const status = mapResultStatus(result);
      events.push({ type: "turn.completed", status });
      break;
    }
  }

  return events;
}

function mapResultStatus(
  result: SDKResultMessage,
): "completed" | "interrupted" | "failed" | "cancelled" {
  if (result.subtype === "success") return "completed";
  const errors = ("errors" in result && Array.isArray(result.errors) ? result.errors : [])
    .join(" ")
    .toLowerCase();
  if (errors.includes("interrupt") || errors.includes("aborted")) return "interrupted";
  if (errors.includes("cancel")) return "cancelled";
  return "failed";
}

function classifyToolName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("command")) return "command_execution";
  if (n.includes("edit") || n.includes("write")) return "file_change";
  if (n.includes("agent")) return "subagent";
  return "tool_call";
}

function titleForTool(itemType: string): string {
  const map: Record<string, string> = {
    command_execution: "Command run",
    file_change: "File edit",
    subagent: "Subagent task",
    tool_call: "Tool call",
  };
  return map[itemType] ?? "Tool call";
}
```

---

## Phase 7: Orchestration Layer

t3code has a full event-sourced `OrchestrationEngine`. For a VS Code extension, a lighter-weight version is sufficient — a typed event bus + a command queue.

### Event Bus

```typescript
// src/eventBus.ts
import { EventEmitter } from "events";

// Define all possible event types
export type ExtensionEvent =
  | { type: "session.started"; sessionKey: string }
  | { type: "session.initialized"; sessionKey: string; sessionId?: string }
  | { type: "session.closed"; sessionKey: string }
  | { type: "session.error"; sessionKey: string; error: unknown }
  | { type: "turn.started"; sessionKey: string; turnCount: number }
  | { type: "turn.completed"; sessionKey: string; status: string }
  | { type: "content.delta"; sessionKey: string; text: string; kind: string }
  | { type: "tool.started"; sessionKey: string; toolName: string; itemId: string }
  | { type: "tool.completed"; sessionKey: string; itemId: string }
  | {
      type: "approval.requested";
      sessionKey: string;
      requestId: string;
      toolName: string;
      detail: string;
    }
  | { type: "approval.resolved"; sessionKey: string; requestId: string; approved: boolean };

export class EventBus {
  private emitter = new EventEmitter();

  emit(
    type: ExtensionEvent["type"],
    data: Omit<Extract<ExtensionEvent, { type: typeof type }>, "type">,
  ): void {
    this.emitter.emit(type, { type, ...data });
    this.emitter.emit("*", { type, ...data }); // wildcard
  }

  on<T extends ExtensionEvent["type"]>(
    type: T,
    listener: (event: Extract<ExtensionEvent, { type: T }>) => void,
  ): () => void {
    this.emitter.on(type, listener);
    return () => this.emitter.off(type, listener);
  }

  onAny(listener: (type: string, data: unknown) => void): () => void {
    const wrapped = (event: ExtensionEvent) => listener(event.type, event);
    this.emitter.on("*", wrapped);
    return () => this.emitter.off("*", wrapped);
  }
}
```

### Command Queue (optional for serialized operations)

```typescript
// src/commandQueue.ts
// Ensures commands execute in order, one at a time — prevents race conditions

type Command = () => Promise<void>;

export class CommandQueue {
  private queue: Command[] = [];
  private running = false;

  enqueue(command: Command): void {
    this.queue.push(command);
    if (!this.running) this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const command = this.queue.shift()!;
      try {
        await command();
      } catch (err) {
        console.error("[CommandQueue] Error:", err);
      }
    }
    this.running = false;
  }
}

// Example usage in SessionManager:
// this.commandQueue.enqueue(() => this.startSession(options));
// this.commandQueue.enqueue(() => this.sendTurn(key, text));
// This ensures startSession always fully completes before sendTurn runs
```

---

## Phase 8: Hooks & Lifecycle Signals

Hooks fire inside the SDK during the turn lifecycle. Use them to:

- Emit VS Code progress notifications
- Create git checkpoints mid-turn
- Log tool audit trails
- Emit status bar updates

```typescript
// src/hooks.ts
import * as vscode from "vscode";
import type { EventBus } from "./eventBus";

// Note: Hooks type comes from the SDK
type ClaudeHooks = {
  PostToolUse?: (toolName: string, input: unknown, result: unknown) => Promise<void>;
  Stop?: (result: unknown) => Promise<void>;
};

export function makeClaudeHooks(eventBus: EventBus, sessionKey: string): ClaudeHooks {
  return {
    async PostToolUse(toolName, input, result) {
      // Log to output channel
      outputChannel.appendLine(`[Tool] ${toolName} completed`);

      // Emit for UI
      eventBus.emit("tool.completed", { sessionKey, itemId: "", toolName });

      // Optional: git checkpoint after file changes
      if (isFileChangeTool(toolName)) {
        await captureGitCheckpoint(sessionKey).catch(() => {});
      }
    },

    async Stop(result) {
      // Turn ended — update status bar
      statusBarItem.text = "$(check) Claude: Ready";
      statusBarItem.tooltip = "Claude Code — idle";
      outputChannel.appendLine("[Session] Turn completed");
    },
  };
}

// Output channel for logging (shows in VS Code's Output panel)
export const outputChannel = vscode.window.createOutputChannel("Claude Code", { log: true });

// Status bar item
export const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

function isFileChangeTool(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("edit") || n.includes("write") || n.includes("create");
}

async function captureGitCheckpoint(sessionKey: string): Promise<void> {
  // Use VS Code's git extension API
  const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
  if (!gitExtension) return;
  const git = gitExtension.getAPI(1);
  const repo = git.repositories[0];
  if (!repo) return;
  // Stage and commit silently as a checkpoint
  // (this mirrors t3code's CheckpointReactor behavior)
  await repo.add(["."]); // git add .
  // You might want to be more selective here
}
```

---

## Phase 9: CLAUDE.md Awareness

The best part: **you don't need to do anything.** The Claude Agent SDK automatically reads `CLAUDE.md` from the `cwd` you pass to `query()`. Since you pass `workspaceFolder.uri.fsPath` as `cwd`, any `CLAUDE.md` in the project root is automatically picked up.

```typescript
// This is all you need — the SDK does the rest:
query({
  prompt: promptQueue.asAsyncIterable(),
  options: {
    cwd: workspaceFolder.uri.fsPath, // SDK reads CLAUDE.md from here automatically
    model: "claude-opus-4-5",
  },
});
```

### Optional: Create/Update CLAUDE.md Programmatically

```typescript
import * as fs from "fs/promises";
import * as path from "path";

async function ensureClaudeMd(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  const claudeMdPath = path.join(workspaceFolder.uri.fsPath, "CLAUDE.md");

  try {
    await fs.access(claudeMdPath); // Already exists — don't overwrite
  } catch {
    // Create a starter CLAUDE.md
    const content = `# CLAUDE.md
This file provides guidance to Claude Code when working in this repository.

## Project Overview
[Describe your project here]

## Commands
\`\`\`bash
# Add your build/test/lint commands here
npm test
npm run build
npm run lint
\`\`\`

## Conventions
- [Add your coding conventions]
- [Add what Claude should or shouldn't change]
`;
    await fs.writeFile(claudeMdPath, content, "utf8");
    vscode.window
      .showInformationMessage(
        "Created CLAUDE.md in workspace root. Edit it to guide Claude.",
        "Open CLAUDE.md",
      )
      .then((choice) => {
        if (choice === "Open CLAUDE.md") {
          vscode.window.showTextDocument(vscode.Uri.file(claudeMdPath));
        }
      });
  }
}
```

### Optional: VS Code Command to Edit CLAUDE.md

```typescript
// In registerCommands:
vscode.commands.registerCommand("claude.editClaudeMd", async () => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const mdPath = path.join(folder.uri.fsPath, "CLAUDE.md");
  await ensureClaudeMd(folder);
  await vscode.window.showTextDocument(vscode.Uri.file(mdPath));
});
```

---

## Phase 10: Status Bar, Commands & Keybindings

### Status Bar Item

```typescript
// src/extension.ts
export function activate(context: vscode.ExtensionContext): void {
  // ... other setup ...

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "$(symbol-misc) Claude";
  statusBar.tooltip = "Claude Code — Click to open";
  statusBar.command = "claude.openPanel";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Update status bar based on session events
  sessionManager.events.on("turn.started", () => {
    statusBar.text = "$(loading~spin) Claude: Thinking…";
  });
  sessionManager.events.on("turn.completed", () => {
    statusBar.text = "$(check) Claude: Done";
    setTimeout(() => {
      statusBar.text = "$(symbol-misc) Claude";
    }, 3000);
  });
  sessionManager.events.on("approval.requested", () => {
    statusBar.text = "$(warning) Claude: Waiting for approval";
  });
}
```

### Command Registration

```typescript
// src/commands.ts
import * as vscode from "vscode";
import type { SessionManager } from "./sessionManager";
import type { PanelManager } from "./panel";

export function registerCommands(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
  panelManager: PanelManager,
): void {
  const cmds: Array<[string, (...args: unknown[]) => unknown]> = [
    ["claude.openPanel", () => panelManager.openOrReveal()],
    [
      "claude.startSession",
      () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return vscode.window.showErrorMessage("No workspace folder open.");
        const config = vscode.workspace.getConfiguration("claudeCode");
        return sessionManager.startSession({
          workspaceFolder: folder,
          model: config.get("model") ?? "claude-opus-4-5",
          permissionMode: config.get("permissionMode"),
        });
      },
    ],
    [
      "claude.interrupt",
      () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        return sessionManager.interrupt(folder.name);
      },
    ],
    [
      "claude.stopSession",
      () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        return sessionManager.stopSession(folder.name);
      },
    ],
    [
      "claude.clearHistory",
      async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        const confirm = await vscode.window.showWarningMessage(
          "Clear Claude session history? This cannot be undone.",
          "Clear",
          "Cancel",
        );
        if (confirm === "Clear") {
          await sessionManager.clearHistory(folder.name);
          vscode.window.showInformationMessage("Claude history cleared.");
        }
      },
    ],
    [
      "claude.editClaudeMd",
      () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return;
        const p = path.join(folder.uri.fsPath, "CLAUDE.md");
        vscode.window.showTextDocument(vscode.Uri.file(p));
      },
    ],
  ];

  for (const [command, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  }
}
```

### Progress Notification for Long Turns

```typescript
// Show a cancellable progress notification while Claude is thinking
async function withProgress<T>(
  title: string,
  task: (token: vscode.CancellationToken) => Promise<T>,
): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        sessionManager.interrupt(currentSessionKey);
      });
      return task(token);
    },
  );
}
```

---

## Phase 11: Configuration via VS Code Settings

VS Code settings replace t3code's env vars and the server config system. All config is accessed via `vscode.workspace.getConfiguration("claudeCode")`.

### `package.json` Configuration Schema

```json
"contributes": {
  "configuration": {
    "title": "Claude Code",
    "properties": {
      "claudeCode.model": {
        "type": "string",
        "default": "claude-opus-4-5",
        "enum": [
          "claude-opus-4-5",
          "claude-sonnet-4-5",
          "claude-haiku-4-5"
        ],
        "description": "Claude model to use for sessions"
      },
      "claudeCode.permissionMode": {
        "type": "string",
        "default": "default",
        "enum": ["default", "acceptEdits", "bypassPermissions", "plan"],
        "enumDescriptions": [
          "Standard Claude Code — ask before commands",
          "Auto-approve file edits, ask for commands",
          "Full access — allow everything without asking",
          "Plan only — propose but never execute"
        ],
        "description": "Permission mode for Claude tool calls"
      },
      "claudeCode.binaryPath": {
        "type": "string",
        "default": "",
        "description": "Custom path to claude CLI binary. Leave empty to use PATH."
      },
      "claudeCode.maxThinkingTokens": {
        "type": ["number", "null"],
        "default": null,
        "description": "Extended thinking token budget. Null for default."
      },
      "claudeCode.autoStartSession": {
        "type": "boolean",
        "default": false,
        "description": "Automatically start a session when workspace opens"
      },
      "claudeCode.autoCreateClaudeMd": {
        "type": "boolean",
        "default": true,
        "description": "Auto-create CLAUDE.md if not present when session starts"
      }
    }
  }
}
```

### Reacting to Config Changes

```typescript
// Watch for settings changes and apply them live
vscode.workspace.onDidChangeConfiguration((event) => {
  if (event.affectsConfiguration("claudeCode.permissionMode")) {
    const newMode = vscode.workspace.getConfiguration("claudeCode").get<string>("permissionMode");
    // Apply to active session if one exists
    for (const [key, session] of sessions) {
      (session as any).queryRuntime?.setPermissionMode(newMode);
    }
  }
  if (event.affectsConfiguration("claudeCode.model")) {
    const newModel = vscode.workspace.getConfiguration("claudeCode").get<string>("model");
    for (const [key, session] of sessions) {
      (session as any).queryRuntime?.setModel(newModel);
    }
  }
});
```

---

## Phase 12: Interrupt, Stop & Restart

Mirror t3code's SIGTERM → wait 2s → SIGKILL pattern — adapted for async generators:

```typescript
export class SessionManager {
  // Store the query runtime reference so we can call interrupt()
  private queryRuntimes = new Map<
    string,
    {
      interrupt: () => Promise<void>;
      setModel: (model?: string) => Promise<void>;
      setPermissionMode: (mode: string) => Promise<void>;
      close: () => void;
    }
  >();

  async interrupt(sessionKey: string): Promise<void> {
    const runtime = this.queryRuntimes.get(sessionKey);
    if (!runtime) return;

    // Phase 1: Ask nicely — like SIGTERM
    try {
      await runtime.interrupt();
    } catch {
      // If interrupt() throws, proceed to abort
    }

    // Phase 2: Force abort after 3s — like SIGKILL
    setTimeout(() => {
      const session = this.sessions.get(sessionKey);
      if (session?.status === "running") {
        session.abortController.abort();
      }
    }, 3_000);
  }

  async stopSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    // 1. Push terminate signal (drains the prompt queue)
    session.promptQueue.terminate();

    // 2. Abort the signal (stops the SDK's internal loop)
    session.abortController.abort();

    // 3. Close the runtime
    this.queryRuntimes.get(sessionKey)?.close();
    this.queryRuntimes.delete(sessionKey);

    // 4. Wait for the stream loop to settle
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([session.streamLoop.catch(() => {}), timeout]);

    this.sessions.delete(sessionKey);
    this.eventBus.emit("session.closed", { sessionKey });
  }
}
```

---

## Phase 13: Worktree & Git Integration

VS Code has a built-in git extension. Use its API for worktree-style isolated work.

```typescript
import * as vscode from "vscode";

async function createWorkBranch(
  workspaceFolder: vscode.WorkspaceFolder,
  branchName: string,
): Promise<void> {
  const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
  if (!gitExtension) {
    // Fallback: use child_process to run git commands
    const { execSync } = await import("child_process");
    const cwd = workspaceFolder.uri.fsPath;
    execSync(`git checkout -b claude/${branchName}`, { cwd });
    return;
  }

  const git = gitExtension.getAPI(1);
  const repo = git.repositories[0];
  await repo.createBranch(`claude/${branchName}`, true); // true = checkout immediately
}

// Branch naming convention (same as t3code):
// claude/<8-char-hash>  for auto-generated branches
// claude/<task-name>    for named tasks
function generateBranchName(task?: string): string {
  if (task) {
    return `claude/${task.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`;
  }
  const hash = Math.random().toString(16).slice(2, 10);
  return `claude/${hash}`;
}
```

---

## Phase 14: Testing Strategy

### Unit Tests (Vitest or Jest)

```typescript
// test/sessionManager.test.ts
import { describe, it, expect, vi } from "vitest";
import { PromptQueue, buildUserMessage } from "../src/promptQueue";
import { mapSdkMessage } from "../src/canonicalEvents";

describe("PromptQueue", () => {
  it("delivers messages in order", async () => {
    const queue = new PromptQueue();
    const iterable = queue.asAsyncIterable()[Symbol.asyncIterator]();

    queue.push(buildUserMessage("first"));
    queue.push(buildUserMessage("second"));
    queue.terminate();

    const first = await iterable.next();
    const second = await iterable.next();
    const done = await iterable.next();

    expect((first.value.message.content[0] as any).text).toBe("first");
    expect((second.value.message.content[0] as any).text).toBe("second");
    expect(done.done).toBe(true);
  });
});

describe("canonicalEvents", () => {
  it("maps assistant message to content.delta", () => {
    const sdkMsg = {
      type: "assistant",
      uuid: "test-uuid",
      message: { content: [{ type: "text", text: "Hello!" }] },
    } as any;

    const events = mapSdkMessage(sdkMsg);
    expect(events).toContainEqual({
      type: "content.delta",
      turnId: "test-uuid",
      text: "Hello!",
      kind: "assistant_text",
    });
  });

  it("maps success result to turn.completed", () => {
    const sdkMsg = { type: "result", subtype: "success" } as any;
    const events = mapSdkMessage(sdkMsg);
    expect(events[0]).toMatchObject({ type: "turn.completed", status: "completed" });
  });
});
```

### Integration Tests (VS Code Extension Test Runner)

```typescript
// test/extension.test.ts
import * as vscode from "vscode";
import { activate } from "../src/extension";

suite("Extension Integration", () => {
  test("Extension activates successfully", async () => {
    const ext = vscode.extensions.getExtension("your-publisher.claude-code-extension");
    await ext?.activate();
    expect(ext?.isActive).toBe(true);
  });

  test("Claude panel opens on command", async () => {
    await vscode.commands.executeCommand("claude.openPanel");
    // Check that a webview panel was created
    // (requires VS Code test environment)
  });
});
```

### Mocking the SDK for Tests

```typescript
// test/mocks/claude-sdk.ts
// Mock @anthropic-ai/claude-agent-sdk for unit tests

export function query(params: { prompt: AsyncIterable<unknown>; options: unknown }) {
  const messages = [
    { type: "system", subtype: "init", session_id: "mock-session-id" },
    { type: "assistant", uuid: "turn-1", message: { content: [{ type: "text", text: "Hello!" }] } },
    { type: "result", subtype: "success" },
  ];

  const iterable = (async function* () {
    for (const msg of messages) {
      yield msg;
    }
  })();

  return Object.assign(iterable, {
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  });
}
```

---

## Architecture Cheat Sheet: t3code vs Extension

| Concern              | t3code                                        | VS Code Extension                                             |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| **Entry point**      | `apps/server/src/index.ts` (Effect CLI)       | `src/extension.ts` `activate()`                               |
| **Process spawning** | `ChildProcess.spawn(backendEntry)`            | Not needed — host is Node.js                                  |
| **Claude spawn**     | `@anthropic-ai/claude-agent-sdk` `query()`    | Same: `query()` directly                                      |
| **Service DI**       | Effect `Layer` system                         | Constructor injection / singletons                            |
| **Session store**    | SQLite via `@effect/sql-sqlite-bun`           | `context.globalState` or `better-sqlite3`                     |
| **Event bus**        | Effect `PubSub` + `Queue`                     | `EventEmitter` or `vscode.EventEmitter`                       |
| **UI bridge**        | WebSocket (`ws://localhost:3773`)             | `webview.postMessage` + `onDidReceiveMessage`                 |
| **UI framework**     | React 19 + TanStack Router                    | React + Vite (bundled into extension)                         |
| **Config**           | Env vars + CLI flags                          | `vscode.workspace.getConfiguration()`                         |
| **Logs**             | `~/.t3/userdata/logs/`                        | `vscode.window.createOutputChannel()`                         |
| **Persistence dir**  | `T3CODE_HOME` (~/.t3)                         | `context.globalStorageUri.fsPath`                             |
| **CLAUDE.md**        | SDK reads from `cwd` automatically            | Same — SDK reads from workspace `cwd`                         |
| **Restart logic**    | Exponential backoff in Electron main          | N/A — but re-startSession on stream error                     |
| **Interrupt**        | `queryRuntime.interrupt()` + AbortController  | Same                                                          |
| **Shutdown**         | SIGTERM → 2s → SIGKILL                        | `session.promptQueue.terminate()` + `abortController.abort()` |
| **Worker sync**      | `DrainableWorker.drain()`                     | `CommandQueue` + `Promise.race` with timeout                  |
| **Git checkpoints**  | `CheckpointReactor` (auto before/after turns) | `PostToolUse` hook + git extension API                        |
| **Worktrees**        | `~/.t3/worktrees/t3code/<branch>`             | `git checkout -b claude/<branch>`                             |
| **Testing**          | `@effect/vitest` + DrainableWorker drain      | Vitest + VS Code extension test runner                        |

---

## Gotchas & Things That'll Bite You

### 1. WebView is a sandboxed iframe — no Node.js

The webview runs in a browser sandbox. It **cannot** import `@anthropic-ai/claude-agent-sdk` or any Node.js module. All Claude calls must happen in the extension host. Webview is only for UI.

### 2. `acquireVsCodeApi()` can only be called once

In the webview, `acquireVsCodeApi()` throws if called more than once. Call it at module level, not in a function.

```typescript
// ✅ Correct
const vscode = acquireVsCodeApi();
export function send(msg: unknown) {
  vscode.postMessage(msg);
}

// ❌ Wrong — will throw on second render
function MyComponent() {
  const vscode = acquireVsCodeApi(); // throws after first render
}
```

### 3. Content Security Policy blocks everything by default

VS Code webviews have a very strict CSP. You **must** use nonces for inline scripts and `webview.cspSource` for local resources. External CDN URLs are blocked. Bundle everything.

### 4. `retainContextWhenHidden: true` has memory cost

This keeps the webview alive (and its JS heap) even when the tab is hidden. Without it, every time the user hides your panel, the webview is destroyed and re-created, losing all state. Enable it — but be aware it costs ~30-50MB of RAM constantly.

### 5. The SDK may not find `claude` in PATH inside VS Code

VS Code doesn't always inherit your shell's full PATH (especially on macOS with `.zshrc` / `nvm`). Always provide a `binaryPath` fallback or explicitly fix PATH:

```typescript
// Fix PATH for macOS where VS Code doesn't source .zshrc
import { execSync } from "child_process";

function resolveShellPath(): string {
  try {
    return execSync("zsh -i -c 'echo $PATH'", { encoding: "utf8" }).trim();
  } catch {
    return process.env.PATH ?? "";
  }
}

// Then pass env to query():
options: {
  // ...
  env: { ...process.env, PATH: resolveShellPath() },
}
```

### 6. Session cleanup on extension deactivate

`deactivate()` is called synchronously and cannot be async. You must fire-and-forget your cleanup:

```typescript
export function deactivate(): void {
  // Cannot `await` here — deactivate is synchronous
  sessionManager?.stopAll(); // must be synchronous or fire-and-forget
}
```

For proper async cleanup, use `context.subscriptions.push({ dispose: () => sessionManager.stopAll() })` in `activate()`.

### 7. Multi-root workspaces

`vscode.workspace.workspaceFolders` is an array, not a single folder. Your `SessionManager` should key sessions by `workspaceFolder.name` or `workspaceFolder.uri.toString()`, and your UI should let the user pick which folder to use when there are multiple.

### 8. The approval callback runs in the extension host — not on the UI thread

VS Code UI calls (`showInformationMessage`, `showQuickPick`) are async and can be awaited from the extension host. `canUseTool` is async and works perfectly with `await vscode.window.showQuickPick(...)`. This is one of the cleanest parts of the VS Code extension model.

### 9. Don't bundle `@anthropic-ai/claude-agent-sdk` with esbuild `bundle: true` naively

The SDK spawns `claude` as a child process and uses Node.js builtins. Bundle the extension host with `platform: "node"` and `external: ["vscode", "path", "fs", ...]`. Bundle the webview separately with `platform: "browser"`.

```javascript
// esbuild.config.js
const { build } = require("esbuild");

// Extension host
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  external: ["vscode"], // MUST be external — provided by VS Code runtime
  format: "cjs",
});

// Webview UI (separate bundle)
await build({
  entryPoints: ["webview-ui/src/main.tsx"],
  bundle: true,
  platform: "browser",
  outfile: "dist/webview/main.js",
  // No vscode here — webview has no vscode API
});
```

---

_See `cc-cli.md` for the full t3code implementation reference. The patterns above are direct adaptations of what t3code does, translated to the VS Code extension host model._

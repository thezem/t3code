# Claude Agent SDK Usage Guide

This guide documents how to use `@anthropic-ai/claude-agent-sdk` from a host application.
It is written from the perspective of integrating the SDK into a product, not from the
perspective of re-reading the implementation.

In t3code, the Claude integration lives in:

- [`apps/server/src/provider/Layers/ClaudeAdapter.ts`](../apps/server/src/provider/Layers/ClaudeAdapter.ts)
- [`apps/server/src/provider/Layers/ClaudeProvider.ts`](../apps/server/src/provider/Layers/ClaudeProvider.ts)
- [`apps/server/src/provider/Services/ClaudeAdapter.ts`](../apps/server/src/provider/Services/ClaudeAdapter.ts)

---

## Setup

Install the SDK in your host project:

```bash
npm install @anthropic-ai/claude-agent-sdk
```

```bash
bun add @anthropic-ai/claude-agent-sdk
```

You also need Claude Code installed and authenticated in the environment where the host
process runs.

If you run against a repository, put a `CLAUDE.md` file at the repo root. The SDK uses
the working directory you pass to `query()`, so repo-local Claude instructions are picked
up from that root context.

---

## What The SDK Does

`@anthropic-ai/claude-agent-sdk` is the host-side entry point for Claude Code sessions.
You call `query()`, give it an async stream of user prompts, and receive a stream of
SDK messages back.

The important part is the shape of the contract:

- you do not manually spawn `claude`
- you do not talk to Claude over JSON-RPC
- you do not poll for status
- you keep a single long-lived runtime object per session

The SDK owns the Claude process and returns a runtime handle that can:

- stream messages
- interrupt the current turn
- switch model mid-session
- switch permission mode mid-session
- close the session

---

## When To Use It

Use the SDK when you need a Claude Code session that:

- runs from a Node.js host
- maintains state across multiple turns
- reacts to tool approval prompts
- supports resuming a previous session
- needs a live stream of assistant output instead of a one-shot response

This is the right abstraction for:

- CLI agents
- desktop apps
- VS Code extensions
- server-side orchestration layers

It is not the right abstraction if you only need a single text completion. For that,
use the lower-level API for the model itself instead of the agent runtime.

---

## Core Mental Model

Think of the SDK as four pieces:

1. `query()` starts a Claude session.
2. `prompt` is an async iterable that feeds user turns into that session.
3. The returned runtime is an async iterable of messages from Claude.
4. Control methods on the runtime let you interrupt or reconfigure the session.

The lifecycle is usually:

```text
create prompt queue
  -> call query()
  -> consume messages in a loop
  -> push user turns into the prompt queue
  -> approve or deny tool use
  -> interrupt or close when done
```

---

## Basic Usage

```ts
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

async function* makePrompt(): AsyncIterable<SDKUserMessage> {
  while (true) {
    const nextTurn = await waitForNextUserTurn();
    if (!nextTurn) break;
    yield nextTurn;
  }
}

const runtime = query({
  prompt: makePrompt(),
  options: {
    cwd: "/path/to/project",
    model: "claude-sonnet-4-6",
  },
});

for await (const message of runtime) {
  handleSdkMessage(message);
}
```

The runtime object is both:

- an `AsyncIterable` of SDK messages
- a control surface for session changes

---

## User Turn Format

User turns are passed as `SDKUserMessage` values.

The common shape is:

```ts
const turn: SDKUserMessage = {
  type: "user",
  session_id: "",
  parent_tool_use_id: null,
  message: {
    role: "user",
    content: [
      {
        type: "text",
        text: "Refactor the file upload flow.",
      },
    ],
  },
};
```

The host is responsible for deciding when to emit the next turn.

### Multi-Turn Guidance

If your app supports back-to-back turns, feed the SDK from a queue rather than trying
to reconstruct the session from scratch every time.

This has three advantages:

- the session stays warm
- resume state remains stable
- prompt ordering stays deterministic under load

---

## Query Options

The SDK supports a number of options. The ones that matter most in practice are:

| Option                       | Purpose                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| `cwd`                        | Working directory for the Claude session                    |
| `model`                      | Model slug to run                                           |
| `permissionMode`             | Permission policy for the session                           |
| `pathToClaudeCodeExecutable` | Override path to the `claude` binary                        |
| `resume`                     | Resume a previously saved Claude session                    |
| `sessionId`                  | Seed a new session with a stable session id                 |
| `resumeSessionAt`            | Resume from a recorded point in the session                 |
| `includePartialMessages`     | Emit partial content updates while Claude is still speaking |
| `canUseTool`                 | Host callback for tool approval and clarifying questions    |
| `env`                        | Environment variables for the underlying process            |
| `additionalDirectories`      | Extra directories the session may access                    |
| `settingSources`             | Which config sources the SDK should read                    |

### Practical Defaults

The t3code integration uses:

- `cwd` when a turn is started inside a worktree
- `pathToClaudeCodeExecutable` from server settings
- `settingSources: ["user", "project", "local"]`
- `includePartialMessages: true`
- `env: process.env`
- `additionalDirectories: [cwd]` when `cwd` is present

If you are building your own host, these are good defaults unless you have a reason
to narrow them.

### Permission Mode

`permissionMode` controls how much Claude may do without asking the host.

Common usage:

- `bypassPermissions` for full access sessions
- `plan` for plan-only interactions
- undefined/default when the host wants to keep the SDK's current mode

If you expose a user-facing "full access" toggle, pair it with the SDK's bypass mode
and make the host approval flow explicit in the UI.

### Resume Fields

The resume-related fields are opaque from the host's point of view.

That means:

- store them as-is
- pass them back unchanged
- do not try to interpret their internal structure

This is important for long-lived sessions because the SDK may rely on values you do not
need to understand.

---

## Streaming Messages

The runtime yields SDK messages as they arrive.

In practice, you should expect these broad categories:

- `system` messages for session lifecycle and status
- `assistant` messages for assistant output
- `stream_event` messages for partial content and tool streaming in this integration
- `result` messages for turn completion

### What To Do With Each Message

- `system:init`
  - capture the session id
  - mark the session ready
- `system:status`
  - update UI state such as running, waiting, or compacting
- `assistant`
  - append content blocks
  - extract tool calls if your UI renders them separately
- `stream_event`
  - merge deltas into the active assistant block
- `result`
  - close the turn
  - decide whether the turn completed, failed, or was interrupted

### Partial Messages

If you want live typing or incremental tool rendering, set `includePartialMessages: true`.

Without it, you will only get the final form of a turn.

---

## Tool Approval

The most important host-side callback is `canUseTool`.

It is where the SDK asks your app whether a tool can run.

Use it to implement:

- approval-required mode
- per-tool confirmation
- host-managed clarifying questions
- plan capture

### Return Shape

The callback returns a `PermissionResult`-style object.

The main behaviors are:

- `allow`
- `deny`

Some flows also support:

- `updatedInput`
- `updatedPermissions`
- a `message` explaining a denial

### Recommended Host Policy

1. Auto-allow in full-access mode.
2. Deny or gate dangerous tools when approval is required.
3. Always special-case clarifying questions so the user can answer them in the UI.
4. Capture plan-mode exits as structured host events instead of letting Claude silently leave plan mode.

---

## Clarifying Questions

Claude may ask for user input during a turn.

If your host exposes a UI for this, treat it as a first-class interaction, not as a generic approval dialog.

Recommended behavior:

- show the question text exactly as Claude asked it
- preserve option labels and descriptions
- return the selected answers back to the SDK in the original question order
- cancel the request if the turn is interrupted

This keeps the agent and the host synchronized and avoids confusing "approval" UX for a question that is really a prompt for more context.

### Good Mental Model

Think of these prompts as "user-input requests" rather than permission checks.

That distinction matters because:

- permission checks decide whether a tool may run
- user-input requests help Claude continue the current turn

---

## Plan Mode

If you support plan mode, do not rely on Claude to exit it on its own.

Instead:

- detect the plan-exit tool call
- capture the plan content in the host
- keep the session in plan mode until the user responds

This gives your UI a stable checkpoint for review and avoids accidental implementation before the user approves the plan.

The host should treat the captured plan as a user-visible artifact.

---

## Session Resume

Resume support is one of the main reasons to use the SDK instead of a one-shot API.

### What To Persist

Persist the SDK session fields that matter to your app:

- the session id
- the last known resume cursor
- any turn count or bookmark you need for UI continuity

### What Not To Do

- do not parse the session token
- do not derive your own meaning from the opaque cursor
- do not rewrite the resume fields unless the SDK tells you to

### Typical Resume Flow

```ts
const runtime = query({
  prompt: makePrompt(),
  options: {
    cwd,
    resume: savedResumeId,
    resumeSessionAt: savedResumeCheckpoint,
  },
});
```

If you are starting a brand-new session, create a fresh stable `sessionId` and keep it with
the rest of the session record.

---

## Model Selection

The SDK accepts a model slug. In t3code, model selection is filtered through capability
metadata before it reaches Claude.

Practical guidance:

- use the exact model slug your host supports
- validate capability-specific toggles before passing them through
- avoid sending unsupported effort or thinking settings to a model that does not handle them

### Capability Examples Used In t3code

| Model               | Notes                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `claude-opus-4-6`   | Supports fast mode; accepts effort levels including `ultrathink` as a prompt-injected form |
| `claude-sonnet-4-6` | No fast mode; supports effort levels and `ultrathink` prompt injection                     |
| `claude-haiku-4-5`  | Supports thinking toggle; no adaptive effort levels in this integration                    |

If your host exposes a model picker, only show toggles that the selected model actually supports.

### Effort And Prompt Injection

Some host apps treat `ultrathink` as a session-level effort, while others treat it as a
prompt prefix.

The safer pattern is:

- use normal effort levels for actual runtime configuration
- reserve prompt-injected modes for prompt text decoration

That avoids sending unsupported effort values into the SDK when the selected model does
not accept them.

---

## Interrupting And Closing

Use the runtime controls deliberately:

- `interrupt()` cancels the active turn
- `close()` ends the session runtime
- `setModel()` changes the model mid-session
- `setPermissionMode()` changes the permission policy mid-session
- `setMaxThinkingTokens()` adjusts thinking budget if your host supports it

### Recommended Shutdown Order

1. Interrupt the active turn if one is running.
2. Stop feeding new prompts.
3. Close the runtime.
4. Release any host-side session state.

This reduces the risk of half-finished output or orphaned background work.

### Interruption Semantics

Interrupted runs should be treated as a normal control path, not as a crash.

Your host should distinguish between:

- user cancellation
- tool rejection
- actual runtime failure

That distinction is what keeps the UI predictable.

---

## Host Integration Pattern

The most reliable host integration looks like this:

```ts
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type SessionState = {
  sessionId?: string;
  resumeCursor?: string;
  controller: AbortController;
};

function startClaudeSession(input: { cwd: string; model?: string; resume?: string }) {
  const controller = new AbortController();
  const promptQueue: SDKUserMessage[] = [];

  async function* prompt(): AsyncIterable<SDKUserMessage> {
    while (true) {
      const next = await nextQueuedPrompt(promptQueue, controller.signal);
      if (!next) break;
      yield next;
    }
  }

  const runtime = query({
    prompt: prompt(),
    options: {
      cwd: input.cwd,
      model: input.model,
      resume: input.resume,
      includePartialMessages: true,
      canUseTool: handleToolApproval,
      env: process.env,
    },
  });

  void consumeMessages(runtime);

  return {
    runtime,
    controller,
    sendTurn(turn: SDKUserMessage) {
      promptQueue.push(turn);
    },
    interrupt() {
      controller.abort();
      return runtime.interrupt();
    },
    close() {
      runtime.close();
    },
  };
}
```

The exact queue implementation can vary, but the pattern should not:

- one runtime per session
- one prompt source per session
- one consumer loop per session
- explicit cancellation on shutdown

---

## Error Handling

Plan for three classes of failures:

### 1. Startup Failures

Examples:

- Claude is not authenticated
- the `claude` binary is missing
- the host passed an invalid model or cwd

Handle these before starting the turn loop.

### 2. Runtime Failures

Examples:

- the SDK process exits unexpectedly
- message streaming fails
- a tool approval promise never resolves because the host lost state

Surface these as session-level errors and close the runtime.

### 3. Expected User Cancellations

Examples:

- user clicks stop
- user rejects a tool call
- user dismisses a clarification prompt

Do not treat these as exceptional failures in the UI.

---

## Practical Rules

- keep the session runtime alive for the whole conversation
- store resume state as opaque data
- use partial messages if you want a responsive UI
- special-case tool approval and clarifying questions
- validate model capabilities before passing options through
- treat interrupts as normal, not exceptional
- close the runtime explicitly when the host session ends

---

## Quick Checklist

Before shipping a Claude SDK integration, verify that you can:

- start a session with a stable `cwd`
- stream assistant output incrementally
- respond to `canUseTool` requests
- resume an existing session
- interrupt and close cleanly
- switch model or permission mode mid-session
- survive a host restart without losing the stored cursor

If all of those work, the integration is usually solid enough for real use.

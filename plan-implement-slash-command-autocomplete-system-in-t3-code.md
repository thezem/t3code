# Plan: Implement Slash Command Autocomplete System in T3 Code

## Context

T3 Code currently has a basic slash command system supporting `/model`, `/plan`, and `/default`, but lacks the rich autocomplete experience available in Claude Code CLI. Users cannot discover or easily invoke custom commands, and there's no infrastructure for defining reusable command/skill workflows.

This plan adds a full slash command autocomplete system mirroring Claude Code CLI, allowing:

- `/` autocompletion to discover available commands
- Custom command definitions in `.claude/commands/` and `.claude/skills/`
- Rich metadata (description, icon, arguments) for each command
- Extensible architecture for adding new commands

---

## Implementation Approach

### High-Level Architecture

The system will layer on top of T3's existing infrastructure:

```
User types "/" in chat input
    ↓
Web detects "/" trigger (existing detectComposerTrigger)
    ↓
Web sends autocomplete request to server
    ↓
Server loads commands from:
  - Built-in command registry
  - .claude/commands/ directory
  - .claude/skills/ directory
    ↓
Server returns filtered suggestions based on query
    ↓
Web displays dropdown menu (using existing ComposerCommandMenu)
    ↓
User selects command → inserts command name or full template
```

### Design Decisions

1. **Reuse Existing Trigger System**: Extend the current `detectComposerTrigger()` logic instead of replacing it. The `/` prefix already triggers command detection.

2. **Extend ComposerSlashCommand Type**: Currently supports `"model" | "plan" | "default"`. Expand to include:
   - Built-in commands (e.g., `"run-tests"`, `"format"`, `"lint"`)
   - Loaded custom commands from `.claude/commands/` and `.claude/skills/`

3. **Server-Side Command Registry**: Create a `CommandRegistry` service that:
   - Scans `.claude/commands/` and `.claude/skills/` directories at server startup
   - Parses command metadata (name, description, arguments, icon)
   - Exposes `/commands/list` RPC method for web client autocomplete requests
   - Handles command execution routing

4. **Client-Side Metadata**: Store command metadata in a local cache to enable instant autocomplete while allowing server to update the list.

5. **Built-in Commands**: Start with foundational commands:
   - `/plan` - Existing, triggers planning mode
   - `/model` - Existing, switches AI provider/model
   - `/run-tests` - Run test suite
   - `/format` - Format code
   - `/lint` - Run linter
   - `/build` - Build project
   - `/docs` - Generate documentation
   - `/review-code` - Code review

---

## Implementation Plan

### Phase 1: Extend Web-Side Trigger & Menu System

**Files to modify:**

#### 1. `/g/t3code/apps/web/src/composer-logic.ts`

- **Change**: Expand `ComposerSlashCommand` type union to include command names loaded from server
- **Change**: Modify `detectComposerTrigger()` to track slash command queries more explicitly
- Add: `normalizeCommandName()` utility to handle command name parsing

**Before:**

```typescript
export type ComposerSlashCommand = "model" | "plan" | "default";
```

**After:**

```typescript
export type ComposerSlashCommand =
  | "model"
  | "plan"
  | "default"
  | "run-tests"
  | "format"
  | "lint"
  | "build"
  | string; // Allow dynamic commands from registry
```

#### 2. `/g/t3code/apps/web/src/components/ChatView.tsx`

- **Change**: Add state for tracking loaded slash commands metadata
  - `slashCommandsMetadata: SlashCommandMetadata[]`
  - `isLoadingSlashCommands: boolean`

- **Change**: Create Effect/hook to load commands on mount:

  ```typescript
  useEffect(() => {
    fetchSlashCommandsMetadata();
  }, []);
  ```

- **Change**: Extend `composerMenuItems` computation to include slash command suggestions:
  - Current: filters path entries and `["model", "plan", "default"]`
  - New: filter loaded `slashCommandsMetadata` based on trigger query
  - Include icon, description, argument hints in menu

- **Change**: Update `onSelectComposerItem()` handler to:
  - Insert full command template (not just command name)
  - For commands with arguments, include placeholders
  - Support command-specific pre-population (e.g., `/run-tests` → inserts full `bun run test` context)

#### 3. `/g/t3code/apps/web/src/nativeApi.ts`

- **Add**: New RPC method `commands.listSlashCommands()`
  ```typescript
  commands: {
    listSlashCommands: (query?: string) => Promise<SlashCommandMetadata[]>;
  }
  ```

### Phase 2: Create Slash Command Metadata Schema

**File to create:** `/g/t3code/packages/contracts/src/slashCommands.ts`

Define shared schema for command metadata:

```typescript
export const SlashCommandMetadata = Schema.Struct({
  id: Schema.String, // e.g., "run-tests", "format"
  name: Schema.String, // Display name
  description: Schema.String, // One-liner description
  category: Schema.Enum("development", "review", "build", "docs", "utility"),
  icon: Schema.optional(Schema.String), // lucide-react icon name
  template: Schema.optional(Schema.String), // Template text to insert on select
  handler: Schema.optional(Schema.Enum("built-in", "custom", "skill")), // Where it's defined
});

export type SlashCommandMetadata = Schema.To<typeof SlashCommandMetadata>;
```

### Phase 3: Implement Server-Side Command Registry

**Files to create/modify:**

#### 1. Create `/g/t3code/apps/server/src/commandRegistry/CommandRegistry.ts`

Core service that:

- Scans `.claude/commands/` and `.claude/skills/` directories at startup
- Parses command definitions (YAML frontmatter + markdown)
- Maintains in-memory registry
- Provides query interface for filtering commands

```typescript
export interface CommandRegistry {
  readonly getAll: () => SlashCommandMetadata[];
  readonly getByQuery: (query: string) => SlashCommandMetadata[];
  readonly getById: (id: string) => Option<SlashCommandMetadata>;
  readonly reload: () => Effect<void, CommandRegistryError>;
}
```

#### 2. Create `/g/t3code/apps/server/src/commandRegistry/CommandLoader.ts`

Utilities to:

- Parse `.md` files from `.claude/commands/` and `.claude/skills/` directories
- Extract YAML frontmatter (id, name, description, category, icon, template, etc.)
- Validate against `SlashCommandMetadata` schema
- Handle errors gracefully (skip invalid commands, log warnings)
- Called once at server startup, not on every request

#### 3. Create `/g/t3code/apps/server/src/commandRegistry/BuiltinCommands.ts`

Define hardcoded built-in commands:

- `/model` - Change provider/model
- `/plan` - Enter planning mode
- `/run-tests` - Run tests
- `/format` - Format code
- `/lint` - Lint code
- `/build` - Build project
- `/docs` - Generate docs
- `/review-code` - Code review

#### 4. Modify `/g/t3code/packages/contracts/src/ws.ts`

Add new RPC method to `WS_METHODS`:

```typescript
WS_METHODS = {
  // ... existing methods
  commandsListSlashCommands: "commands.listSlashCommands",
};
```

Add schema for request:

```typescript
export const CommandsListSlashCommandsRequest = Schema.Struct({
  query: Schema.optional(Schema.String), // Filter by query
  category: Schema.optional(Schema.String), // Filter by category
});
```

#### 5. Modify `/g/t3code/apps/server/src/wsServer.ts`

Add handler in `routeRequest()`:

```typescript
case WS_METHODS.commandsListSlashCommands: {
  const { query, category } = stripRequestTag(request.body);
  const commands = yield* CommandRegistry.getByQuery(query ?? "", category);
  return { commands };
}
```

### Phase 4: Set Up .claude Directory Structure

**Create directory structure:**

```
/g/t3code/.claude/
├── commands/
│   ├── README.md (guides users on creating custom commands)
│   ├── format.md (example command)
│   ├── lint.md (example command)
│   └── run-tests.md (example command)
└── skills/
    ├── README.md
    └── code-review.md (example skill)
```

**Each command file format (e.g., `/g/t3code/.claude/commands/format.md`):**

```markdown
---
id: format
name: Format Code
description: Format code with oxfmt
category: development
icon: wand2
---

# Format Code

Format your project with oxfmt.

This command runs:
\`\`\`bash
bun fmt
\`\`\`
```

### Phase 5: Implement Command Execution

**Execution Model: Smart Suggestions (Insert into Chat)**

When user selects a slash command from the menu:

**All commands** (built-in, custom, skills):

- Insert command suggestion/template into prompt
- Example: User selects `/run-tests` → inserts "Run the test suite with `bun run test`" into prompt
- User can then refine/customize and send to Claude/Codex for execution

This keeps the first iteration simple and leverages existing provider integration. Command execution logic lives with the provider (Claude/Codex), not the server.

**Modify `/g/t3code/apps/web/src/components/ChatView.tsx`:**

In `onSelectComposerItem()` handler, when command is selected:

1. Get command template/description from metadata
2. Insert text into prompt at trigger range
3. Close menu and refocus editor
4. (Optional) Move cursor after inserted text so user can continue typing

### Phase 6: Keyboard Navigation & UX

**Existing pattern already supports:**

- ↑/↓ arrow keys to navigate menu items
- Enter to select
- Esc to close menu

**No changes needed** - reuse existing `onComposerCommandKey()` logic.

---

## Critical Files Summary

| File                                                           | Role              | Change Type                                     |
| -------------------------------------------------------------- | ----------------- | ----------------------------------------------- |
| `/g/t3code/apps/web/src/composer-logic.ts`                     | Trigger detection | Extend `ComposerSlashCommand` type              |
| `/g/t3code/apps/web/src/components/ChatView.tsx`               | Chat UI + menu    | Load & filter slash commands, extend menu items |
| `/g/t3code/apps/web/src/nativeApi.ts`                          | RPC interface     | Add `commands.listSlashCommands()`              |
| `/g/t3code/packages/contracts/src/slashCommands.ts`            | Schema            | NEW: Define `SlashCommandMetadata`              |
| `/g/t3code/packages/contracts/src/ws.ts`                       | Protocol          | Add `commandsListSlashCommands` method          |
| `/g/t3code/apps/server/src/commandRegistry/CommandRegistry.ts` | Service           | NEW: Registry service with loader               |
| `/g/t3code/apps/server/src/wsServer.ts`                        | Request routing   | Add handler case for commands request           |
| `/g/t3code/.claude/commands/`                                  | Definitions       | NEW: Directory for custom commands              |
| `/g/t3code/.claude/skills/`                                    | Definitions       | NEW: Directory for skill definitions            |

---

## Built-In Commands (Initial Set)

1. **`/model`** - Switch provider/model (existing)
2. **`/plan`** - Enter planning mode (existing)
3. **`/run-tests`** - Run test suite
4. **`/format`** - Format code
5. **`/lint`** - Lint code
6. **`/build`** - Build project
7. **`/typecheck`** - TypeScript type check
8. **`/docs`** - Generate documentation
9. **`/review-code`** - Request code review

Each will include:

- Brief description (1-2 sentences)
- Category (development, review, build, docs, utility)
- Icon name (lucide-react)
- Optional argument hints

---

## Suggested Custom Commands/Skills (Future)

Users can create their own in `.claude/commands/` and `.claude/skills/`:

- `/git-status` - Show git status
- `/create-branch` - Create feature branch
- `/open-in-editor` - Open file in editor
- `/database-migration` - Generate DB migration
- `/api-endpoint` - Scaffold API endpoint
- `/component` - Create React component with tests
- `/setup-env` - Setup environment variables

---

## Testing & Verification

### Unit Tests

- Test `CommandRegistry.getByQuery()` with various filters
- Test command loading from `.md` files
- Test metadata schema validation

### Integration Tests

- Test `/commands.listSlashCommands` RPC endpoint
- Test trigger detection for `/` prefix in ComposerPromptEditor
- Test menu item generation from loaded commands
- Test command selection and insertion

### End-to-End Tests

1. Start T3 code server
2. Open web client
3. Click chat input and type `/`
4. Verify dropdown shows available commands
5. Type `/ru` and verify filtered to `/run-tests`
6. Select `/run-tests` and verify command template inserted
7. Modify and send message
8. Verify provider handles the message correctly

### Manual Testing Checklist

- [ ] Type `/` → see all commands
- [ ] Type `/f` → see only commands starting with 'f' (format, etc.)
- [ ] Type `/run-tests` and press Enter → command template inserted
- [ ] Arrow up/down navigates menu
- [ ] Esc closes menu
- [ ] Add custom command to `.claude/commands/` → appears in suggestions
- [ ] Create skill in `.claude/skills/` → appears in suggestions

---

## Success Criteria

✅ **Functional:**

- Typing `/` shows autocomplete dropdown with command suggestions
- Filtering by typing works (`/run` → filters to `run-tests`)
- Command selection inserts appropriate template
- Custom commands in `.claude/commands/` are discovered and shown
- Skills in `.claude/skills/` are discovered and shown

✅ **UX:**

- Dropdown appears immediately (no lag)
- Command descriptions visible in menu
- Icons render correctly
- Keyboard navigation smooth (↑/↓/Enter/Esc)

✅ **Extensibility:**

- Users can add custom commands by creating `.md` files in `.claude/commands/`
- Server detects and indexes new commands without restart
- Command metadata is consistent across web UI and server

---

## Implementation Order

1. **Start**: Extend web-side trigger & menu (Phase 1)
2. **Schema**: Define slash command metadata schema (Phase 2)
3. **Registry**: Build server-side command registry (Phase 3)
4. **Directory**: Set up `.claude/` structure (Phase 4)
5. **Execution**: Implement command selection & insertion (Phase 5)
6. **Polish**: Add keyboard navigation & UX refinements (Phase 6)
7. **Test**: Run through test & verification checklist

---

## Notes

- This leverages T3's existing `detectComposerTrigger()` and `ComposerCommandMenu` infrastructure, minimizing churn
- **Execution Model**: Commands are "smart suggestions" inserted into the chat. Users send them to Claude/Codex for execution. This keeps Phase 1 simple and leverages existing provider integration.
- **No Arguments in Phase 1**: Commands can be defined but don't support dynamic arguments (e.g., `$PROJECT_ROOT`). Can be added in future iterations.
- **Load Once at Startup**: Commands are loaded from `.claude/` directories when the server starts. No hot reload. Users restart server to pick up new command definitions.
- Future iterations could add: direct server-side command execution, argument support, hot reload, command chaining, etc.
- The `.claude/` directory structure mirrors Claude Code CLI conventions, making it familiar to users

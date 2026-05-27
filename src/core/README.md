# core/

Reusable plumbing every fork of this template builds on. This directory
is the stable surface for bespoke UIs — everything under `@/core/*` is
expected to stay shape-compatible as the template evolves.

**Do not put feature-specific code here.** Domain UI (a flight picker,
a seat map, an architectural diagram) lives under `src/features/<your-app>/`.
The canonical example in this repo is
[src/features/diagram/](../features/diagram/) — its docs are
[src/features/diagram/README.md](../features/diagram/README.md) and
[docs/diagram.md](../../docs/diagram.md).

## Layout

```
core/
  apiAdapter.ts            REST + WebSocket + tool_result_from_ui + closeSession
  hooks/
    useClaudeSession.ts    stream-json → state, pending-tool queue, reset
    useTheme.ts            light/dark toggle, localStorage-backed
  components/
    AppShell.tsx           Files | Code | Chat | Diagram resizable group
    ChatView.tsx           default customer-facing chat (bubbles + markdown)
    SessionRunner.tsx      lower-level primitive, no bubbles
    MessageList.tsx        raw stream-json dump
    PromptInput.tsx        textarea + Send/Cancel
    PendingToolCalls.tsx   dock-style tool-call renderer
    Markdown.tsx           react-markdown + remark-gfm wrapper
    ThinkingBubble.tsx     bouncing-dots loader
    ThemeToggle.tsx        sun/moon icon button
  tools/
    registry.ts            clientToolRegistry + toolResultRegistry + types
    builtins/              the live project-file tools (see below)
  project.tsx              ProjectContext + upload + tree + code editor +
                           buildChatSystemPrompt
```

## What each layer owns

- **`apiAdapter.ts`** is the single seam between frontend code and the
  backend. Components should never call `fetch(...)` or
  `new WebSocket(...)` directly — route through `apiCall(command, params)`,
  `resolveClientToolCall(...)`, and `closeSession(...)`. (The one
  exception today is the diagram's `/api/diagram` fetcher; it lives
  inside the feature module, not in core.)
- **`useClaudeSession`** is the only intended way to drive a conversation.
  It exposes `send`, `cancel`, `reset`, `resolveToolCall`,
  `removePendingToolCall`, plus the reactive `messages`, `status`,
  `error`, `pendingToolCalls`, and `sessionId`.
- **`<ChatView>`** is the default UI most forks keep or lightly restyle.
  For non-bubble layouts, compose `<SessionRunner>` or assemble
  `MessageList` + `PromptInput` + `PendingToolCalls` yourself.
- **`tools/registry.ts`** carries two small registries populated at app
  boot in `src/main.tsx`: `clientToolRegistry` (name → React component
  handler for a client tool) and `toolResultRegistry` (name → React
  component that renders a tool's result bubble). Both are optional to
  extend — unregistered tools fall back to sensible defaults.
- **`project.tsx`** owns the uploaded project: file array, open tabs,
  active path, the code editor, and `buildChatSystemPrompt` (the
  first-turn system prompt that tells Claude about the three project-
  file tools).

## Builtins shipped today

`tools/builtins/` carries the three client tools `src/main.tsx`
registers. Each pairs with a result-card renderer for a friendlier
post-resolution bubble in chat.

| File                              | Registered for           |
| --------------------------------- | ------------------------ |
| `ReadProjectFile.tsx`             | `read_project_file`      |
| `ReadProjectFileResultCard.tsx`   | `read_project_file` result |
| `WriteProjectFile.tsx`            | `write_project_file`     |
| `WriteProjectFileResultCard.tsx`  | `write_project_file` + `edit_project_file` results |
| `EditProjectFile.tsx`             | `edit_project_file`      |

These three are how Claude reads + edits the user's uploaded project
without any server-side filesystem exposure — handler logic runs in
the browser and mutates `ProjectContext.files` directly.

Forks that want different domain tools should:

1. Declare them on the backend in `backend/src/main.rs` via
   `b.client_tool(...)` (or `b.server_tool(...)` for ones that don't
   need a UI surface).
2. Add their React component (if a client tool) under their feature
   folder, e.g. `src/features/<your-app>/SomePicker.tsx`.
3. Register in `src/main.tsx` via `registerClientTool(name, Component)`
   and optionally `registerToolResult(name, ResultCard)`.

See [docs/tools.md](../../docs/tools.md) for the full plumbing
reference.

## Import style

Import from deep paths today (`@/core/hooks/useClaudeSession`,
`@/core/tools/registry`, etc.) — there's no barrel `index.ts`. If your
fork wants one, add it at the top of this directory and keep the
public surface narrow.

Features import this layer freely. **Core MUST NOT import from
features.** The chat ↔ diagram bridge in this repo respects that by
having ChatView import a handful of small protocol helpers from
`@/features/diagram` (events bus, parsers, two render-helper
components) — no React Flow, dagre, or rendering internals reach core.

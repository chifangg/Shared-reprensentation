# Architecture

A layered view of the codebase, the dependency rules between layers,
and how data flows between the browser, the Rust backend, and Claude.

## Three layers

```
┌─────────────────────────────────────────────────────────────────┐
│  App shell    src/App.tsx + src/core/components/AppShell.tsx    │
│                                                                 │
│  Composes the providers and panels: ProjectProvider →           │
│  DiagramBusProvider → AppShell { Files | Code | Chat | Diagram }│
└─────────────────────────────────────────────────────────────────┘
              ▲                                ▲
              │ imports                        │ imports
              │                                │
┌─────────────────────────┐         ┌──────────────────────────┐
│  Features (domain UI)   │         │  Core (stable plumbing)  │
│                         │ imports │                          │
│  src/features/diagram/  │────────►│  src/core/               │
│                         │         │                          │
│  - types                │         │  - apiAdapter (WS)       │
│  - protocol (bus,       │         │  - useClaudeSession      │
│    sentinels, parsers,  │         │  - ChatView              │
│    prompts)             │         │  - tools/ registry       │
│  - layout (dagre)       │         │  - project context       │
│  - api (/api/diagram)   │         │  - PromptInput / Markdown│
│  - hooks                │         │                          │
│  - components           │         │                          │
└─────────────────────────┘         └──────────────────────────┘
```

### Dependency rule

- **App shell may import from both** core and features.
- **Features MAY import from core** — that's how they reuse the chat
  plumbing, project state, useClaudeSession, etc.
- **Core MUST NOT import from features.** This is the rule
  [src/core/README.md](src/core/README.md) calls out and the
  refactoring that produced this layout enforces. The chat ↔ diagram
  seam crosses the boundary through the `DiagramBusProvider` (defined
  in features, mounted by the app shell, consumed by both ChatView and
  the canvas).
- **Features must not import each other** (we have one today; the rule
  is a placeholder for future cross-feature work).

In practice this means `@xyflow/react` and `@dagrejs/dagre` never leak
into `src/core/*`. ChatView's diagram-related code is a small set of
imports from `@/features/diagram` (bus hooks, two parsers, two
render-helper components, types) — no rendering library reaches it.

## Frontend ↔ backend seams

Two endpoints carry all traffic:

1. **WebSocket `/ws/claude`** — streaming Claude turns.
   - Client opens via `src/core/apiAdapter.ts`, sending `command_type`,
     `prompt`, `model`, `session_id`, `client_session_id`, `extra`.
   - Backend spawns `claude` with `--mcp-config` pointing at the
     `tool-bridge` binary; bridges every tool call to its server-side
     handler or to the frontend (for client tools).
   - Server emits stream-json frames as `output`, `tool_call_for_ui`,
     `completion`, `error`, `cancelled`. apiAdapter dispatches them as
     session-scoped `CustomEvent`s; `useClaudeSession` subscribes.

2. **HTTP `POST /api/diagram`** — diagram structure + focus fetches.
   - Streaming NDJSON. One event per line:
     - `{kind:"block", data:DiagramBlock}` — view=structure
     - `{kind:"arrow", data:DiagramArrow}` — view=structure
     - `{kind:"focus", ids:string[]}` — view=focus
     - `{kind:"detail_block", data:DiagramBlock}` — view=focus
     - `{kind:"detail_arrow", data:DiagramArrow}` — view=focus
     - `{kind:"error", message:string}`
   - Implemented in `src/features/diagram/api/{fetchStructure,fetchFocus}.ts`.

`POST /api/sessions/{id}/cancel` cancels a streaming Claude session.

## Data flow

### Upload → ProjectContext → consumers

```
User uploads (folder | .zip)
        │
        ▼
readFolderInput | readZipFile (jszip)
        │  FileEntry[]
        ▼
ProjectContext.loadFiles(entries)
        │
        ├─► FileTree         (Files panel)
        ├─► CodeViewer       (Code panel — syntax-highlighted edit)
        ├─► ChatView         (system prompt on first turn via
        │                     buildChatSystemPrompt)
        └─► DiagramCanvas    (initial fetch via buildProjectContext
                              + fetchStructureStream)
```

`projectKey` (bumps only on USER upload/reset) gates a full diagram
wipe. Claude calling `write_project_file` mid-turn changes the `files`
array but NOT `projectKey`, so the diagram never wipes on its own
edits.

### Chat turn

```
User types prompt → ChatView.handleSend(prompt)
        │
        ▼
useClaudeSession.send(prompt) → apiAdapter.apiCall("execute_claude_code", …)
        │
        ▼
WebSocket /ws/claude open → backend spawns `claude --mcp-config tool-bridge.json`
        │
        ▼
stream-json frames ← Claude
        │
        ▼
apiAdapter dispatches `claude-output:<sid>` events
        │
        ▼
useClaudeSession state.messages grows
        │
        ▼
ChatView projects messages → turns → bubbles
        │
        ▼ (also published to ProjectContext.chatMessages / chatRunning)
        │
        ▼
DiagramCanvasInner watches chatRunning → useChatSettleEffect
```

### Chat ↔ diagram bus (the visual-edit protocol)

```
Diagram side (canvas)                  Chat side (ChatView)
─────────────────────                  ────────────────────
User drags arrow / clicks ⋯ / "+"
        │
        ▼
IntentGate (describe vs ask)
        │
        ▼ (ask path)
bus.emit("visual-edit", round-1 prompt) ────► useDiagramBusSubscribe("visual-edit")
                                                       │
                                                       ▼
                                              handleSend(prompt)
                                                       │
                                                       ▼
                                              session.send → Claude turn
                                                       │
                                                       ▼
                                              Claude emits options JSON
                                                       │
                                                       ▼
                                              OptionsHandoff parses + emits
bus listener for "options-ready" ◄──────────  bus.emit("options-ready", {target, options})
        │
        ▼
ConnectionOptionsOverlay renders cards
        │
        ▼
User picks a card
        │
        ▼
bus.emit("option-executed", …)               (internal: chosenOptionsRef populates)
bus.emit("visual-edit", round-2 prompt) ────► same path again
                                                       │
                                                       ▼
                                              Claude reads + edits files
                                                       │
                                                       ▼
                                              ArrowsAddedSink parses
bus listener for "arrows-added" ◄──────────  bus.emit("arrows-added", …)
        │
        ▼
schema gains pending="claude" arrows
        │
        ▼
chatRunning falls (Claude done) → useChatSettleEffect runs
        │
        ├─► commits arrow outcomes from chosenOptionsRef
        ├─► extracts editSummary from last assistant turn
        ├─► if files were edited: snapshot schema + bump retryNonce → regen
        └─► flushes settled blocks / arrows into recentChanges (glow)
```

Sentinel markers embed metadata in user prompts so the chat renderer
can collapse long visual-edit bodies into compact bubbles, and so
`parseTargetMetadata` can recover the EditTarget when cards arrive
later in the conversation. See [docs/diagram.md](docs/diagram.md) for
the full grammar.

## State ownership

| State                                | Owner                                  | Reset on                       |
| ------------------------------------ | -------------------------------------- | ------------------------------ |
| Uploaded files                       | ProjectContext                         | upload / "clear and re-upload" |
| Open tabs + active path              | ProjectContext                         | upload                         |
| chatMessages (broadcast)             | ChatView → ProjectContext              | New chat                       |
| chatRunning                          | ChatView → ProjectContext              | turn settle                    |
| projectKey (invalidates diagram)     | ProjectContext                         | USER upload / reset only       |
| session UUID + pending tool calls    | useClaudeSession                       | session.reset() / New chat     |
| FetchState (structure)               | useDiagramStructureFetch               | projectKey                     |
| focused (panel content)              | useAdaptiveFocus                       | projectKey                     |
| recentChanges (glow)                 | useRecentChanges + useChatSettleEffect | next user action               |
| editSummary (toast)                  | useEditSummary + useChatSettleEffect   | next user action               |
| selectedId / pendingOptions /        | DiagramCanvasInner                     | various                        |
|   intentGate / promoted / panelWidth |                                        |                                |
| Diagram bus                          | DiagramBusProvider (singleton in tree) | provider mount                 |

## Where features live

- **Chat:** `src/core/components/ChatView.tsx` + `src/core/hooks/useClaudeSession.ts`
- **Project upload + tree + editor:** `src/core/project.tsx`
- **Diagram:** the whole `src/features/diagram/` tree
- **Tool plumbing:** `src/core/tools/registry.ts` + `src/core/tools/builtins/`
  + `src/main.tsx` for registration
- **Backend:** `backend/src/web_server.rs` + `backend/src/core/tools.rs`
  + `backend/src/bin/tool_bridge.rs`

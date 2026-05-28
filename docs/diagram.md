# The diagramming feature

A reference for how the diagram talks to Claude Code and to the chat
view. Everything documented here lives under
[src/features/diagram/](../src/features/diagram/).

## Overview

The diagram is an interactive architectural view of an uploaded
project. Blocks are modules (file groups + their public functions);
arrows are dependencies (imports, fetches, subscriptions, …). It runs
on top of [@xyflow/react](https://reactflow.dev) for rendering and
[@dagrejs/dagre](https://github.com/dagrejs/dagre) for top-to-bottom
auto-layout.

Two views:

- **Project overview** (default): the full diagram, settled by an
  initial streaming fetch and updated by post-edit regens.
- **Adaptive focus**: a side panel that streams in detail blocks
  relevant to the most recent chat turn (1.2 s debounce on each
  user-message increment).

Four user-initiated visual edits drive Claude:

1. **Drag an arrow** between two blocks.
2. **Click "⋯"** on a block (block actions).
3. **Click "+" or double-click empty canvas** (new module).
4. **Double-click a block label** (rename).

The first three open an IntentGate modal with "Describe it yourself"
vs "Ask Claude for suggestions". Rename is a slow path: schema updates
immediately, Claude is asked to rewrite the corresponding identifier
in code.

## Data shapes

Defined in [src/features/diagram/types.ts](../src/features/diagram/types.ts).

```ts
type DiagramSchema = { blocks: DiagramBlock[]; arrows: DiagramArrow[] };

type DiagramBlock = {
  id: string;
  label: string;
  caption: string;
  parent: string | null;
  provenance: { files: string[]; functions: string[] };
  pending?: boolean;          // dashed border + marching-ants placeholder
};

type DiagramArrow = {
  from: string;
  to: string;
  label: string;
  pending?: "intent" | "claude";
  //   intent → user is describing this arrow's meaning
  //   claude → user dismissed the popover; Claude is reacting
  //   undefined → settled
};

type EditTarget =
  | { kind: "arrow"; from: string; to: string }
  | { kind: "block"; id: string }
  | { kind: "new-block" };

type ConnectionOption = {
  title: string;
  detail: string;
  kind: "block_level" | "detail" | "none";
  label?: string;             // only used when kind="block_level" + target.kind="arrow"
};
```

## The `/api/diagram` endpoint

Single endpoint, `POST /api/diagram`, response is streaming NDJSON
(one JSON object per line, separated by `\n`).

Request body:

```json
{
  "project_context": "<XML-tagged file tree + bodies, see buildProjectContext.ts>",
  "view": "structure" | "focus",
  "chat_context": "<recent turns, only when view=focus>",
  "base_schema": "<existing block labels JSON, only when view=focus>"
}
```

Response events (one per line):

| `kind`           | Payload                                               | View       |
| ---------------- | ----------------------------------------------------- | ---------- |
| `block`          | `data: DiagramBlock`                                  | structure  |
| `arrow`          | `data: DiagramArrow`                                  | structure  |
| `error`          | `message: string`                                     | structure  |
| `focus`          | `ids: string[]` (base blocks the chat is about)       | focus      |
| `detail_block`   | `data: DiagramBlock` (zoomed-in block)                | focus      |
| `detail_arrow`   | `data: DiagramArrow` (connecting arrow within focus)  | focus      |

Parsed by
[fetchStructure.ts](../src/features/diagram/api/fetchStructure.ts) and
[fetchFocus.ts](../src/features/diagram/api/fetchFocus.ts) into typed
discriminated unions. Unknown event shapes drop silently.

## The bus

The chat ↔ diagram seam is a typed pub/sub bus exposed via React
Context. See
[src/features/diagram/protocol/bus.tsx](../src/features/diagram/protocol/bus.tsx).

Topics + payloads (one source of truth in
[events.ts](../src/features/diagram/protocol/events.ts)):

| Topic              | Payload                | Emitter                          | Subscriber           |
| ------------------ | ---------------------- | -------------------------------- | -------------------- |
| `visual-edit`      | `VisualEditDetail`     | Diagram (dispatch helpers, rename) | ChatView             |
| `options-ready`    | `OptionsReadyDetail`   | ChatView (`OptionsHandoff`)      | Diagram              |
| `option-executed`  | `OptionExecutedDetail` | Diagram (card click + describe-direct) | Diagram (internal) |
| `arrows-added`    | `ArrowsAddedDetail`    | ChatView (`ArrowsAddedSink`)     | Diagram              |

`useDiagramBus()` returns the bus; `useDiagramBusSubscribe(topic, handler)`
subscribes for the component's lifetime with a fresh handler ref so
the callback always sees the latest closure.

## Sentinels

Two layers of markers embedded in user-message prompts. See
[src/features/diagram/protocol/sentinels.ts](../src/features/diagram/protocol/sentinels.ts).

### Outer sentinel — line 1

```
<<diagram-edit summary="Suggestions for connection">>
```

Detected by `parseVisualEditMessage` in ChatView; collapses the long
prompt body into a "see prompt" expander bubble.

### Inner target sentinel — line 2

| Target kind   | String                                                    |
| ------------- | --------------------------------------------------------- |
| arrow         | `<<arrow from="<from-id>" to="<to-id>">>`                 |
| block         | `<<block id="<block-id>">>`                               |
| new-block     | `<<new-block>>`                                           |

Recovered by `parseTargetMetadata` so when Claude's response arrives
later in the conversation, the chat-side `OptionsHandoff` can fire
`options-ready` with the right `EditTarget`.

## JSON tails

Claude's assistant turns embed structured tails as fenced JSON code
blocks. The chat side scans ALL ```json blocks per turn (not just the
first); parsers in
[parsers.ts](../src/features/diagram/protocol/parsers.ts) ignore
anything that doesn't shape-match.

### Round-1 options block

```json
{
  "options": [
    { "title": "Imports fooClient", "detail": "...", "kind": "block_level", "label": "imports" },
    { "title": "Cache locally", "detail": "...", "kind": "detail" },
    { "title": "No change", "detail": "...", "kind": "none" }
  ]
}
```

Parsed by `parseOptionsBlock`. Surfaced to the diagram via
`options-ready`. Cards render in ConnectionOptionsOverlay.

### Round-2 added_arrows block

```json
{
  "added_arrows": [
    { "from": "Frontend App", "to": "Canvas Server", "label": "imports" }
  ]
}
```

Mandatory tail on every round-2 execute response. Parsed by
`parseAddedArrowsBlock`. Surfaced to the diagram via `arrows-added`.
Labels are resolved against the current schema's block labels (exact
match first, then fuzzy substring); unresolved labels log a `dwarn`
in dev.

## The two-round flow

```
       User                     Diagram                    ChatView                    Claude
        │                          │                          │                          │
        │  drag arrow              │                          │                          │
        ├─────────────────────────►│                          │                          │
        │                          │ schema gets pending      │                          │
        │                          │ arrow + IntentGate opens │                          │
        │  pick "Ask suggestions"  │                          │                          │
        ├─────────────────────────►│                          │                          │
        │                          │ bus.emit("visual-edit",  │                          │
        │                          │   round-1 prompt) ───────► handleSend(prompt)       │
        │                          │                          ├─────────────────────────►│
        │                          │                          │                          │ options JSON
        │                          │                          │ OptionsHandoff parses    │
        │                          │ bus.emit("options-ready",│   "options-ready" payload│
        │                          │   {target, options}) ◄───┤                          │
        │                          │ ConnectionOptionsOverlay │                          │
        │                          │ renders cards            │                          │
        │  click a card            │                          │                          │
        ├─────────────────────────►│                          │                          │
        │                          │ bus.emit("option-executed│                          │
        │                          │ → chosenOptionsRef       │                          │
        │                          │ bus.emit("visual-edit",  │                          │
        │                          │   round-2 prompt) ───────► handleSend(prompt)       │
        │                          │                          ├─────────────────────────►│
        │                          │                          │                          │ read_project_file
        │                          │                          │                          │ edit_project_file
        │                          │                          │                          │ summary + added_arrows
        │                          │                          │ ArrowsAddedSink parses   │
        │                          │ bus.emit("arrows-added"  │                          │
        │                          │   added arrows) ◄────────┤                          │
        │                          │ schema gains pending=    │                          │
        │                          │   "claude" arrows        │                          │
        │                          │                          │ chatRunning ↓            │
        │                          │ useChatSettleEffect runs │                          │
        │                          │  - applies arrow outcomes│                          │
        │                          │  - extracts editSummary  │                          │
        │                          │  - if files edited:      │                          │
        │                          │    snapshot + regen      │                          │
        │                          │  - flush recentChanges   │                          │
        │  sees glow + toast       │                          │                          │
        │◄─────────────────────────┤                          │                          │
```

The "Describe yourself" path skips round-1. The IntentGate's
`onDescribe` fires `option-executed` optimistically with a synthesized
option, then dispatches a round-2 execute prompt with the user's
free-text. Claude must decide whether the description is concrete
enough — if vague, it bails out with an options-shape JSON instead of
editing code.

## Settle-effect decision tree

`useChatSettleEffect` ([code](../src/features/diagram/hooks/useChatSettleEffect.ts))
runs once each time `chatRunning` transitions `true → false`. Branches:

```
chosenOptionsRef has ARROW entries?
├── yes → apply per-arrow outcome (block_level keeps + labels;
│         detail/none drops). Settle any pending="claude" arrows
│         that came in via arrows-added. No regen.
└── no  → are any arrows still pending="claude"?
         ├── yes → settle them. No regen.
         └── no  → was there a non-arrow chosen option (block / new-block)?
                  ├── yes → commit placeholder block to chosen title/detail.
                  │        No regen.
                  └── no  → did the just-finished turn use
                           edit_project_file or write_project_file?
                           ├── yes → snapshot schema, setState→idle,
                           │         bump retryNonce → useDiagramStructureFetch
                           │         re-fetches. After "ready" lands,
                           │         useRecentChanges diffs and glows.
                           └── no  → no-op chat reply. Do nothing.
```

Always (every settle):

- Extract edit summary from the last assistant turn → `editSummary`.
- Flush `settledBlockIds` / `settledArrowKeys` → `recentChanges`.

**CRITICAL:** the next-blocks / next-arrows / settled-sets computation
MUST happen synchronously before any setState. Side-effect mutations
inside a setState updater run on the next render — the size check at
the bottom would silently see empty sets and skip the recentChanges
flush, leaving the canvas grey even though something settled. This is
load-bearing and documented in code comments.

## `pending` state machines

### Arrow `pending`

```
undefined ── user drags arrow ──► "claude" (marching-ants)
                                       │
                                       │ chatRunning settles
                                       ▼
                                  undefined (solid)
```

`pending="intent"` is reserved for the popover-driven path that was
deprecated in favor of the centralized IntentGate modal; it stays in
the type union for backwards compatibility but isn't currently produced.

### Block `pending`

```
false ── user clicks "+" / dbl-click pane ──► true (dashed blue)
                                                  │
                                                  │ user picks option in IntentGate
                                                  │  → chosenOptionsRef gets the option
                                                  │
                                                  │ OPTION_EXECUTED listener renames
                                                  │ "New module…" → option.title
                                                  │ (still pending=true so dashed border)
                                                  │
                                                  │ chatRunning settles
                                                  ▼
                                              undefined / removed by regen
```

## Debugging knobs

Set `VITE_DIAGRAM_DEBUG` to a comma-separated list of scopes (or `*`
for all):

```bash
VITE_DIAGRAM_DEBUG=recent-debug,diagram/structure,diagram/focus bun run dev
```

Scopes currently emit:

| Scope                   | What you'll see                                          |
| ----------------------- | -------------------------------------------------------- |
| `recent-debug`          | settle-effect entry/exit, schema snapshots, recent-changes |
| `recent-debug:settle entry — schema snapshot` | per-turn schema (specific sub-scope)         |
| `recent-debug:shouldRegen walk`             | the chat-walk that decides regen vs no-regen  |
| `recent-debug:arrows-added handler` / `applied` | label resolution + final arrows added       |
| `recent-debug:attachInteractive ran`        | which blocks got `onActions` + recent flag    |
| `recent-debug:tagRecentEdges ran`           | which edges got the glow class                |
| `recent-debug:base-canvas layout effect`    | layout effect inputs                          |
| `recent-debug:diff effect fired`            | what the diff hook saw                        |
| `diagram/structure`     | every NDJSON event from /api/diagram?view=structure        |
| `diagram/focus`         | every NDJSON event from /api/diagram?view=focus            |

`dwarn` always fires in dev (used for unresolved `added_arrows`
labels). All `dlog` and `dwarn` calls are tree-shaken from production
builds via `import.meta.env.DEV`.

## Module layout

See [src/features/diagram/README.md](../src/features/diagram/README.md).

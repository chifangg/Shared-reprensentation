# Getting started

A hands-on walkthrough of what this app actually does. Follow this
once, top to bottom, and you'll understand the chat ↔ diagram loop —
which is the whole point.

- High-level pitch + repo layout + configuration → [main README](../README.md).
- Architecture diagrams + dependency rules → [ARCHITECTURE.md](../ARCHITECTURE.md).
- The diagramming protocol reference → [docs/diagram.md](./diagram.md).
- Adding new client / server tools → [docs/tools.md](./tools.md).

## 1. Run the app

Prerequisites: [Bun](https://bun.sh) 1.3+, Rust 1.70+ with cargo, and
the [Claude Code CLI](https://claude.ai/code) on `PATH`. Export your
`ANTHROPIC_API_KEY` (or whichever auth the Claude CLI is configured
for).

```bash
bun install
bun run dev                                       # http://localhost:1420
# In a second terminal:
cd backend && cargo run --bin claude-ui-app       # http://localhost:8080
```

Open `http://localhost:1420`. You should see four empty panels:
Files | Code | Chat | Diagram.

## 2. Upload a project

In the Files panel, click **upload folder** and pick a small project
(anything under a few hundred files). `.zip` works too — useful if
you want to share the exact upload as a fixture.

The diagram panel immediately shows "Claude is drawing the diagram…"
and starts streaming blocks. First block usually appears within ~5 s;
the bottom-right "Generating more — N so far" chip tracks progress
until the layout settles.

## 3. Chat without editing

Type something like "what does this codebase do?" and hit Send.

What you'll see:

- A "thinking…" bubble while Claude reads files (it'll fire a few
  `read_project_file` client tools — each renders inline in the
  conversation as it's called).
- A natural-language reply.
- **The diagram does NOT regenerate** — Claude only read files; no
  files changed.

This is the gate that keeps the diagram from churning on every chat
turn. The check is in
[src/features/diagram/hooks/useChatSettleEffect.ts](../src/features/diagram/hooks/useChatSettleEffect.ts):
auto-regen only fires when the just-finished turn used
`edit_project_file` or `write_project_file`.

## 4. Chat with editing

Try: "Add a `// hello, world` comment at the top of the first source
file you find."

What you'll see:

1. `read_project_file` to inspect.
2. `edit_project_file` (or `write_project_file`) — the affected file
   updates in the Code panel in real time as Claude calls the tool.
3. Claude summarizes in 1–2 sentences.
4. The diagram panel blurs and re-streams (auto-regen).
5. A floating **"Just edited"** toast lands at the bottom-center
   showing the file pill + Claude's summary line.
6. Any new blocks or arrows that appeared during the regen glow blue
   ("recent change") until your next action.

The toast and glow are intentional — they show the user *what* just
happened on the diagram, separate from scrolling the chat to find the
relevant assistant turn.

## 5. Visual edit — draw an arrow

Hover a block. Four connection handles appear (one per side, grey
dots that tint blue + grow). Pull from one block to another.

A dashed blue marching-ants arrow shows up immediately. The **Intent
Gate** modal opens with two paths:

- **Describe it yourself** — for when you already know the change you
  want. Skips the suggestions round-trip.
- **Ask Claude for suggestions** — for when you'd rather see a few
  options. Claude returns 3–5 cards.

### Ask suggestions

Click **"Ask Claude for suggestions"**.

1. A "diagram edit" bubble appears in chat with the summary
   ("Suggestions for connection"). The actual prompt body — context
   lines, instructions, kind guide — is collapsed behind a "see
   prompt" expander.
2. Claude streams a JSON options block. The chat replaces the JSON
   with a minimal "Please select your desired change from the canvas
   → N suggestions ready." line.
3. On the diagram canvas, a cards overlay appears with the options +
   a free-form "Others…" card.
4. Each option has a `kind` chip:
   - **link** (blue) — `kind: "block_level"`. Picking this keeps the
     arrow and applies the label Claude proposed.
   - **detail** (orange) — `kind: "detail"`. Picking drops the arrow;
     the change is small enough to live inside one block.
   - **no change** (grey) — `kind: "none"`. Picking drops the arrow
     and Claude confirms why no change is needed.
5. Click an option. Claude executes the change, writes the relevant
   file(s), and emits a trailing `added_arrows` JSON listing any new
   dependencies the edit actually introduced. The diagram picks those
   up immediately with marching-ants, settling once the turn finishes.

### Describe yourself

Click **"Describe it yourself"** instead. A textarea opens. Type a
specific change ("App.tsx fetches user data from the auth service")
and press ⌘↩. Claude executes directly — skipping the suggestions
round-trip — and the same `added_arrows` tail flows back.

If your description is vague ("make it better", "refactor"), Claude
falls back to returning options instead of editing.

### Others…

In the cards overlay, click the dashed **Others…** card. It expands
to a free-form text input. Type a custom intent and Send — same
behavior as "Describe yourself" from inside the cards UI.

## 6. Visual edit — block actions

Hover an existing block. A "⋯" affordance appears at its top-right.
Click it. The Intent Gate opens with "Block action" eyebrow. Same
two paths (describe vs ask) — Claude proposes changes scoped to that
block.

## 7. Visual edit — add a new module

Two ways:

- **Floating "+" FAB** at the bottom-right of the canvas.
- **Double-click empty canvas.**

A dashed blue placeholder block appears with the label "New module…",
then the Intent Gate opens with "New module" eyebrow. Pick any of the
options or describe what you want. Claude creates the file(s); the
placeholder's label updates eagerly to the option's title; the
auto-regen settles it into a real block in its real layout position.

## 8. Visual edit — rename a block

Double-click a block's label. An inline input appears. Type a new
name, press Enter. Two things happen:

- The block's label updates immediately on the diagram.
- A "Renamed block: old → new" diagram-edit bubble appears in chat.
  Claude reads the block's recorded files + functions and rewrites the
  corresponding identifier(s) in source.

This is the slow path: the diagram reflects the new label instantly
(so the user has feedback), and Claude catches up in the background.

## 9. Adaptive focus

Click the view dropdown in the diagram panel header. Switch from
**"Project overview"** to **"Adaptive focus"**.

You'll see a top-center "Adaptive focus mode · diagram will refocus
when you chat" banner. The main canvas looks the same until you send
a chat message.

Send a chat about a specific topic ("explain the upload flow"). After
~1.2 s of debounce (so streaming chunks don't trigger a fetch per
chunk):

1. A "Refocusing on the conversation…" pill appears top-right.
2. A side panel slides in from the right.
3. The base blocks the chat is about glow yellow (focus pulse);
   everything else dims to 30% opacity.
4. The camera pans to the focused blocks.
5. Detail blocks stream into the side panel — a mini React-Flow with
   ghost re-stamps of the focused base blocks at the top and
   zoomed-in detail blocks below.

Click a detail block in the panel to expand it (shows full file +
function lists). Click the "+" on a detail block to promote it onto
the main canvas — it gets added to the schema alongside the base
blocks and persists across panel close / re-open.

Switch the view back to "Project overview": the panel disappears, the
dimming clears, but the focused state is retained — switch back to
focus and the previous content is right there without re-asking.

## 10. New chat / re-upload

- **"New chat"** (top-right of the chat panel) wipes the conversation
  and generates a fresh session UUID. The diagram does NOT wipe —
  this is the `projectKey` vs `filesKey` invariant. Claude can
  legitimately keep editing the same project across multiple chats.
- **"clear files and re-upload"** at the bottom of the Files panel
  wipes everything: files, diagram, chat (implicitly, since uploading
  a new project resets `projectKey`).

## Where to next

- **[docs/diagram.md](./diagram.md)** — the diagramming protocol in
  full: events, sentinels, JSON tails, sequence diagrams, settle-
  effect branches, `pending` state machines.
- **[ARCHITECTURE.md](../ARCHITECTURE.md)** — the layered model and
  the dependency rule between `src/core/*` and `src/features/diagram/*`.
- **[docs/tools.md](./tools.md)** — adding new client / server tools.
  The patterns are still accurate even though this fork doesn't ship
  the original example tools (`get_weather`, `show_choice`,
  `search_flights`) anymore.
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** — coding standards, PR
  workflow, testing expectations.

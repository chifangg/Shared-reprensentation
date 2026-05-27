# features/diagram/

The diagramming feature: an interactive architectural diagram of the
uploaded project, driven by `@xyflow/react` + `@dagrejs/dagre`, with a
two-round visual-edit protocol that lets the user drive Claude Code by
drawing arrows, clicking block actions, or double-clicking the canvas
to add new modules.

See [docs/diagram.md](../../../docs/diagram.md) for the protocol
reference (events, sentinels, JSON tails, sequence diagrams). This
README maps the directory.

## Layout

```
features/diagram/
  index.ts                 public barrel — only what AppShell + ChatView need
  types.ts                 all types + DIAGRAM_VIEW_LABELS + serializeTarget
  protocol/                chat ↔ diagram contract (sentinels, parsers, bus)
  layout/                  dagre layout pass + constants
  api/                     /api/diagram streaming fetchers + helpers
  hooks/                   the hooks extracted from DiagramCanvasInner
  components/              React Flow canvas + overlays + panel + nodes
  util/                    debug logger gated on import.meta.env.DEV
```

## Dependency rule

`src/core/*` MUST NOT import from `src/features/*`. This module imports
from `@/core/*` (ProjectContext, useClaudeSession types) but never the
other way around. The chat ↔ diagram seam is the typed bus in
`protocol/bus.tsx` — sibling components communicate through it, not
via direct imports or `window.dispatchEvent`.

## Debugging

Diagram-internal state machines (the recent-changes glow, the chat
settle effect, the focus delta polling) emit dev-only logs via the
`dlog` helper in `util/debug.ts`. Enable them with:

```bash
VITE_DIAGRAM_DEBUG=recent-debug,diagram/structure,diagram/focus bun run dev
```

Logs are stripped from production builds by Vite's tree-shaking.

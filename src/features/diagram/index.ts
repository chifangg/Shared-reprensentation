/**
 * Public barrel for the diagram feature.
 *
 * AppShell and ChatView consume this module. Internal files import
 * from deep paths (`./types`, `./protocol/sentinels`, etc.); keep the
 * barrel narrow so the chat side can't reach into rendering internals.
 *
 * The set of exports below grows as the refactor progresses; this is
 * the surface that lands in src/core/components/* during the migration
 * commits.
 */

export type {
  DiagramView,
  DiagramSchema,
  DiagramBlock,
  DiagramArrow,
  FetchState,
  EditTarget,
  ConnectionOption,
  VisualEditDetail,
  OptionsReadyDetail,
  OptionExecutedDetail,
  ArrowsAddedDetail,
  BlockNodeData,
  MiniNodeData,
} from "./types";

export { DIAGRAM_VIEW_LABELS, serializeTarget } from "./types";

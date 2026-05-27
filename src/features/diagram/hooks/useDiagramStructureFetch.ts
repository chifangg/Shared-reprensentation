import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Edge, Node } from "@xyflow/react";
import type { FileEntry } from "@/core/project";
import type {
  BlockNodeData,
  DiagramArrow,
  DiagramBlock,
  FetchState,
} from "../types";
import { layoutSchema } from "../layout/layoutSchema";
import { buildProjectContext } from "../api/buildProjectContext";
import { fetchStructureStream } from "../api/fetchStructure";

/**
 * Owns the initial diagram structure fetch lifecycle.
 *
 * Two effects:
 *  1. Reset effect: on `projectKey` change (user upload / reset),
 *     wipes local state back to idle so the next render kicks off a
 *     fresh fetch. Crucially keyed on `projectKey`, not `files`, so
 *     Claude calling `write_project_file` mid-turn does NOT trigger
 *     a diagram regen — only USER-initiated project changes do.
 *  2. Fetch effect: when state is idle AND files exist, POST to
 *     `/api/diagram?view=structure` and stream NDJSON events into a
 *     growing schema, calling `reLayout` after each event so the
 *     canvas renders blocks/arrows as they arrive.
 *
 * Exposes `retryNonce` + `setRetryNonce` so the settle-effect's
 * auto-regen path can re-trigger the fetch by bumping the nonce.
 */
export function useDiagramStructureFetch({
  projectKey,
  files,
  selectedId,
  setNodes,
  setEdges,
}: {
  projectKey: number;
  files: FileEntry[];
  selectedId: string | null;
  setNodes: Dispatch<SetStateAction<Node<BlockNodeData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}): {
  state: FetchState;
  setState: Dispatch<SetStateAction<FetchState>>;
  retryNonce: number;
  setRetryNonce: Dispatch<SetStateAction<number>>;
} {
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);

  // Reset on USER-initiated project change.
  useEffect(() => {
    setState({ kind: "idle" });
    setNodes([]);
    setEdges([]);
  }, [projectKey, setNodes, setEdges]);

  // Initial streaming fetch — kicks in whenever state goes idle and
  // there are files to analyze. retryNonce bumps re-trigger the fetch
  // without changing the project; useful for explicit Retry + auto-regen.
  useEffect(() => {
    if (files.length === 0) return;
    if (state.kind !== "idle") return;

    setState({ kind: "loading", startedAt: Date.now() });
    setNodes([]);
    setEdges([]);
    const controller = new AbortController();
    const projectContext = buildProjectContext(files, null);

    const blocks: DiagramBlock[] = [];
    const arrows: DiagramArrow[] = [];

    const reLayout = () => {
      const laid = layoutSchema({ blocks, arrows }, selectedId);
      setNodes(laid.nodes);
      setEdges(laid.edges);
    };

    (async () => {
      let errorMessage: string | null = null;
      try {
        await fetchStructureStream({
          projectContext,
          signal: controller.signal,
          onEvent: (evt) => {
            if (evt.kind === "block") {
              const block = evt.data;
              const dupIdx = blocks.findIndex((b) => b.id === block.id);
              if (dupIdx >= 0) blocks[dupIdx] = block;
              else blocks.push(block);
              reLayout();
            } else if (evt.kind === "arrow") {
              const arrow = evt.data;
              const dupIdx = arrows.findIndex(
                (a) => a.from === arrow.from && a.to === arrow.to,
              );
              if (dupIdx >= 0) arrows[dupIdx] = arrow;
              else arrows.push(arrow);
              reLayout();
            } else if (evt.kind === "error") {
              errorMessage = evt.message;
            }
          },
        });

        if (controller.signal.aborted) return;
        if (errorMessage) {
          setState({ kind: "error", message: errorMessage });
        } else {
          setState({
            kind: "ready",
            schema: { blocks, arrows },
          });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: String(e) });
      }
    })();

    return () => controller.abort();
    // selectedId intentionally omitted — it's only consulted inside
    // reLayout's closure for the streaming pass; changing it mid-stream
    // shouldn't restart the fetch (we'd lose the partial schema).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, retryNonce, setNodes, setEdges, state.kind]);

  return { state, setState, retryNonce, setRetryNonce };
}

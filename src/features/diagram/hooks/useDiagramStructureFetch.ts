import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MutableRefObject,
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
  userGoal,
  selectedId,
  setNodes,
  setEdges,
  preserveRegenRef,
}: {
  projectKey: number;
  files: FileEntry[];
  /** Composed survey answer fed to the backend as `<user_goal>`. Null
   *  before the user finishes the onboarding survey — the effect bails
   *  in that case, leaving state at idle so the canvas keeps the modal
   *  visible while waiting. */
  userGoal: string | null;
  selectedId: string | null;
  setNodes: Dispatch<SetStateAction<Node<BlockNodeData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  /** When `.active`, this fetch is an EDIT-driven regen: keep the old
   *  diagram on screen, buffer the stream silently, and swap to the new
   *  layout only once it is fully ready (so the canvas never blanks and
   *  the user's spatial memory survives the rebuild). The settle-effect
   *  flips it on; this hook flips it off once the swap lands. */
  preserveRegenRef?: MutableRefObject<{ active: boolean }>;
}): {
  state: FetchState;
  setState: Dispatch<SetStateAction<FetchState>>;
  retryNonce: number;
  setRetryNonce: Dispatch<SetStateAction<number>>;
} {
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);

  // Stable string of the current file paths. We key the fetch effect
  // on this (not on `files` itself) so that Claude calling
  // `write_project_file` mid-turn — which produces a new `files`
  // reference with the same path set — does NOT cancel the in-flight
  // fetch via the cleanup-then-rerun cycle.
  const filesKey = useMemo(
    () =>
      files
        .map((f) => f.path)
        .sort()
        .join("|"),
    [files],
  );

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
    // Wait for the onboarding survey to deliver a goal before firing.
    if (userGoal === null) return;

    // EDIT-driven regen: keep the existing diagram on screen, buffer the
    // stream silently, and swap to the new layout only on `ready`. A
    // normal generate blanks + streams blocks in as they arrive.
    const preserve = preserveRegenRef?.current?.active ?? false;

    setState({ kind: "loading", startedAt: Date.now() });
    if (!preserve) {
      setNodes([]);
      setEdges([]);
    }
    const controller = new AbortController();
    const projectContext = buildProjectContext(files, userGoal);

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
              // While preserving, don't morph the old diagram block by
              // block; just accumulate and swap once at the end.
              if (!preserve) reLayout();
            } else if (evt.kind === "arrow") {
              const arrow = evt.data;
              const dupIdx = arrows.findIndex(
                (a) => a.from === arrow.from && a.to === arrow.to,
              );
              if (dupIdx >= 0) arrows[dupIdx] = arrow;
              else arrows.push(arrow);
              if (!preserve) reLayout();
            } else if (evt.kind === "error") {
              errorMessage = evt.message;
            }
          },
        });

        if (controller.signal.aborted) return;
        if (errorMessage) {
          setState({ kind: "error", message: errorMessage });
        } else {
          // Lay out the final schema once and swap. For the preserve path
          // this is the single moment the old diagram is replaced.
          reLayout();
          setState({
            kind: "ready",
            schema: { blocks, arrows },
          });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: String(e) });
      } finally {
        if (preserveRegenRef) preserveRegenRef.current.active = false;
      }
    })();

    return () => controller.abort();
    // `state.kind` and `selectedId` are intentionally omitted:
    //  - state.kind: read inside the guard `state.kind !== "idle"`;
    //    including it as a dep causes the cleanup-then-rerun cycle to
    //    abort the fetch the moment setState({kind:"loading"}) commits.
    //  - selectedId: only consulted inside reLayout's closure for the
    //    streaming pass; changing it mid-stream shouldn't restart.
    //  - files: replaced by filesKey above so mid-turn file writes
    //    (same paths, new array ref) don't cancel an in-flight fetch.
    //  - userGoal IS in deps: when survey completes, goal goes from
    //    null → string and the effect re-fires (guard above no longer
    //    bails). A subsequent regenerate flips it back to null, resets
    //    state to idle, and the next non-null goal triggers a fresh run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, userGoal, retryNonce, setNodes, setEdges]);

  return { state, setState, retryNonce, setRetryNonce };
}

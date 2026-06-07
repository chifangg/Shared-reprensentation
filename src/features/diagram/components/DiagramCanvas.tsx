/**
 * The diagram canvas — public entry point of the feature.
 *
 * `DiagramCanvas` is a thin wrapper that mounts the ReactFlowProvider
 * so the inner orchestrator can call `useReactFlow()` (via the
 * useCanvasFit / useViewportFocusFit hooks). All the actual state +
 * effects + interactions live inside `DiagramCanvasInner` below.
 *
 * The inner component is now mostly wiring + the JSX layout shell.
 * Hooks own the heavy machinery: fetch lifecycles, settle effect,
 * recent-changes diff, canvas fit, the visual-edit / connection flow
 * (useVisualEditHandlers), and the node/edge decoration + layout
 * effects (useCanvasDecoration).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  ConnectionMode,
  Controls,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useProject } from "@/core/project";
import {
  type BlockNodeData,
  type DiagramArrow,
  type DiagramBlock,
  type DiagramView,
} from "../types";
import { useEdgeRouting } from "../hooks/useEdgeRouting";
import { useDiagramStructureFetch } from "../hooks/useDiagramStructureFetch";
import { useCapabilityScan } from "../hooks/useCapabilityScan";
import { useAdaptiveFocus } from "../hooks/useAdaptiveFocus";
import {
  useRecentChanges,
  type PreRegenSnapshot,
} from "../hooks/useRecentChanges";
import { useEditSummary } from "../hooks/useEditSummary";
import { useChatSettleEffect } from "../hooks/useChatSettleEffect";
import { useCanvasFit } from "../hooks/useCanvasFit";
import { useViewportFocusFit } from "../hooks/useViewportFocusFit";
import { useBubbleFocus } from "../hooks/useBubbleFocus";
import { useEditingBlocks } from "../hooks/useEditingBlocks";
import { useVisualEditHandlers } from "../hooks/useVisualEditHandlers";
import { useCanvasDecoration } from "../hooks/useCanvasDecoration";
import { useDiagramBus } from "../protocol/bus";
import { nodeTypes } from "./nodes/BlockNode";
import { edgeTypes } from "./nodes/LabeledEdge";
import { ConnectionOptionsOverlay } from "./overlays/ConnectionOptionsOverlay";
import { IntentGate } from "./overlays/IntentGate";
import { DiagramFetchOverlay } from "./overlays/DiagramFetchOverlay";
import { EditSummaryToast } from "./overlays/EditSummaryToast";
import { RegeneratingChip } from "./overlays/RegeneratingChip";
import { AdaptiveFocusBanner } from "./overlays/AdaptiveFocusBanner";
import { AddNewBlockButton } from "./overlays/AddNewBlockButton";
import { CategoryLegend } from "./overlays/CategoryLegend";
import { BubbleEditOverlays } from "./overlays/BubbleEditOverlays";
import { ConnectionLensOverlay } from "./overlays/ConnectionLensOverlay";
import { useConnectionLens } from "../hooks/useConnectionLens";
import { useBubbleEditOverlays } from "../hooks/useBubbleEditOverlays";
import { useOnboardingIntent } from "../hooks/useOnboardingIntent";
import { IntentSurvey } from "./overlays/IntentSurvey";
import { SurveyPreparingOverlay } from "./overlays/SurveyPreparingOverlay";
import { IntentChip } from "./overlays/IntentChip";
import { DiagramFocusPanel } from "./panel/DiagramFocusPanel";

/** Stable empty-blocks reference so useEditingBlocks' effect dep doesn't
 *  change identity every render while no schema is ready. */
const EMPTY_BLOCKS: DiagramBlock[] = [];

export function DiagramCanvas({
  view,
  headerSlot,
}: {
  view: DiagramView;
  /** DOM node in the panel header where the intent chip portals itself,
   *  so it lives in the chrome instead of floating over the canvas. */
  headerSlot?: HTMLElement | null;
}) {
  return (
    <ReactFlowProvider>
      <DiagramCanvasInner view={view} headerSlot={headerSlot} />
    </ReactFlowProvider>
  );
}

function DiagramCanvasInner({
  view,
  headerSlot,
}: {
  view: DiagramView;
  headerSlot?: HTMLElement | null;
}) {
  const { files, chatMessages, chatRunning, projectKey } = useProject();
  const bus = useDiagramBus();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<{
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  }>({ blocks: [], arrows: [] });
  const [panelWidth, setPanelWidth] = useState(380);
  // Bubble drill-in editors (per-function detail card + per-surface
  // appearance card). State, click-routing, and reset live in the hook;
  // this component only owns the code-write dispatch on confirm.
  const bubbleEdit = useBubbleEditOverlays(projectKey);
  // Snapshot of the schema captured just before each auto-regen so
  // useRecentChanges can diff and glow whatever Claude added.
  const preRegenSnapshotRef = useRef<PreRegenSnapshot | null>(null);
  // While an edit-driven regen runs, keep the old diagram up + pulse the
  // edited block(s) instead of blanking. The ref gates the fetch hook;
  // editRegenIds drives the pulse and clears on the next ready.
  const preserveRegenRef = useRef<{ active: boolean }>({ active: false });
  const [editRegenIds, setEditRegenIds] = useState<Set<string>>(new Set());
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BlockNodeData>>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Connection-lens overlay (arrow-label pill drill-in). Owns its state,
  // the bus subscribe, reset, and the zoom-to-edge; the card floats next
  // to the clicked pill.
  const connection = useConnectionLens(projectKey, nodes);

  // Positions the user has dragged blocks to, keyed by block id. Re-laid
  // out nodes (e.g. when selection toggles or a bubble cluster opens)
  // are overridden with these so a manual move survives the relayout
  // instead of snapping back to dagre's slot. Cleared on project change.
  const userPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          userPositionsRef.current.set(c.id, c.position);
        }
      }
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  // Onboarding survey: gates the structure fetch. Null until the user
  // submits the survey; reset to null on projectKey change AND on the
  // explicit "Regenerate" button (which re-opens the modal).
  const [userGoal, setUserGoal] = useState<string | null>(null);
  // Gates the survey behind the intro overlay: the survey only opens
  // once the intro timeline finished AND the scan resolved. Reset
  // alongside userGoal (projectKey change).
  const [surveyIntroDone, setSurveyIntroDone] = useState(false);
  const handleSurveyIntroReady = useCallback(
    () => setSurveyIntroDone(true),
    [],
  );

  // Capability scan fires in parallel with the survey opening — by the
  // time the user picks Edit/Reference the picklist is usually ready.
  const scanState = useCapabilityScan({ projectKey, files });

  // Structure fetch lifecycle: reset on projectKey, stream
  // /api/diagram?view=structure into FetchState + nodes + edges. Gated
  // on userGoal — fires only after the survey completes.
  const { state, setState, setRetryNonce } = useDiagramStructureFetch({
    projectKey,
    files,
    userGoal,
    selectedId,
    setNodes,
    setEdges,
    preserveRegenRef,
  });

  // Hand the edit pulse off to the post-regen glow: once the rebuild is
  // ready, clear the through-regen pulse (recentChanges takes over).
  useEffect(() => {
    if (state.kind === "ready") {
      setEditRegenIds((prev) => (prev.size === 0 ? prev : new Set()));
    }
  }, [state.kind]);

  // Adaptive focus lifecycle: debounced /api/diagram?view=focus on
  // each new user turn. Resets on projectKey.
  const { focused, setFocused, regenerating } = useAdaptiveFocus({
    view,
    state,
    files,
    chatMessages,
    projectKey,
  });

  // recentChanges (the glow) + editSummary (the toast) lifecycles.
  const { recentChanges, setRecentChanges } = useRecentChanges({
    state,
    preRegenSnapshotRef,
  });
  const { editSummary, setEditSummary } = useEditSummary();

  // Live blue pulse on the block(s) whose files Claude is editing RIGHT
  // NOW (turn in flight). Clears on settle, where recentChanges takes
  // over with the persistent post-edit glow.
  const editingBlockIds = useEditingBlocks({
    chatRunning,
    chatMessages,
    blocks: state.kind === "ready" ? state.schema.blocks : EMPTY_BLOCKS,
  });

  // Click-a-block-to-expand-bubbles state. Bubbles are derived from the
  // block's provenance.functions and rendered as fan-laid ReactFlow
  // nodes; viewport pans/zooms to the cluster and restores on collapse.
  const {
    expandedBlockId,
    bubbleNodes,
    borrowOffsets,
    toggleBlock: toggleBubbleBlock,
    clear: clearBubbles,
  } = useBubbleFocus({
    projectKey,
    blocks: state.kind === "ready" ? state.schema.blocks : [],
    nodes,
  });

  // Merge bubble nodes with the layout-computed nodes for the ReactFlow
  // render. Kept derived (not state) so layoutSchema re-runs don't have
  // to know about bubbles, and bubbles vanish the instant useBubbleFocus
  // returns an empty array.
  //
  // Cast: BubbleNodeData ≠ BlockNodeData structurally, but bubble nodes
  // route through `type: "bubble"` → FunctionBubble (not BlockNode), and
  // are non-selectable / non-draggable, so onNodesChange never touches
  // their data fields. Safe at runtime; types just need the alignment.
  const renderedNodes = useMemo<Node<BlockNodeData>[]>(() => {
    // While a fan is open every OTHER block fades back so the cluster is
    // the sole focus (the user's "let everything step aside" ask); the
    // in-the-way ones additionally glide via borrowOffsets. On collapse
    // expandedBlockId clears, so both the fade and the move reverse.
    const base = nodes.map((n) => {
      const moved = borrowOffsets.get(n.id);
      const dim = expandedBlockId !== null && n.id !== expandedBlockId;
      if (!moved && !dim) return n;
      return {
        ...n,
        position: moved ?? n.position,
        style: dim
          ? { ...n.style, opacity: 0.16, transition: "opacity 200ms ease" }
          : n.style,
      };
    });
    return bubbleNodes.length === 0
      ? base
      : [...base, ...(bubbleNodes as unknown as Node<BlockNodeData>[])];
  }, [nodes, bubbleNodes, borrowOffsets, expandedBlockId]);

  // Global obstacle-avoiding routing with lane separation (see hook).
  const edgesWithRoutes = useEdgeRouting(nodes, edges);

  // Fade + de-activate every edge and its label while a fan is open, so
  // no line or label pill floats over the bubbles. `data.dimmed` lets
  // LabeledEdge drop the pill's opacity and pointer events; the path
  // dims via the style opacity. Restores the moment the fan collapses.
  const renderedEdges = useMemo<Edge[]>(() => {
    if (expandedBlockId === null) return edgesWithRoutes;
    return edgesWithRoutes.map((e) => ({
      ...e,
      style: { ...e.style, opacity: 0.1, transition: "opacity 200ms ease" },
      data: { ...e.data, dimmed: true },
    }));
  }, [edgesWithRoutes, expandedBlockId]);


  // Reset the small in-component state on USER-initiated project
  // change. (FetchState, nodes/edges, focused, regenerating are
  // already reset by the hooks above.)
  useEffect(() => {
    setSelectedId(null);
    setPromoted({ blocks: [], arrows: [] });
    setUserGoal(null);
    setSurveyIntroDone(false);
    userPositionsRef.current.clear();
  }, [projectKey]);

  /** Wipe the canvas so a regenerate starts from a blank slate. The
   *  structure fetch re-fires once userGoal is (re)set and state is idle. */
  const onRegenerate = useCallback(() => {
    setState({ kind: "idle" });
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setPromoted({ blocks: [], arrows: [] });
  }, [setState, setNodes, setEdges]);

  const intentCtl = useOnboardingIntent({
    projectKey,
    userGoal,
    setUserGoal,
    onRegenerate,
  });

  // We deliberately do NOT clear `focused` when switching away from
  // focus view — the layout/panel both already gate on `view === "focus"`,
  // so the side panel and spotlight just disappear visually while the
  // state survives. Toggling back into focus restores what the user
  // was looking at instead of forcing them to re-ask the question.

  /** Clears the "just edited" visual state — recent-change highlight
   *  on blocks/arrows AND the edit-summary toast. Called from every
   *  user-action handler so the highlight survives until they
   *  actually look away. */
  const dismissRecentEdit = useCallback(() => {
    setRecentChanges(null);
    setEditSummary(null);
  }, []);

  // Visual-edit / connection flow: pending-arrow + placeholder-block
  // visuals, the intent gate, the suggestion cards, and the round-2
  // execute dispatch. Owns the three bus subscribers and the
  // chosenOptionsRef that useChatSettleEffect consumes below.
  const visualEdit = useVisualEditHandlers({
    state,
    setState,
    files,
    bus,
    dismissRecentEdit,
    setSelectedId,
  });

  const onNodeClick = useCallback(
    (evt: React.MouseEvent, node: Node) => {
      dismissRecentEdit();
      // Clicking a function bubble opens the drill-in edit card. The
      // bubble carries its raw + humanized label and its parent block id
      // (BubbleNodeData); we anchor the card at the click point.
      if (node.type === "bubble") {
        bubbleEdit.openFromBubble(node, evt);
        return;
      }
      setSelectedId((prev) => (prev === node.id ? null : node.id));
      toggleBubbleBlock(node.id);
    },
    [dismissRecentEdit, toggleBubbleBlock, bubbleEdit],
  );

  // Detect double-click on the empty canvas (no built-in handler in
  // React Flow for this on the pane). Two onPaneClick events within
  // 300ms => add-new-block. A single click still deselects as before.
  const lastPaneClickRef = useRef(0);
  const onPaneClick = useCallback(() => {
    const now = Date.now();
    if (now - lastPaneClickRef.current < 300) {
      lastPaneClickRef.current = 0;
      visualEdit.handleAddNewBlock();
      return;
    }
    lastPaneClickRef.current = now;
    dismissRecentEdit();
    setSelectedId(null);
    clearBubbles();
  }, [visualEdit, dismissRecentEdit, clearBubbles]);

  // Diff-on-ready glow handled by useRecentChanges above.
  // Settle effect (arrow outcomes, regen, edit-summary) handled below.
  useChatSettleEffect({
    chatRunning,
    chatMessages,
    state,
    setState,
    chosenOptionsRef: visualEdit.chosenOptionsRef,
    preRegenSnapshotRef,
    preserveRegenRef,
    setRetryNonce,
    setRecentChanges,
    setEditSummary,
    setEditRegenIds,
  });

  // Adaptive focus lifecycle handled by useAdaptiveFocus above.

  // Node + edge decoration post-pass (recent-change glow, editing
  // pulse, per-node callbacks, user-drag overrides) + the two layout
  // effects that feed it into React Flow (selection-toggle relayout +
  // base-canvas re-render). Drives setNodes / setEdges directly.
  useCanvasDecoration({
    state,
    selectedId,
    focused,
    view,
    promoted,
    setNodes,
    setEdges,
    recentChanges,
    editingBlockIds,
    editRegenIds,
    handleRenameBlock: visualEdit.handleRenameBlock,
    handleBlockAction: visualEdit.handleBlockAction,
    userPositionsRef,
  });

  // Camera pan to focused base block(s) when a focus delta arrives.
  useViewportFocusFit({ view, focused });

  // Auto-fit during streaming + final fit + ResizeObserver-driven refit.
  const canvasContainerRef = useCanvasFit({ state, view, focused, nodes });

  const panelOpen =
    view === "focus" &&
    !!focused &&
    (focused.ids.length > 0 ||
      focused.blocks.length > 0 ||
      focused.arrows.length > 0);

  return (
    <div className="relative flex h-full w-full bg-[#FAFAFA]">
      <div
        ref={canvasContainerRef}
        className={`relative h-full ${panelOpen ? "flex-1 min-w-0" : "w-full"} transition-opacity duration-300 ${
          regenerating || editRegenIds.size > 0 ? "opacity-60" : "opacity-100"
        }`}
      >
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={visualEdit.handleAddConnection}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.6 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2}
          nodesDraggable
          nodesConnectable={state.kind === "ready"}
          connectionMode={ConnectionMode.Loose}
          nodesFocusable={false}
          elementsSelectable={false}
        >
          <Background color="#E0E0E0" gap={16} />
          <Controls
            showInteractive={false}
            className="!border-[#D4D4D4] !bg-white"
          />
        </ReactFlow>
        <DiagramFetchOverlay
          state={state}
          hasFiles={files.length > 0}
          nodeCount={nodes.length}
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
        {regenerating && <RegeneratingChip />}
        {view === "focus" &&
          nodes.length > 0 &&
          chatMessages.length === 0 &&
          !regenerating && <AdaptiveFocusBanner />}
        {visualEdit.pendingOptions && state.kind === "ready" && (
          <ConnectionOptionsOverlay
            target={visualEdit.pendingOptions.target}
            options={visualEdit.pendingOptions.options}
            blocks={state.schema.blocks}
            onPick={visualEdit.handlePickOption}
            onCancel={visualEdit.handleCancelOptions}
          />
        )}
        {visualEdit.intentGate && state.kind === "ready" && (
          <IntentGate
            target={visualEdit.intentGate.target}
            blocks={state.schema.blocks}
            onAskSuggestions={visualEdit.handleIntentGateAskSuggestions}
            onDescribe={visualEdit.handleIntentGateDescribe}
            onCancel={visualEdit.handleIntentGateCancel}
          />
        )}
        {state.kind === "ready" &&
          !visualEdit.pendingOptions &&
          !visualEdit.intentGate && (
            <AddNewBlockButton onClick={visualEdit.handleAddNewBlock} />
          )}
        {state.kind === "ready" &&
          intentCtl.intent !== null &&
          !intentCtl.editingIntent &&
          headerSlot &&
          createPortal(
            <IntentChip
              intent={intentCtl.intent}
              onEdit={intentCtl.openEditor}
            />,
            headerSlot,
          )}
        {userGoal === null &&
          files.length > 0 &&
          (surveyIntroDone &&
          (scanState.kind === "ready" || scanState.kind === "error") ? (
            <IntentSurvey scanState={scanState} onComplete={intentCtl.complete} />
          ) : (
            <SurveyPreparingOverlay
              scanState={scanState}
              onReady={handleSurveyIntroReady}
            />
          ))}
        {intentCtl.editingIntent && (
          <IntentSurvey
            scanState={scanState}
            initialSelection={intentCtl.intent ?? undefined}
            onComplete={intentCtl.revise}
            onCancel={intentCtl.closeEditor}
          />
        )}
        {editSummary && (
          <EditSummaryToast
            summary={editSummary}
            onDismiss={() => setEditSummary(null)}
          />
        )}
        {state.kind === "ready" && view === "overview" && (
          <CategoryLegend
            present={
              new Set(
                state.schema.blocks
                  .map((b) => b.category)
                  .filter((c): c is NonNullable<typeof c> => !!c),
              )
            }
          />
        )}
        {state.kind === "ready" && (
          <BubbleEditOverlays
            blocks={state.schema.blocks}
            files={files}
            detail={bubbleEdit.detail}
            onCloseDetail={bubbleEdit.closeDetail}
            onConfirmDetail={(blockId, instruction) => {
              visualEdit.dispatchExecuteDirect(
                { kind: "block", id: blockId },
                instruction,
              );
              bubbleEdit.closeDetail();
              clearBubbles();
            }}
          />
        )}
        {connection.lens && state.kind === "ready" && (
          <ConnectionLensOverlay
            key={`${connection.lens.from}-${connection.lens.to}-${connection.lens.verb}`}
            detail={connection.lens}
            blocks={state.schema.blocks}
            files={files}
            onClose={connection.close}
            offset={connection.cardOffset}
            onOffsetChange={connection.setCardOffset}
          />
        )}
      </div>
      {panelOpen && state.kind === "ready" && (
        <DiagramFocusPanel
          baseBlocks={state.schema.blocks}
          focused={focused!}
          promotedIds={new Set(promoted.blocks.map((b) => b.id))}
          width={panelWidth}
          onWidthChange={setPanelWidth}
          onClose={() => setFocused(null)}
          onPromote={(b) => {
            setPromoted((prev) => {
              if (prev.blocks.some((x) => x.id === b.id)) return prev;
              const knownIds = new Set([
                ...state.schema.blocks.map((x) => x.id),
                ...prev.blocks.map((x) => x.id),
                b.id,
              ]);
              const newArrows = focused!.arrows.filter(
                (a) =>
                  (a.from === b.id || a.to === b.id) &&
                  knownIds.has(a.from) &&
                  knownIds.has(a.to) &&
                  !prev.arrows.some(
                    (p) =>
                      p.from === a.from &&
                      p.to === a.to &&
                      p.label === a.label,
                  ),
              );
              return {
                blocks: [...prev.blocks, b],
                arrows: [...prev.arrows, ...newArrows],
              };
            });
          }}
          onUnpromote={(b) => {
            setPromoted((prev) => ({
              blocks: prev.blocks.filter((x) => x.id !== b.id),
              arrows: prev.arrows.filter(
                (a) => a.from !== b.id && a.to !== b.id,
              ),
            }));
          }}
        />
      )}
    </div>
  );
}

// DiagramFocusPanel, MiniBlockNode, MiniLabeledEdge, FocusMiniGraph,
// DiagramViewSwitcher, DiagramFetchOverlay, ElapsedClock, DiagramLoadingCard,
// ConnectionOptionsOverlay, IntentGate, and OptionCardButton all moved
// to @/features/diagram/components/. Imported above.

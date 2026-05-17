import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { buildProjectContext, useProject } from "@/core/project";

export type DiagramView = "overview" | "focus";

export const DIAGRAM_VIEW_LABELS: Record<DiagramView, string> = {
  overview: "Project overview",
  focus: "Adaptive focus",
};

export type DiagramSchema = {
  blocks: DiagramBlock[];
  arrows: DiagramArrow[];
};

export type DiagramBlock = {
  id: string;
  label: string;
  caption: string;
  parent: string | null;
  provenance: { files: string[]; functions: string[] };
};

export type DiagramArrow = {
  from: string;
  to: string;
  label: string;
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading"; startedAt: number }
  | { kind: "ready"; schema: DiagramSchema }
  | { kind: "error"; message: string };

const NODE_W = 220;
const NODE_H = 90;

type BlockNodeData = {
  label: string;
  caption: string;
  files: string[];
  functions: string[];
  isContainer: boolean;
  isFocused: boolean;
  isDimmed: boolean;
};

function BlockNode({ data, selected }: NodeProps<Node<BlockNodeData>>) {
  const fileCount = data.files.length;
  const fnCount = data.functions.length;
  const ring = data.isFocused
    ? "ring-[3px] ring-[#F59E0B] focus-pulse"
    : selected
      ? "ring-2 ring-[#3B5BD9]/40 shadow-xl"
      : "shadow-sm hover:shadow-md";
  const borderColor = data.isContainer
    ? "border-[#3B5BD9]/40 bg-[#F4F7FF]"
    : "border-[#D4D4D4]";
  const dim = data.isDimmed
    ? "opacity-30 saturate-50 transition-opacity duration-300"
    : "opacity-100 transition-opacity duration-300";
  return (
    <div
      className={`block-node-grow rounded-lg border bg-white px-3 py-2 transition-all ${borderColor} ${ring} ${dim}`}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-0 !bg-[#999999]"
      />
      <div className="text-sm font-semibold leading-tight text-[#222222]">
        {data.label}
      </div>
      {data.caption && (
        <div
          className={`mt-1 text-[11px] leading-snug text-[#666666] ${
            selected ? "" : "line-clamp-2"
          }`}
        >
          {data.caption}
        </div>
      )}
      {!selected && fileCount > 0 && (
        <div className="mt-1.5 text-[10px] uppercase tracking-wide text-[#999999]">
          {fileCount} {fileCount === 1 ? "file" : "files"}
          {fnCount > 0 && ` · ${fnCount} ${fnCount === 1 ? "fn" : "fns"}`}
        </div>
      )}
      {selected && fileCount > 0 && (
        <div className="mt-2.5">
          <div className="mb-0.5 text-[9px] uppercase tracking-wider text-[#999999]">
            Files
          </div>
          <ul className="space-y-0.5 text-[11px] text-[#444444]">
            {data.files.map((f) => (
              <li key={f} className="truncate" title={f}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {selected && fnCount > 0 && (
        <div className="mt-2">
          <div className="mb-0.5 text-[9px] uppercase tracking-wider text-[#999999]">
            Functions
          </div>
          <ul className="flex flex-wrap gap-1 text-[10px] text-[#444444]">
            {data.functions.map((fn) => (
              <li
                key={fn}
                className="rounded bg-[#F0F0F0] px-1.5 py-0.5 font-mono"
              >
                {fn}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0 !bg-[#999999]"
      />
    </div>
  );
}

const nodeTypes = { block: BlockNode };

function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-md border border-[#D4D4D4] bg-white px-2 py-0.5 text-[11px] font-medium text-[#444444] shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { labeled: LabeledEdge };

function estimateExpandedHeight(b: DiagramBlock): number {
  let h = 60;
  const captionLines = Math.max(1, Math.ceil((b.caption?.length ?? 0) / 32));
  h += captionLines * 14;
  const fileCount = b.provenance?.files?.length ?? 0;
  if (fileCount > 0) h += 24 + fileCount * 18;
  const fnCount = b.provenance?.functions?.length ?? 0;
  if (fnCount > 0) h += 24 + Math.ceil(fnCount / 3) * 22;
  return Math.max(h + 24, NODE_H);
}

function layoutSchema(
  schema: DiagramSchema,
  selectedId: string | null = null,
  focusedIds?: string[] | null,
): {
  nodes: Node<BlockNodeData>[];
  edges: Edge[];
} {
  const focusedSet = new Set(focusedIds ?? []);
  const hasFocus = focusedSet.size > 0;
  const allBlockIds = new Set(schema.blocks.map((b) => b.id));
  const containerIds = new Set<string>();
  for (const b of schema.blocks) {
    if (b.parent && allBlockIds.has(b.parent)) containerIds.add(b.parent);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 50,
    ranksep: 70,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const b of schema.blocks) {
    const h = b.id === selectedId ? estimateExpandedHeight(b) : NODE_H;
    g.setNode(b.id, { width: NODE_W, height: h });
  }
  for (const b of schema.blocks) {
    if (b.parent && allBlockIds.has(b.parent)) {
      g.setEdge(b.parent, b.id);
    }
  }
  for (const a of schema.arrows) {
    if (allBlockIds.has(a.from) && allBlockIds.has(a.to)) {
      g.setEdge(a.from, a.to);
    }
  }

  dagre.layout(g);

  const nodes: Node<BlockNodeData>[] = schema.blocks.map((b) => {
    const pos = g.node(b.id);
    const h = b.id === selectedId ? estimateExpandedHeight(b) : NODE_H;
    return {
      id: b.id,
      type: "block",
      position: { x: pos.x - NODE_W / 2, y: pos.y - h / 2 },
      selected: b.id === selectedId,
      data: {
        label: b.label,
        caption: b.caption,
        files: b.provenance?.files ?? [],
        functions: b.provenance?.functions ?? [],
        isContainer: containerIds.has(b.id),
        isFocused: focusedSet.has(b.id),
        isDimmed: hasFocus && !focusedSet.has(b.id),
      },
    };
  });

  const edges: Edge[] = [];

  // Note: parent → child structural edges used to be drawn here as
  // faint grey lines. Claude was emitting `parent` for blocks that
  // visually looked like clutter (e.g. linking unrelated services
  // through a meaningless containment), so we stopped rendering
  // them. The `parent` relationships still feed dagre above for
  // layout ranking — we just no longer paint the line on screen.

  // Cluster arrows whose approximate midpoints land near each other
  // (e.g. multiple arrows fanning into the same target node), then
  // merge their labels into a single combined label so we don't render
  // overlapping pills like "POSTs" stacked under "spawns". Secondary
  // arrows in a cluster keep their line but render with no label.
  const nodePos = new Map(nodes.map((n) => [n.id, n.position]));
  const PROX = 100;
  type ArrowInfo = {
    arrow: DiagramArrow;
    midX: number;
    midY: number;
  };
  const arrowInfos: ArrowInfo[] = [];
  for (const a of schema.arrows) {
    if (!allBlockIds.has(a.from) || !allBlockIds.has(a.to)) continue;
    const from = nodePos.get(a.from);
    const to = nodePos.get(a.to);
    if (!from || !to) continue;
    arrowInfos.push({
      arrow: a,
      midX: (from.x + to.x) / 2 + NODE_W / 2,
      midY: (from.y + to.y) / 2 + NODE_H / 2,
    });
  }
  const clusters: ArrowInfo[][] = [];
  for (const info of arrowInfos) {
    const found = clusters.find(
      (c) =>
        Math.abs(c[0].midX - info.midX) < PROX &&
        Math.abs(c[0].midY - info.midY) < PROX,
    );
    if (found) found.push(info);
    else clusters.push([info]);
  }
  const labelOverride = new Map<DiagramArrow, string>();
  for (const cluster of clusters) {
    if (cluster.length <= 1) continue;
    const merged = cluster
      .map((c) => c.arrow.label)
      .filter((l) => l && l.trim() !== "")
      .join(" / ");
    labelOverride.set(cluster[0].arrow, merged);
    for (let i = 1; i < cluster.length; i++) {
      labelOverride.set(cluster[i].arrow, "");
    }
  }

  for (const a of schema.arrows) {
    if (!allBlockIds.has(a.from) || !allBlockIds.has(a.to)) continue;
    const finalLabel = labelOverride.has(a)
      ? labelOverride.get(a)!
      : a.label;
    const dim = hasFocus && !(focusedSet.has(a.from) || focusedSet.has(a.to));
    edges.push({
      id: `sem-${a.from}-${a.to}-${a.label}`,
      source: a.from,
      target: a.to,
      type: "labeled",
      label: finalLabel || undefined,
      style: {
        stroke: "#666666",
        strokeWidth: 1.5,
        opacity: dim ? 0.2 : 1,
      },
    });
  }

  return { nodes, edges };
}

export function DiagramCanvas({ view }: { view: DiagramView }) {
  return (
    <ReactFlowProvider>
      <DiagramCanvasInner view={view} />
    </ReactFlowProvider>
  );
}

function buildChatContext(
  msgs: import("@/core/hooks/useClaudeSession").ClaudeMessage[],
  maxTurns = 3,
): string {
  type Turn = { role: "user" | "assistant"; text: string };
  const turns: Turn[] = [];
  for (const m of msgs) {
    const t = (m as { type?: string }).type;
    const inner = (m as { message?: { content?: unknown } }).message?.content;
    if (t === "user") {
      if (typeof inner === "string") {
        turns.push({ role: "user", text: inner });
      }
    } else if (t === "assistant" && Array.isArray(inner)) {
      const text = (inner as { type?: string; text?: string }[])
        .filter((b) => b?.type === "text" && typeof b?.text === "string")
        .map((b) => b.text)
        .join(" ");
      if (text.trim()) turns.push({ role: "assistant", text });
    }
  }
  const recent = turns.slice(-maxTurns * 2);
  return recent
    .map((t) => `${t.role.toUpperCase()}: ${t.text}`)
    .join("\n\n");
}

function DiagramCanvasInner({ view }: { view: DiagramView }) {
  const { files, chatMessages } = useProject();
  const { fitView } = useReactFlow();

  const filesKey = files
    .map((f) => f.path)
    .sort()
    .join("|");

  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [focused, setFocused] = useState<{
    ids: string[];
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  } | null>(null);
  const [promoted, setPromoted] = useState<{
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  }>({ blocks: [], arrows: [] });
  const [panelWidth, setPanelWidth] = useState(380);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BlockNodeData>>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setState({ kind: "idle" });
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setRegenerating(false);
    setFocused(null);
    setPromoted({ blocks: [], arrows: [] });
  }, [filesKey, setNodes, setEdges]);

  // We deliberately do NOT clear `focused` when switching away from
  // focus view — the layout/panel both already gate on `view === "focus"`,
  // so the side panel and spotlight just disappear visually while the
  // state survives. Toggling back into focus restores what the user
  // was looking at instead of forcing them to re-ask the question.

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedId((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    setSelectedId(null);
  }, []);

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
      try {
        const resp = await fetch("/api/diagram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_context: projectContext,
            view: "structure",
          }),
          signal: controller.signal,
        });
        if (!resp.body) throw new Error("no response body");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let errorMessage: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let evt: { kind?: string; data?: unknown; message?: string };
            try {
              evt = JSON.parse(line);
            } catch {
              continue;
            }
            console.log("[diagram/structure]", evt);
            if (evt.kind === "block" && evt.data) {
              const block = evt.data as DiagramBlock;
              const dupIdx = blocks.findIndex((b) => b.id === block.id);
              if (dupIdx >= 0) blocks[dupIdx] = block;
              else blocks.push(block);
              reLayout();
            } else if (evt.kind === "arrow" && evt.data) {
              const arrow = evt.data as DiagramArrow;
              const dupIdx = arrows.findIndex(
                (a) => a.from === arrow.from && a.to === arrow.to,
              );
              if (dupIdx >= 0) arrows[dupIdx] = arrow;
              else arrows.push(arrow);
              reLayout();
            } else if (evt.kind === "error") {
              errorMessage = evt.message || "stream error";
            }
          }
        }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, retryNonce, setNodes, setEdges]);

  // Re-layout when selection toggles, so dagre makes room for the
  // expanded block and surrounding nodes glide via CSS transition.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const laid = layoutSchema(state.schema, selectedId);
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [selectedId, state, setNodes, setEdges]);

  // Adaptive focus: fire one focus-delta request per user turn. We
  // count user messages (not total chatMessages.length) so the assistant
  // streaming many intermediate items — thinking, tool calls, tool
  // results, text chunks — doesn't keep retriggering the regen and
  // making the panel flicker. We hold a ref to the latest chat history
  // so the deferred fetch picks up whatever the assistant has produced
  // by then, even though the effect doesn't re-run on every chunk.
  const chatMessagesRef = useRef(chatMessages);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const userMessageCount = chatMessages.reduce(
    (n, m) => n + ((m as { type?: string }).type === "user" ? 1 : 0),
    0,
  );
  const lastUserCountRef = useRef(0);
  useEffect(() => {
    if (view !== "focus") return;
    if (state.kind !== "ready") return;
    if (files.length === 0) return;
    if (userMessageCount === lastUserCountRef.current) return;
    lastUserCountRef.current = userMessageCount;
    if (userMessageCount === 0) return;

    const controller = new AbortController();
    const debounceTimer = window.setTimeout(() => {
      const projectContext = buildProjectContext(files, null);
      const chatContext = buildChatContext(chatMessagesRef.current, 3);
      const baseSchemaJson = JSON.stringify({
        blocks: state.schema.blocks.map((b) => ({
          id: b.id,
          label: b.label,
          caption: b.caption,
        })),
      });
      setRegenerating(true);

      const newDetailBlocks: DiagramBlock[] = [];
      const newDetailArrows: DiagramArrow[] = [];
      const newFocusedIds: string[] = [];

      (async () => {
        try {
          const resp = await fetch("/api/diagram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project_context: projectContext,
              view: "focus",
              chat_context: chatContext,
              base_schema: baseSchemaJson,
            }),
            signal: controller.signal,
          });
          if (!resp.body) throw new Error("no response body");
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              let evt: {
                kind?: string;
                data?: unknown;
                ids?: string[];
              };
              try {
                evt = JSON.parse(line);
              } catch {
                continue;
              }
              console.log("[diagram/focus]", evt);
              if (evt.kind === "focus" && Array.isArray(evt.ids)) {
                // Accumulate ids but DON'T replace `focused` yet — if
                // the previous turn had detail blocks visible, blowing
                // them away the moment a new focus arrives makes the
                // panel flash empty. Wait for the first detail_block
                // (or stream end) to commit the swap.
                newFocusedIds.push(...evt.ids);
              } else if (evt.kind === "detail_block" && evt.data) {
                newDetailBlocks.push(evt.data as DiagramBlock);
                setFocused({
                  ids: [...newFocusedIds],
                  blocks: [...newDetailBlocks],
                  arrows: [...newDetailArrows],
                });
                setRegenerating(false);
              } else if (evt.kind === "detail_arrow" && evt.data) {
                newDetailArrows.push(evt.data as DiagramArrow);
                setFocused({
                  ids: [...newFocusedIds],
                  blocks: [...newDetailBlocks],
                  arrows: [...newDetailArrows],
                });
              }
            }
          }
          if (controller.signal.aborted) return;
          // Edge: focus event arrived but no detail_block ever did.
          // Commit at least the new ids so the panel reflects the new
          // turn rather than appearing stuck on the previous topic.
          if (newDetailBlocks.length === 0 && newFocusedIds.length > 0) {
            setFocused({
              ids: [...newFocusedIds],
              blocks: [],
              arrows: [],
            });
          }
          setRegenerating(false);
        } catch {
          if (controller.signal.aborted) return;
          setRegenerating(false);
        }
      })();
    }, 1200);

    return () => {
      window.clearTimeout(debounceTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMessageCount, view, files.length]);

  // Re-render base canvas. Detail blocks live in the side panel by
  // default; the user can promote individual ones into the main
  // diagram and from then on they layout alongside base blocks.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const focusedIds =
      view === "focus" && focused ? focused.ids : null;
    const merged: DiagramSchema = {
      blocks: [...state.schema.blocks, ...promoted.blocks],
      arrows: [...state.schema.arrows, ...promoted.arrows],
    };
    const laid = layoutSchema(merged, selectedId, focusedIds);
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [state, selectedId, focused, view, promoted, setNodes, setEdges]);

  // Camera pan to focused base block(s) when a focus delta arrives.
  // Detail content lives in the side panel now, so we only fit the
  // base blocks the chat is talking about. Wait long enough for the
  // panel slide-in to finish so the canvas viewport has its real size.
  useEffect(() => {
    if (view !== "focus") return;
    if (!focused) return;
    if (focused.ids.length === 0) return;
    const t = window.setTimeout(() => {
      fitView({
        nodes: focused.ids.map((id) => ({ id })),
        padding: 0.3,
        duration: 700,
        maxZoom: 1.3,
        minZoom: 0.5,
      });
    }, 320);
    return () => window.clearTimeout(t);
  }, [focused, view, fitView]);

  // Auto-fit viewport whenever the node set grows during streaming, so
  // the canvas keeps pace with new blocks instead of leaving the user
  // staring at empty whitespace if Claude lays things out off-screen.
  useEffect(() => {
    if (nodes.length === 0) return;
    const t = window.setTimeout(() => {
      fitView({ padding: 0.15, duration: 400, maxZoom: 1.6 });
    }, 60);
    return () => window.clearTimeout(t);
  }, [nodes.length, fitView]);

  // Final fit after streaming completes — edges may have arrived after
  // the last node-trigger, and dagre may have shifted positions.
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (nodes.length === 0) return;
    const t = window.setTimeout(() => {
      fitView({ padding: 0.15, duration: 500, maxZoom: 1.6 });
    }, 120);
    return () => window.clearTimeout(t);
  }, [state, fitView, nodes.length]);

  // Recenter the viewport whenever the canvas's available width
  // changes — the side panel sliding in/out, the user dragging the
  // resize handle, the window itself resizing. Without this, growing
  // the panel pushes the diagram off the visible area and shrinking
  // it leaves a lopsided composition.
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const fitFnRef = useRef<() => void>(() => {});
  fitFnRef.current = () => {
    if (state.kind !== "ready") return;
    if (nodes.length === 0) return;
    if (view === "focus" && focused && focused.ids.length > 0) {
      fitView({
        nodes: focused.ids.map((id) => ({ id })),
        padding: 0.3,
        duration: 220,
        maxZoom: 1.3,
        minZoom: 0.5,
      });
    } else {
      fitView({ padding: 0.15, duration: 220, maxZoom: 1.6 });
    }
  };
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    let timer: number | undefined;
    let isFirst = true;
    const ro = new ResizeObserver(() => {
      // Skip the very first observation — that's the initial mount,
      // already handled by React Flow's `fitView` prop and the streaming
      // effects above. We only want to react to subsequent size changes.
      if (isFirst) {
        isFirst = false;
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => fitFnRef.current(), 80);
    });
    ro.observe(el);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

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
          regenerating ? "opacity-60" : "opacity-100"
        }`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
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
          nodesConnectable={false}
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
        {regenerating && (
          <div className="pointer-events-none absolute right-3 top-3 z-50 flex items-center gap-2 rounded-full border border-[#3B5BD9]/30 bg-white/95 px-3 py-1.5 text-xs text-[#3B5BD9] shadow-md">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            <span>Refocusing on the conversation…</span>
          </div>
        )}
        {view === "focus" &&
          nodes.length > 0 &&
          chatMessages.length === 0 &&
          !regenerating && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-[#3B5BD9]/30 bg-[#F4F7FF] px-3 py-1 text-[11px] font-medium text-[#3B5BD9] shadow-sm">
              Adaptive focus mode · diagram will refocus when you chat
            </div>
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

const PANEL_MIN = 280;
const PANEL_MAX = 720;

function DiagramFocusPanel({
  baseBlocks,
  focused,
  promotedIds,
  width,
  onWidthChange,
  onClose,
  onPromote,
  onUnpromote,
}: {
  baseBlocks: DiagramBlock[];
  focused: {
    ids: string[];
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  };
  promotedIds: Set<string>;
  width: number;
  onWidthChange: (w: number) => void;
  onClose: () => void;
  onPromote: (b: DiagramBlock) => void;
  onUnpromote: (b: DiagramBlock) => void;
}) {
  const focusedLabels = focused.ids
    .map((id) => baseBlocks.find((b) => b.id === id)?.label)
    .filter((x): x is string => Boolean(x));
  const isStreaming =
    focused.blocks.length === 0 && focused.arrows.length === 0;

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: MouseEvent) => {
        const dx = startX - ev.clientX; // dragging left grows panel
        const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW + dx));
        onWidthChange(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width, onWidthChange],
  );

  return (
    <aside
      className="panel-slide-in relative flex h-full shrink-0 flex-col border-l border-[#E0E0E0] bg-white shadow-[-6px_0_18px_rgba(0,0,0,0.04)]"
      style={{ width }}
    >
      {/* Drag handle on the left edge — wider invisible hit-area, thin
          visible bar that lights up on hover. */}
      <div
        onMouseDown={onResizeStart}
        className="group absolute left-0 top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize"
        aria-label="Resize focus panel"
        role="separator"
      >
        <div className="mx-auto h-full w-px bg-[#E8E8E8] transition-colors group-hover:bg-[#3B5BD9]/40" />
      </div>

      <header className="flex items-start justify-between gap-2 border-b border-[#E8E8E8] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[#999999]">
            Focusing
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-[#222222]">
            {focusedLabels.length > 0 ? focusedLabels.join(", ") : "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close focus panel"
          className="rounded-md p-1 text-[#999999] transition-colors hover:bg-[#F4F4F4] hover:text-[#484848]"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {isStreaming ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-[#999999]">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            <span>Composing the detail view…</span>
          </div>
        ) : (
          <ReactFlowProvider>
            <FocusMiniGraph
              focused={focused}
              baseBlocks={baseBlocks}
              promotedIds={promotedIds}
              onPromote={onPromote}
              onUnpromote={onUnpromote}
            />
          </ReactFlowProvider>
        )}
      </div>
      <footer className="border-t border-[#E8E8E8] px-4 py-2 text-[10px] leading-snug text-[#999999]">
        Click <span className="font-medium text-[#3B5BD9]">+</span> on any
        sub-piece to add it to the main diagram.
      </footer>
    </aside>
  );
}

type MiniNodeData = {
  label: string;
  caption: string;
  files: string[];
  functions: string[];
  isGhost: boolean;
  isPromoted: boolean;
  isSelected: boolean;
  block: DiagramBlock | null;
  onPromote: ((b: DiagramBlock) => void) | null;
  onUnpromote: ((b: DiagramBlock) => void) | null;
};

function MiniBlockNode({ data }: NodeProps<Node<MiniNodeData>>) {
  if (data.isGhost) {
    return (
      <div
        className="rounded-md border border-dashed border-[#F59E0B]/60 bg-[#FFF8EC] px-2.5 py-1.5 text-[11px] font-semibold text-[#A1610B] shadow-sm"
        style={{ width: 150 }}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!h-1.5 !w-1.5 !border-0 !bg-transparent"
        />
        <div className="truncate">{data.label}</div>
        <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-[#A1610B]/70">
          on canvas
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-1.5 !w-1.5 !border-0 !bg-[#F59E0B]"
        />
      </div>
    );
  }
  const fileCount = data.files.length;
  const fnCount = data.functions.length;
  return (
    <div
      className={`block-node-grow group relative rounded-md border bg-white px-2.5 py-1.5 shadow-sm transition-all ${
        data.isSelected
          ? "ring-2 ring-[#3B5BD9]/50 shadow-lg z-10"
          : ""
      } ${
        data.isPromoted
          ? "border-[#3B5BD9]/50 bg-[#F4F7FF]"
          : "border-[#D4D4D4] hover:shadow-md"
      }`}
      style={{ width: data.isSelected ? 220 : 160 }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-[#999999]"
      />
      <div className="pr-5 text-[12px] font-semibold leading-tight text-[#222222]">
        {data.label}
      </div>
      {data.caption && (
        <div
          className={`mt-0.5 text-[10px] leading-snug text-[#666666] ${
            data.isSelected ? "" : "line-clamp-2"
          }`}
        >
          {data.caption}
        </div>
      )}
      {!data.isSelected && (fileCount > 0 || fnCount > 0) && (
        <div className="mt-1 text-[9px] uppercase tracking-wide text-[#999999]">
          {fileCount > 0 && `${fileCount} ${fileCount === 1 ? "file" : "files"}`}
          {fileCount > 0 && fnCount > 0 && " · "}
          {fnCount > 0 && `${fnCount} ${fnCount === 1 ? "fn" : "fns"}`}
        </div>
      )}
      {data.isSelected && fileCount > 0 && (
        <div className="mt-2">
          <div className="mb-0.5 text-[8px] font-medium uppercase tracking-wider text-[#999999]">
            Files
          </div>
          <ul className="space-y-0.5 text-[10px] text-[#444444]">
            {data.files.map((f) => (
              <li key={f} className="truncate font-mono" title={f}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.isSelected && fnCount > 0 && (
        <div className="mt-1.5">
          <div className="mb-0.5 text-[8px] font-medium uppercase tracking-wider text-[#999999]">
            Functions
          </div>
          <ul className="flex flex-wrap gap-1 text-[9px] text-[#444444]">
            {data.functions.map((fn) => (
              <li
                key={fn}
                className="rounded bg-[#F0F0F0] px-1.5 py-0.5 font-mono"
              >
                {fn}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.block && data.onPromote && data.onUnpromote && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (data.isPromoted) data.onUnpromote!(data.block!);
            else data.onPromote!(data.block!);
          }}
          aria-label={
            data.isPromoted
              ? "Remove from main diagram"
              : "Add to main diagram"
          }
          className={`group/btn absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border transition-all ${
            data.isPromoted
              ? "border-[#3B5BD9]/40 bg-[#3B5BD9] text-white hover:border-red-400 hover:bg-red-500"
              : "border-[#D4D4D4] bg-white text-[#666666] opacity-0 group-hover:opacity-100 hover:border-[#3B5BD9] hover:text-[#3B5BD9]"
          }`}
        >
          {data.isPromoted ? (
            <>
              <Check
                className="h-3 w-3 group-hover/btn:hidden"
                strokeWidth={3}
              />
              <X
                className="hidden h-3 w-3 group-hover/btn:block"
                strokeWidth={3}
              />
            </>
          ) : (
            <Plus className="h-3 w-3" strokeWidth={2.5} />
          )}
        </button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-[#999999]"
      />
    </div>
  );
}

// Approximate the expanded height of a selected detail block in the
// mini graph, so dagre can carve out enough vertical room and avoid
// overlapping neighbors when the user clicks to inspect.
function estimateMiniExpandedHeight(b: DiagramBlock): number {
  let h = 44;
  const captionLines = Math.max(1, Math.ceil((b.caption?.length ?? 0) / 28));
  h += captionLines * 12;
  const fileCount = b.provenance?.files?.length ?? 0;
  if (fileCount > 0) h += 18 + fileCount * 14;
  const fnCount = b.provenance?.functions?.length ?? 0;
  if (fnCount > 0) h += 18 + Math.ceil(fnCount / 3) * 18;
  return Math.max(h + 12, 56);
}

const miniNodeTypes = { mini: MiniBlockNode };

function MiniLabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-[4px] border border-[#3B5BD9]/30 bg-white px-1.5 py-px text-[10px] font-medium text-[#3B5BD9] shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const miniEdgeTypes = { miniLabeled: MiniLabeledEdge };

function FocusMiniGraph({
  focused,
  baseBlocks,
  promotedIds,
  onPromote,
  onUnpromote,
}: {
  focused: {
    ids: string[];
    blocks: DiagramBlock[];
    arrows: DiagramArrow[];
  };
  baseBlocks: DiagramBlock[];
  promotedIds: Set<string>;
  onPromote: (b: DiagramBlock) => void;
  onUnpromote: (b: DiagramBlock) => void;
}) {
  const { fitView } = useReactFlow();
  const [selectedMiniId, setSelectedMiniId] = useState<string | null>(null);
  const onMiniNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Ghost nodes (focused base re-stamped at the top) aren't
      // expandable here — they belong to the main canvas.
      if (node.id.startsWith("ghost-")) return;
      setSelectedMiniId((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );
  const onMiniPaneClick = useCallback(() => {
    setSelectedMiniId(null);
  }, []);

  // Build mini-layout: ghost focused base blocks at top, detail
  // blocks below, dagre TB. Arrow set spans both layers so the
  // viewer can see where each detail attaches.
  const { nodes, edges } = (() => {
    const ghostNodes = focused.ids
      .map((id) => baseBlocks.find((b) => b.id === id))
      .filter((b): b is DiagramBlock => Boolean(b));

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      nodesep: 26,
      ranksep: 44,
      marginx: 16,
      marginy: 16,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const b of ghostNodes) g.setNode(b.id, { width: 150, height: 44 });
    for (const b of focused.blocks) {
      const isSel = b.id === selectedMiniId;
      g.setNode(b.id, {
        width: isSel ? 220 : 160,
        height: isSel ? estimateMiniExpandedHeight(b) : 56,
      });
    }

    const allIds = new Set<string>([
      ...ghostNodes.map((b) => b.id),
      ...focused.blocks.map((b) => b.id),
    ]);
    for (const a of focused.arrows) {
      if (allIds.has(a.from) && allIds.has(a.to)) g.setEdge(a.from, a.to);
    }
    // If a detail block declares a parent that's a focused base, draw
    // an implicit containment edge so dagre lays it underneath.
    for (const b of focused.blocks) {
      if (b.parent && allIds.has(b.parent)) {
        g.setEdge(b.parent, b.id);
      }
    }
    dagre.layout(g);

    const nodes: Node<MiniNodeData>[] = [
      ...ghostNodes.map<Node<MiniNodeData>>((b) => {
        const pos = g.node(b.id);
        return {
          id: `ghost-${b.id}`,
          type: "mini",
          position: { x: pos.x - 75, y: pos.y - 22 },
          draggable: false,
          data: {
            label: b.label,
            caption: "",
            files: [],
            functions: [],
            isGhost: true,
            isPromoted: false,
            isSelected: false,
            block: null,
            onPromote: null,
            onUnpromote: null,
          },
        };
      }),
      ...focused.blocks.map<Node<MiniNodeData>>((b) => {
        const pos = g.node(b.id);
        const isSel = b.id === selectedMiniId;
        const w = isSel ? 220 : 160;
        const h = isSel ? estimateMiniExpandedHeight(b) : 56;
        return {
          id: b.id,
          type: "mini",
          position: { x: pos.x - w / 2, y: pos.y - h / 2 },
          data: {
            label: b.label,
            caption: b.caption,
            files: b.provenance?.files ?? [],
            functions: b.provenance?.functions ?? [],
            isGhost: false,
            isPromoted: promotedIds.has(b.id),
            isSelected: isSel,
            block: b,
            onPromote,
            onUnpromote,
          },
        };
      }),
    ];

    const idMap = new Map<string, string>();
    for (const b of ghostNodes) idMap.set(b.id, `ghost-${b.id}`);
    for (const b of focused.blocks) idMap.set(b.id, b.id);

    const edges: Edge[] = focused.arrows
      .filter((a) => idMap.has(a.from) && idMap.has(a.to))
      .map((a, i) => ({
        id: `mini-arrow-${a.from}-${a.to}-${i}`,
        source: idMap.get(a.from)!,
        target: idMap.get(a.to)!,
        type: "miniLabeled",
        label: a.label || undefined,
        style: { stroke: "#7B96E8", strokeWidth: 1.25, strokeDasharray: "4,3" },
      }));
    // Containment edges (parent → detail) when no explicit arrow.
    const arrowKey = new Set(
      focused.arrows.map((a) => `${a.from}->${a.to}`),
    );
    for (const b of focused.blocks) {
      if (!b.parent || !idMap.has(b.parent)) continue;
      if (arrowKey.has(`${b.parent}->${b.id}`)) continue;
      edges.push({
        id: `mini-contain-${b.parent}-${b.id}`,
        source: idMap.get(b.parent)!,
        target: b.id,
        type: "smoothstep",
        style: {
          stroke: "#CCCCCC",
          strokeWidth: 1,
          strokeDasharray: "2,3",
        },
      });
    }
    return { nodes, edges };
  })();

  // Fit on every layout change (new detail blocks streaming in,
  // panel resize, promotion removing nodes, click-to-expand).
  useEffect(() => {
    const t = window.setTimeout(() => {
      fitView({ padding: 0.18, duration: 350, maxZoom: 1.3 });
    }, 80);
    return () => window.clearTimeout(t);
  }, [nodes.length, edges.length, selectedMiniId, fitView]);

  // Refit the mini-graph whenever its container size changes, so when
  // the user drags the panel handle the focused subflow stays
  // proportionally scaled and centered instead of clipping at one edge.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let timer: number | undefined;
    let isFirst = true;
    const ro = new ResizeObserver(() => {
      if (isFirst) {
        isFirst = false;
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        fitView({ padding: 0.18, duration: 220, maxZoom: 1.3 });
      }, 80);
    });
    ro.observe(el);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [fitView]);

  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={miniNodeTypes}
        edgeTypes={miniEdgeTypes}
        onNodeClick={onMiniNodeClick}
        onPaneClick={onMiniPaneClick}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.4}
        maxZoom={1.6}
        nodesDraggable
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
      >
        <Background color="#EFEFEF" gap={14} />
      </ReactFlow>
    </div>
  );
}

export function DiagramViewSwitcher({
  view,
  onChange,
}: {
  view: DiagramView;
  onChange: (v: DiagramView) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as globalThis.Node | null;
      if (ref.current && target && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-[#484848]/15 bg-white/70 px-2.5 py-1 text-xs font-medium tracking-tight text-[#484848] shadow-sm transition-colors hover:bg-white"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{DIAGRAM_VIEW_LABELS[view]}</span>
        <ChevronDown
          className={`h-3 w-3 text-[#484848]/60 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-10 mt-1.5 w-48 overflow-hidden rounded-md border border-[#484848]/10 bg-white shadow-lg"
        >
          {(Object.keys(DIAGRAM_VIEW_LABELS) as DiagramView[]).map((v) => {
            const selected = v === view;
            return (
              <button
                key={v}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[#F4F4F4] ${
                  selected
                    ? "font-medium text-[#484848]"
                    : "text-[#484848]/80"
                }`}
              >
                <span>{DIAGRAM_VIEW_LABELS[v]}</span>
                {selected && (
                  <Check
                    className="h-3 w-3 text-[#484848]"
                    strokeWidth={2.5}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiagramFetchOverlay({
  state,
  hasFiles,
  nodeCount,
  onRetry,
}: {
  state: FetchState;
  hasFiles: boolean;
  nodeCount: number;
  onRetry: () => void;
}) {
  if (!hasFiles) return null;

  if (state.kind === "loading") {
    // Once any blocks have arrived, drop the full-canvas blur so the
    // user can actually see what's been generated. Replace it with a
    // small bottom-right chip indicating Claude is still streaming.
    if (nodeCount > 0) {
      return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border border-[#D4D4D4] bg-white/95 px-3 py-1.5 text-xs text-[#484848] shadow-md">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          <span>Generating more — {nodeCount} so far</span>
          <ElapsedClock startedAt={state.startedAt} />
        </div>
      );
    }
    return (
      <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
        <DiagramLoadingCard startedAt={state.startedAt} />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center px-4">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-red-200 bg-white px-6 py-4 shadow-md">
          <AlertCircle className="h-5 w-5 text-red-500" strokeWidth={2} />
          <span className="text-center text-sm text-[#484848]">
            {state.message}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-[#484848] px-3 py-1 text-xs font-medium text-white hover:bg-[#222]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function ElapsedClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const sec = Math.floor((now - startedAt) / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const time = mm > 0 ? `${mm}:${String(ss).padStart(2, "0")}` : `${ss}s`;
  return (
    <span className="tabular-nums text-[#484848]/70">{time}</span>
  );
}

function DiagramLoadingCard({ startedAt }: { startedAt: number }) {
  return (
    <div className="flex w-72 flex-col items-center gap-3 rounded-lg bg-white px-6 py-4 text-[#484848] shadow-lg">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        <span className="font-medium">Claude is drawing the diagram…</span>
      </div>
      <div className="flex w-full items-center justify-between text-xs text-[#484848]/70">
        <span>Reading project — first block usually in 5 seconds</span>
        <ElapsedClock startedAt={startedAt} />
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[#EAEAEA]">
        <div className="h-full w-1/3 animate-[loading-bar_1.4s_ease-in-out_infinite] rounded-full bg-[#484848]/60" />
      </div>
    </div>
  );
}

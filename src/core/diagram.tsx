import { useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { AlertCircle, Loader2 } from "lucide-react";
import { buildProjectContext, useProject } from "@/core/project";

type ElementSkeleton = NonNullable<
  Parameters<typeof convertToExcalidrawElements>[0]
>[number];

export type DiagramSchema = {
  blocks: DiagramBlock[];
  arrows: DiagramArrow[];
};

export type DiagramBlock = {
  id: string;
  label: string;
  caption: string;
  parent: string | null;
  position: { x: number; y: number };
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

export function DiagramCanvas() {
  const { files, goal } = useProject();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const filesKey = files
    .map((f) => f.path)
    .sort()
    .join("|");

  const [state, setState] = useState<FetchState>({ kind: "idle" });

  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setState({ kind: "idle" });
  }, [filesKey, goal]);

  useEffect(() => {
    if (files.length === 0) return;
    if (!goal) return;
    if (state.kind !== "idle") return;

    setState({ kind: "loading", startedAt: Date.now() });
    const controller = new AbortController();
    const projectContext = buildProjectContext(files, goal);

    fetch("/api/diagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_context: projectContext, view: "structure" }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success && res.data) {
          setState({ kind: "ready", schema: res.data as DiagramSchema });
        } else {
          setState({
            kind: "error",
            message: res.error || "No diagram returned",
          });
        }
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: String(e) });
      });

    return () => controller.abort();
  }, [filesKey, goal, retryNonce]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    if (!apiRef.current) return;
    const elements = buildDiagramFromSchema(state.schema);
    apiRef.current.updateScene({ elements });
    apiRef.current.scrollToContent(elements, { fitToContent: true });
  }, [state]);

  return (
    <div className="relative h-full w-full">
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        theme="light"
      />
      <DiagramFetchOverlay
        state={state}
        hasFiles={files.length > 0}
        hasGoal={goal !== null}
        onRetry={() => setRetryNonce((n) => n + 1)}
      />
    </div>
  );
}

function DiagramFetchOverlay({
  state,
  hasFiles,
  hasGoal,
  onRetry,
}: {
  state: FetchState;
  hasFiles: boolean;
  hasGoal: boolean;
  onRetry: () => void;
}) {
  if (!hasFiles) return null;

  if (!hasGoal) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="rounded-full border border-[#484848]/10 bg-white/85 px-3 py-1 text-[11px] text-[#484848]/60 shadow-sm backdrop-blur-sm">
          Set a goal in chat to generate the structure layout
        </div>
      </div>
    );
  }

  if (state.kind === "loading") {
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

function DiagramLoadingCard({ startedAt }: { startedAt: number }) {
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
    <div className="flex w-72 flex-col items-center gap-3 rounded-lg bg-white px-6 py-4 text-[#484848] shadow-lg">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        <span className="font-medium">Claude is drawing the diagram…</span>
      </div>
      <div className="flex w-full items-center justify-between text-xs text-[#484848]/70">
        <span>Reading project — can take 1–2 minutes</span>
        <span className="tabular-nums font-medium text-[#484848]">{time}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[#EAEAEA]">
        <div className="h-full w-1/3 animate-[loading-bar_1.4s_ease-in-out_infinite] rounded-full bg-[#484848]/60" />
      </div>
    </div>
  );
}

const NODE_W = 160;
const NODE_H = 80;

const PALETTE = {
  topLevel: { stroke: "#484848", fill: "#e8dec5" },
  nested: { stroke: "#484848", fill: "#f5efe2" },
};

function buildDiagramFromSchema(schema: DiagramSchema) {
  const skeletons: ElementSkeleton[] = [];
  const blockMap = new Map(schema.blocks.map((b) => [b.id, b]));

  for (const block of schema.blocks) {
    const palette = block.parent ? PALETTE.nested : PALETTE.topLevel;
    skeletons.push({
      type: "rectangle",
      id: block.id,
      x: block.position.x,
      y: block.position.y,
      width: NODE_W,
      height: NODE_H,
      strokeColor: palette.stroke,
      backgroundColor: palette.fill,
      fillStyle: "solid",
      roundness: { type: 3 },
      label: { text: block.label, fontSize: 16 },
    });
  }

  for (const block of schema.blocks) {
    if (!block.parent) continue;
    const parent = blockMap.get(block.parent);
    if (!parent) continue;
    skeletons.push(makeArrow(parent, block, { stroke: "#bbbbbb" }));
  }

  for (const arrow of schema.arrows) {
    const fromBlock = blockMap.get(arrow.from);
    const toBlock = blockMap.get(arrow.to);
    if (!fromBlock || !toBlock) continue;
    skeletons.push(
      makeArrow(fromBlock, toBlock, {
        stroke: "#666666",
        label: arrow.label,
      }),
    );
  }

  return convertToExcalidrawElements(skeletons);
}

function makeArrow(
  from: DiagramBlock,
  to: DiagramBlock,
  opts: { stroke: string; label?: string },
): ElementSkeleton {
  const startX = from.position.x + NODE_W / 2;
  const startY = from.position.y + NODE_H;
  const endX = to.position.x + NODE_W / 2;
  const endY = to.position.y;
  const skel: ElementSkeleton = {
    type: "arrow",
    x: startX,
    y: startY,
    points: [
      [0, 0],
      [endX - startX, endY - startY],
    ],
    strokeColor: opts.stroke,
    start: { id: from.id },
    end: { id: to.id },
  };
  if (opts.label) {
    (skel as { label?: { text: string; fontSize: number } }).label = {
      text: opts.label,
      fontSize: 12,
    };
  }
  return skel;
}

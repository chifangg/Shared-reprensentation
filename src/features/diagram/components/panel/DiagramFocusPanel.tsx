import { useCallback } from "react";
import { Loader2, X } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import type { DiagramArrow, DiagramBlock } from "../../types";
import { PANEL_MAX, PANEL_MIN } from "../../layout/constants";
import { FocusMiniGraph } from "./FocusMiniGraph";

/**
 * Right-side panel that slides in during adaptive-focus mode. Shows
 * what the diagram is currently focusing on (focused base block
 * labels) plus a mini-graph of detail blocks that drill into those
 * focused regions.
 *
 * Resizable via a drag handle on the left edge (clamped to PANEL_MIN
 * / PANEL_MAX from layout/constants). The mini-graph is rendered
 * inside its own ReactFlowProvider so its useReactFlow() doesn't
 * conflict with the main canvas's provider.
 */
export function DiagramFocusPanel({
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
        <div className="mx-auto h-full w-px bg-[#E8E8E8] transition-colors group-hover:bg-[#78716C]/40" />
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
        Click <span className="font-medium text-[#78716C]">+</span> on any
        sub-piece to add it to the main diagram.
      </footer>
    </aside>
  );
}

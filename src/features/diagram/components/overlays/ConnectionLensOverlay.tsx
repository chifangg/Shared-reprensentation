import { useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Zap, Package, Info } from "lucide-react";
import type { ConnectionLensDetail, DiagramBlock } from "../../types";
import type { FileEntry } from "@/core/project";
import {
  describeConnection,
  type ConnectionDetailResult,
} from "../../api/fetchConnectionDetail";

/**
 * Drill-in lenses for one arrow (relationship). Opened by clicking the
 * arrow's label pill. Reads both blocks' real code on demand and surfaces
 * the three things the block-level abstraction throws away about an edge:
 *
 *   - How    (realization): how the relationship is wired, one sentence.
 *   - Uses   (substrate):   packages / APIs / shared components it needs.
 *   - Notes  (contract):    seam details the block captions do not mention.
 *
 * Shares the warm-neutral (stone/sand) palette of the rest of the canvas
 * rather than a cool blue, so it does not read as a stray "AI panel" and
 * does not fight the gray arrows.
 *
 * Layout: a stacked header (from / verb / to, each block name in its own
 * scheme color) over a fixed three-pane body, NOT a collapsible accordion:
 *   - left column:  How on top, Uses below
 *   - right column: Notes, full height
 * The panes are always open (no chevrons), so the card reads as a designed
 * fact sheet rather than a generic disclosure list.
 *
 * Empty fields are omitted, and the column layout collapses to a single
 * stack when there is no Notes content, so the card never shows a pane
 * with nothing in it.
 *
 * Read-only: it never writes code. Direct manipulation is a later lens.
 */

const W = 380;
/** Fallback for block-name TEXT in the header: scheme accents can be light,
 *  but an uncategorized block has none, so it uses a darker stone. */
const NEUTRAL_TEXT = "#6B6256";

/** One always-open pane (icon + label header over its content). Hoisted to
 *  module scope so its component identity is stable across renders. */
function Pane({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Zap;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[#EBE6DD] bg-white p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#F0ECE4] text-[#9A8F7D]">
          <Icon className="h-3 w-3" strokeWidth={2.2} />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8276]">
          {label}
        </span>
      </div>
      {children}
    </section>
  );
}

export function ConnectionLensOverlay({
  detail,
  blocks,
  files,
  onClose,
  offset,
  onOffsetChange,
  fromColor,
  toColor,
}: {
  detail: ConnectionLensDetail;
  blocks: DiagramBlock[];
  files: FileEntry[];
  onClose: () => void;
  /** Drag offset (screen px), owned by the parent so it survives close. */
  offset: { dx: number; dy: number };
  onOffsetChange: (o: { dx: number; dy: number }) => void;
  /** Scheme accent of the source / target block, resolved upstream. Null
   *  when the block falls outside every group in the active scheme. */
  fromColor: string | null;
  toColor: string | null;
}) {
  const fromBlock = blocks.find((b) => b.id === detail.from);
  const toBlock = blocks.find((b) => b.id === detail.to);

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = useState<ConnectionDetailResult>({});
  const [error, setError] = useState("");

  // Transient drag tracking. The committed offset lives in the parent
  // (via offset / onOffsetChange) so it survives the card closing.
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(
    null,
  );

  // Union of both blocks' files, with content, sent to the backend.
  const detailFiles = useMemo(() => {
    const paths = new Set([
      ...(fromBlock?.provenance?.files ?? []),
      ...(toBlock?.provenance?.files ?? []),
    ]);
    return [...paths]
      .map((p) => files.find((f) => f.path === p))
      .filter((f): f is FileEntry => !!f)
      .map((f) => ({ path: f.path, content: f.content }));
  }, [fromBlock, toBlock, files]);

  const filesRef = useRef(detailFiles);
  filesRef.current = detailFiles;
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    setState("loading");
    if (!fromBlock || !toBlock) {
      setState("error");
      setError("Could not resolve both ends of this link.");
      return;
    }
    describeConnection({
      fromLabel: fromBlock.label,
      toLabel: toBlock.label,
      verb: detail.verb,
      fromCaption: fromBlock.caption,
      toCaption: toBlock.caption,
      files: filesRef.current,
    })
      .then((res) => {
        if (!aliveRef.current) return;
        setResult(res);
        setState("ready");
      })
      .catch((e) => {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : "Could not read this link.");
        setState("error");
      });
    return () => {
      aliveRef.current = false;
    };
    // fromBlock/toBlock identities are stable for a given detail; the
    // parent keys this overlay by from-to-verb, so this runs once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.from, detail.to, detail.verb]);

  // Which lenses actually have content (empty ones are never shown).
  const howP = !!result.realization;
  const usesP = !!result.uses && result.uses.length > 0;
  const notesP = !!result.hidden && result.hidden.length > 0;

  const fromText = fromColor ?? NEUTRAL_TEXT;
  const toText = toColor ?? NEUTRAL_TEXT;

  const howEl = howP ? (
    <Pane icon={Zap} label="How">
      <p className="break-words text-[12px] leading-snug text-[#4A453F]">
        {result.realization}
      </p>
    </Pane>
  ) : null;

  const usesEl = usesP ? (
    <Pane icon={Package} label="Uses">
      <div className="flex flex-wrap gap-1">
        {(result.uses ?? []).map((u, i) => (
          <span
            key={i}
            className="rounded-md bg-[#F0ECE4] px-1.5 py-0.5 text-[11px] font-medium text-[#6B6256]"
          >
            {u}
          </span>
        ))}
      </div>
    </Pane>
  ) : null;

  const notesEl = notesP ? (
    <Pane icon={Info} label="Notes">
      <ul className="space-y-1.5">
        {(result.hidden ?? []).map((h, i) => (
          <li
            key={i}
            className="flex gap-1.5 text-[12px] leading-snug text-[#4A453F]"
          >
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-[#B8AFA0]" />
            <span className="min-w-0 break-words">{h}</span>
          </li>
        ))}
      </ul>
    </Pane>
  ) : null;

  // Two columns only when there is a right pane (Notes) AND something for
  // the left; otherwise everything stacks in one column.
  const twoCol = !!notesEl && (!!howEl || !!usesEl);

  // Floating card, anchored to the diagram pane CENTER (which is where
  // opening zooms the edge to), offset to the right and vertically
  // centered on it. Capped to the pane height with an internal scroll.
  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} />

      <div
        className="absolute z-50 flex flex-col overflow-hidden rounded-xl border border-[#E7E2DA] bg-[#FCFBF9] shadow-xl"
        style={{
          left: "50%",
          top: "50%",
          transform: `translate(calc(36px + ${offset.dx}px), calc(-50% + ${offset.dy}px))`,
          width: W,
          maxHeight: "calc(100% - 32px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: from / verb / to stacked, each block name in its own
         *  scheme color so the card maps back to the canvas. Doubles as the
         *  drag handle. */}
        <div
          className="relative z-10 shrink-0 cursor-grab border-b border-[#F0ECE4] px-4 py-3 text-center active:cursor-grabbing"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragRef.current = {
              x: e.clientX,
              y: e.clientY,
              dx: offset.dx,
              dy: offset.dy,
            };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            onOffsetChange({
              dx: d.dx + (e.clientX - d.x),
              dy: d.dy + (e.clientY - d.y),
            });
          }}
          onPointerUp={(e) => {
            dragRef.current = null;
            try {
              (e.target as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
              // capture may already be gone; ignore.
            }
          }}
        >
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute right-2 top-2 cursor-pointer rounded p-0.5 text-[#A8A29E] transition-colors hover:bg-[#F0ECE4] hover:text-[#78716C]"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div
            className="truncate text-[13px] font-semibold leading-tight"
            style={{ color: fromText }}
            title={fromBlock?.label ?? detail.from}
          >
            {fromBlock?.label ?? detail.from}
          </div>
          <div className="my-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#A8A29E]">
            {detail.verb}
          </div>
          <div
            className="truncate text-[13px] font-semibold leading-tight"
            style={{ color: toText }}
            title={toBlock?.label ?? detail.to}
          >
            {toBlock?.label ?? detail.to}
          </div>
        </div>

        <div className="relative z-10 flex-1 overflow-y-auto p-3">
          {state === "loading" && (
            <div className="flex items-center gap-2 py-3 text-[12px] text-[#78716C]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Reading this link...
            </div>
          )}

          {state === "error" && (
            <div className="py-2 text-[12px] text-[#9C5638]">
              {error || "Could not read this link."}
            </div>
          )}

          {state === "ready" && !howEl && !usesEl && !notesEl && (
            <div className="py-2 text-[12px] leading-snug text-[#78716C]">
              No code-level detail found for this link. It may be an inferred
              relationship.
            </div>
          )}

          {state === "ready" &&
            (twoCol ? (
              <div className="grid grid-cols-2 items-start gap-2">
                <div className="flex min-w-0 flex-col gap-2">
                  {howEl}
                  {usesEl}
                </div>
                <div className="min-w-0">{notesEl}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {howEl}
                {usesEl}
                {notesEl}
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

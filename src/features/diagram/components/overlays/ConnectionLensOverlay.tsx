import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Loader2,
  Zap,
  Package,
  Info,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
 *   - Hidden (contract):    seam details the block captions do not mention.
 *
 * Visually distinct from the function bubbles (cool slate vs warm sand)
 * so it reads as "a line, not a block". Empty lenses are omitted, so the
 * card never shows a field with nothing in it. "How" auto-expands; the
 * others stay collapsed (with a hover peek) until clicked.
 *
 * Read-only: it never writes code. Direct manipulation is a later lens.
 */

const W = 320;

type LensKey = "how" | "uses" | "hidden";
const LENS_META: Record<LensKey, { icon: LucideIcon; label: string }> = {
  how: { icon: Zap, label: "How" },
  uses: { icon: Package, label: "Uses" },
  // "Notes" reads better than "Hidden": it is extra detail worth knowing,
  // not something secret. (The internal field stays `hidden`.)
  hidden: { icon: Info, label: "Notes" },
};

export function ConnectionLensOverlay({
  detail,
  blocks,
  files,
  onClose,
  offset,
  onOffsetChange,
}: {
  detail: ConnectionLensDetail;
  blocks: DiagramBlock[];
  files: FileEntry[];
  onClose: () => void;
  /** Drag offset (screen px), owned by the parent so it survives close. */
  offset: { dx: number; dy: number };
  onOffsetChange: (o: { dx: number; dy: number }) => void;
}) {
  const fromBlock = blocks.find((b) => b.id === detail.from);
  const toBlock = blocks.find((b) => b.id === detail.to);

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = useState<ConnectionDetailResult>({});
  const [error, setError] = useState("");
  // How is open by default; the user opens the others on demand.
  const [open, setOpen] = useState<Record<LensKey, boolean>>({
    how: true,
    uses: false,
    hidden: false,
  });

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
  const present: LensKey[] = [];
  if (result.realization) present.push("how");
  if (result.uses && result.uses.length > 0) present.push("uses");
  if (result.hidden && result.hidden.length > 0) present.push("hidden");

  const peek = (k: LensKey): string => {
    if (k === "uses") return (result.uses ?? []).join(", ");
    if (k === "hidden") return (result.hidden ?? []).join(" · ");
    return result.realization ?? "";
  };

  // Floating card, anchored to the diagram pane CENTER (which is where
  // opening zooms the edge to), offset to the right and vertically
  // centered on it. Anchoring to the centered edge (not the raw click)
  // keeps the card in the right place after the zoom animation. Capped to
  // the pane height with an internal scroll so long content is not cut.
  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <div
        className="absolute z-50 flex flex-col rounded-xl border border-[#CFD6DD] bg-[#F7F9FB] shadow-xl"
        style={{
          left: "50%",
          top: "50%",
          transform: `translate(calc(36px + ${offset.dx}px), calc(-50% + ${offset.dy}px))`,
          width: W,
          maxHeight: "calc(100% - 32px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: from -> verb -> to. Doubles as the drag handle. */}
        <div
          className="flex shrink-0 cursor-grab items-start gap-2 border-b border-[#E1E6EB] px-3.5 py-2.5 active:cursor-grabbing"
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
          <div className="min-w-0 flex-1 text-[12px] leading-snug text-[#44505B]">
            <span className="font-semibold">{fromBlock?.label ?? detail.from}</span>
            <span className="mx-1 text-[#8A97A3]">{detail.verb}</span>
            <span className="font-semibold">{toBlock?.label ?? detail.to}</span>
          </div>
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className="cursor-pointer rounded p-0.5 text-[#8A97A3] transition-colors hover:bg-[#E7ECF1] hover:text-[#55616C]"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 py-3">
          {state === "loading" && (
            <div className="flex items-center gap-2 py-3 text-[12px] text-[#6A7682]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Reading this link...
            </div>
          )}

          {state === "error" && (
            <div className="py-2 text-[12px] text-[#9C5638]">
              {error || "Could not read this link."}
            </div>
          )}

          {state === "ready" && present.length === 0 && (
            <div className="py-2 text-[12px] leading-snug text-[#6A7682]">
              No code-level detail found for this link. It may be an inferred
              relationship.
            </div>
          )}

          {state === "ready" && present.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {present.map((k) => {
                const meta = LENS_META[k];
                const Icon = meta.icon;
                const isOpen = open[k];
                return (
                  <div key={k}>
                    <button
                      onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}
                      title={!isOpen ? peek(k) : undefined}
                      className="flex w-full items-center gap-1.5 rounded-lg border border-[#D5DCE3] bg-white px-2 py-1.5 text-left transition-colors hover:border-[#BCC6CF]"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#EAEEF2] text-[#6A7682]">
                        <Icon className="h-3 w-3" strokeWidth={2.2} />
                      </span>
                      <span className="text-[11.5px] font-semibold text-[#55616C]">
                        {meta.label}
                      </span>
                      <span className="ml-auto text-[#A6B0BA]">
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-2 pb-1 pt-1.5">
                        {k === "how" && (
                          <p className="text-[12px] leading-snug text-[#465058]">
                            {result.realization}
                          </p>
                        )}
                        {k === "uses" && (
                          <div className="flex flex-wrap gap-1">
                            {(result.uses ?? []).map((u, i) => (
                              <span
                                key={i}
                                className="rounded-md bg-[#E9EEF2] px-1.5 py-0.5 text-[11px] font-medium text-[#52606B]"
                              >
                                {u}
                              </span>
                            ))}
                          </div>
                        )}
                        {k === "hidden" && (
                          <ul className="space-y-1">
                            {(result.hidden ?? []).map((h, i) => (
                              <li
                                key={i}
                                className="flex gap-1.5 text-[12px] leading-snug text-[#465058]"
                              >
                                <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-[#8A97A3]" />
                                {h}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

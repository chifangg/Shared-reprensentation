import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BlockCategory } from "../../types";
import { BLOCK_CATEGORIES, CATEGORY_ORDER } from "../../util/blockCategory";

/**
 * Small color key pinned to the bottom-left of the canvas. Lists only
 * the categories actually present in the current diagram (in canonical
 * order) so the user can read the color-coding without guessing.
 *
 * Collapsed by default (just swatch + label). Clicking the header
 * expands every row to show its `blurb`, the same "what goes in this
 * category" definition the model is given, so the user can learn the
 * taxonomy without leaving the canvas.
 *
 * Matches the warm card chrome the rest of the overlays use (cream
 * surface, hairline border). The swatch mirrors the blocks themselves:
 * a dark accent frame around a light tint fill, so the legend reads as
 * the same color cue the user scans for on the blocks.
 */
export function CategoryLegend({ present }: { present: Set<BlockCategory> }) {
  const [expanded, setExpanded] = useState(false);
  const items = CATEGORY_ORDER.filter((c) => present.has(c));
  if (items.length === 0) return null;
  return (
    <div
      className={`absolute bottom-4 left-4 z-30 rounded-lg border border-[#E7E2DA] bg-[#FCFBF9]/95 px-3 py-2.5 shadow-sm backdrop-blur-sm ${
        expanded ? "w-60" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mb-1.5 flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#999999] transition-colors hover:text-[#666666]"
        title={expanded ? "Hide definitions" : "Show what each category means"}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
        )}
        Categories
      </button>
      <div className="flex flex-col gap-1.5">
        {items.map((c) => {
          const { label, tint, accent, blurb } = BLOCK_CATEGORIES[c];
          return (
            <div key={c} className="flex items-start gap-2">
              <span
                className="mt-0.5 h-3 w-3 shrink-0 rounded-sm border-2"
                style={{ backgroundColor: tint, borderColor: accent }}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] leading-none text-[#2A2622]">
                  {label}
                </span>
                {expanded && (
                  <span className="text-[10px] leading-snug text-[#888888]">
                    {blurb}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

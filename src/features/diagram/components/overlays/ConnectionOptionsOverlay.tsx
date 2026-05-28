import { useState, type ReactNode } from "react";
import type {
  ConnectionOption,
  DiagramBlock,
  EditTarget,
} from "../../types";
import { OptionCardButton } from "./OptionCardButton";

/**
 * Floating panel pinned to the bottom-center of the diagram canvas
 * once Claude has proposed options for a freshly-pulled arrow. The
 * user picks one (block_level / detail / no change) or types a free-
 * form description into the "Others" card; both paths feed back into
 * `onPick(option)` so the parent can fire the round-2 execute prompt.
 *
 * Floating overlay over the canvas (not anchored at the arrow midpoint)
 * — keeps clear of overlapping blocks and stays predictable while the
 * marching-ants arrow visually links it to the diagram.
 */
export function ConnectionOptionsOverlay({
  target,
  options,
  blocks,
  onPick,
  onCancel,
}: {
  target: EditTarget;
  options: ConnectionOption[];
  blocks: DiagramBlock[];
  onPick: (option: ConnectionOption) => void;
  onCancel: () => void;
}) {
  const [otherText, setOtherText] = useState("");
  const [othersExpanded, setOthersExpanded] = useState(false);

  const submitOthers = () => {
    const trimmed = otherText.trim();
    if (trimmed.length === 0) return;
    // We don't know the kind yet — let Claude decide what fits.
    // Default to "detail" so any pending arrow gets removed; if Claude
    // actually adds a block-level link, the auto-regen after Claude's
    // turn will surface it again.
    onPick({
      title: trimmed,
      detail: "User-described change.",
      kind: "detail",
    });
  };

  // Build the contextual header based on target kind.
  let headerEyebrow: string;
  let headerLine: ReactNode;
  if (target.kind === "arrow") {
    const fromBlock = blocks.find((b) => b.id === target.from);
    const toBlock = blocks.find((b) => b.id === target.to);
    headerEyebrow = "Pick a change";
    headerLine = (
      <>
        for connection{" "}
        <span className="font-semibold">
          {fromBlock?.label ?? target.from}
        </span>{" "}
        →{" "}
        <span className="font-semibold">{toBlock?.label ?? target.to}</span>
      </>
    );
  } else if (target.kind === "block") {
    const block = blocks.find((b) => b.id === target.id);
    headerEyebrow = "Pick a block action";
    headerLine = (
      <>
        for block{" "}
        <span className="font-semibold">{block?.label ?? target.id}</span>
      </>
    );
  } else {
    headerEyebrow = "Pick a new module";
    headerLine = <>to add to the project</>;
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-[#0F172A]/30 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        // Clicking the backdrop cancels (only when the click landed
        // on the backdrop itself, not inside the panel).
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-[min(760px,calc(100%-48px))] rounded-2xl border border-[#78716C]/30 bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#78716C]">
              {headerEyebrow}
            </div>
            <div className="mt-0.5 text-[14px] text-[#222222]">
              {headerLine}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            title="Cancel (remove arrow)"
            className="rounded-md border border-[#D4D4D4] bg-white px-2 py-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
          >
            ✕
          </button>
        </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((opt, i) => (
          <OptionCardButton key={i} option={opt} onClick={() => onPick(opt)} />
        ))}
        {/* "Others" card: expand to text input, submit free-form intent. */}
        <div
          className={`flex flex-col items-start gap-1.5 rounded-lg border border-dashed border-[#D4D4D4] bg-[#FAFAFA] px-3 py-2 ${
            othersExpanded ? "" : "cursor-pointer hover:bg-[#F5F5F4]"
          }`}
          onClick={() => {
            if (!othersExpanded) setOthersExpanded(true);
          }}
        >
          <div className="flex w-full items-center gap-2">
            <span className="shrink-0 rounded border border-[#D4D4D4] px-1 py-px font-mono text-[9px] uppercase tracking-wider text-[#666666]">
              others
            </span>
            <span className="text-sm font-medium text-[#222222]">
              Something else…
            </span>
          </div>
          {othersExpanded ? (
            <>
              <input
                autoFocus
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitOthers();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setOthersExpanded(false);
                    setOtherText("");
                  }
                }}
                placeholder="Describe what you want Claude to do for this arrow"
                className="w-full rounded-md border border-[#D4D4D4] bg-white px-2 py-1 text-[12px] text-[#222222] outline-none focus:border-[#78716C]"
              />
              <div className="flex w-full items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOthersExpanded(false);
                    setOtherText("");
                  }}
                  className="rounded-md border border-[#D4D4D4] bg-white px-2 py-0.5 text-[11px] text-[#666666] hover:bg-[#FAFAFA]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitOthers}
                  disabled={otherText.trim().length === 0}
                  className="rounded-md bg-[#78716C] px-2.5 py-0.5 text-[11px] font-medium text-white shadow-sm hover:bg-[#57534E] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
                >
                  Send ↵
                </button>
              </div>
            </>
          ) : (
            <div className="text-xs text-[#666666]">
              Describe a custom change in your own words.
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

import { useState, type ReactNode } from "react";
import type { DiagramBlock, EditTarget } from "../../types";

/**
 * Pre-suggestions gate: pops the moment a user action lands on the
 * canvas (arrow drop, block ⋯, "+" / dbl-click pane). Two paths:
 *
 *   - "Describe yourself" expands into a text input. Submitting jumps
 *     straight to round-2 execute (skips the suggestions round-trip,
 *     fastest path for users who already know what they want).
 *   - "Ask Claude for suggestions" dispatches round-1; cards land in
 *     the cards overlay when Claude responds.
 *
 * Backdrop click cancels (and removes any pending placeholder via the
 * parent's removeTargetVisual). Centered modal so it doesn't fight
 * with overlapping blocks like the older arrow-midpoint popover did.
 */
export function IntentGate({
  target,
  blocks,
  onAskSuggestions,
  onDescribe,
  onCancel,
}: {
  target: EditTarget;
  blocks: DiagramBlock[];
  onAskSuggestions: () => void;
  onDescribe: (text: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "describe">("choose");
  const [text, setText] = useState("");

  let eyebrow: string;
  let line: ReactNode;
  if (target.kind === "arrow") {
    const from = blocks.find((b) => b.id === target.from);
    const to = blocks.find((b) => b.id === target.to);
    eyebrow = "New connection";
    line = (
      <>
        <span className="font-semibold">{from?.label ?? target.from}</span>
        {" → "}
        <span className="font-semibold">{to?.label ?? target.to}</span>
      </>
    );
  } else if (target.kind === "block") {
    const b = blocks.find((bk) => bk.id === target.id);
    eyebrow = "Block action";
    line = (
      <>
        on{" "}
        <span className="font-semibold">{b?.label ?? target.id}</span>
      </>
    );
  } else {
    eyebrow = "New module";
    line = <>add something to the project</>;
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-[#0F172A]/30 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-[min(480px,calc(100%-48px))] rounded-2xl border border-[#3B5BD9]/30 bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#3B5BD9]">
              {eyebrow}
            </div>
            <div className="mt-0.5 text-[14px] text-[#222222]">{line}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            title="Cancel"
            className="rounded-md border border-[#D4D4D4] bg-white px-2 py-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
          >
            ✕
          </button>
        </div>

        {mode === "choose" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("describe")}
              className="flex flex-col items-start gap-1 rounded-lg border border-[#D4D4D4] bg-white px-3 py-2.5 text-left hover:border-[#3B5BD9]/40 hover:bg-[#F4F7FF]"
            >
              <span className="text-sm font-semibold text-[#222222]">
                Describe it yourself
              </span>
              <span className="text-xs text-[#666666]">
                You already know what you want — type it.
              </span>
            </button>
            <button
              type="button"
              onClick={onAskSuggestions}
              className="flex flex-col items-start gap-1 rounded-lg border border-[#3B5BD9]/40 bg-[#F4F7FF] px-3 py-2.5 text-left hover:bg-[#E6EEFF]"
            >
              <span className="text-sm font-semibold text-[#3B5BD9]">
                Ask Claude for suggestions
              </span>
              <span className="text-xs text-[#3B5BD9]/80">
                Get a few options to pick from.
              </span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onDescribe(text);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setMode("choose");
                  setText("");
                }
              }}
              placeholder="What do you want done? (⌘↩ to send)"
              rows={3}
              className="w-full resize-none rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1.5 text-[13px] text-[#222222] outline-none focus:border-[#3B5BD9]"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode("choose");
                  setText("");
                }}
                className="rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => onDescribe(text)}
                disabled={text.trim().length === 0}
                className="rounded-md bg-[#3B5BD9] px-3 py-1 text-[12px] font-medium text-white shadow-sm hover:bg-[#2E48B3] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
              >
                Send ⌘↩
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

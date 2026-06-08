import { X } from "lucide-react";
import { CONTEXT_KIND_LABEL, type ChatContextKind } from "@/core/chatContext";

/**
 * One attached-context chip in the chat panel (insert-file style). Color
 * coded by kind via the `accent` (left bar + tag). Purely presentational:
 * the diagram produces the data, ChatView owns add/remove. `onRemove`
 * present = editable chip in the input row; absent = read-only chip in a
 * sent message.
 */
export function ChatContextChip({
  kind,
  label,
  sublabel,
  accent,
  onRemove,
}: {
  kind: ChatContextKind;
  label: string;
  sublabel?: string;
  accent: string;
  onRemove?: () => void;
}) {
  return (
    <div
      className="group/chip flex max-w-[240px] items-stretch overflow-hidden rounded-md border border-[#2A2A2A] bg-[#1B1B1B]"
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
    >
      <div className="min-w-0 px-2 py-1">
        <div className="flex items-center gap-1.5">
          <span
            className="shrink-0 text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: accent }}
          >
            {CONTEXT_KIND_LABEL[kind]}
          </span>
          <span className="truncate text-[12px] font-medium text-[#E5E5E5]">
            {label}
          </span>
        </div>
        {sublabel && (
          <div className="truncate text-[10px] leading-tight text-[#888888]">
            {sublabel}
          </div>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="flex shrink-0 items-center px-1.5 text-[#666666] opacity-0 transition-opacity hover:text-[#BBBBBB] group-hover/chip:opacity-100"
          aria-label="Remove context"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

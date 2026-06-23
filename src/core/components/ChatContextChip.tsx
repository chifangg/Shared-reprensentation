import { X } from "lucide-react";
import { type ChatContextKind } from "@/core/chatContext";

/**
 * One attached-context chip in the chat panel. A small cream pill with an
 * accent dot (the element's category color) + its label. The cream fill
 * reads cleanly both on the light panel (input row) and on the espresso
 * user bubble (a sent message). Purely presentational: the diagram
 * produces the data, ChatView owns add/remove. `onRemove` present =
 * editable chip in the input row; absent = read-only chip in a sent
 * message.
 */
export function ChatContextChip({
  label,
  accent,
  onRemove,
}: {
  kind: ChatContextKind;
  label: string;
  sublabel?: string;
  accent: string;
  onRemove?: () => void;
}) {
  // Show only the element's name (the one thing that matters when
  // recalling what was attached). The file / capability counts are
  // noise here, so the sublabel is intentionally not rendered.
  return (
    <div className="group/chip inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-[#E2DACB] bg-[#FBF7EF] py-1 pl-2 pr-1.5">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-[2px]"
        style={{ background: accent }}
      />
      <span className="min-w-0 truncate text-[11.5px] font-medium text-[#2E2A25]">
        {label}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 flex shrink-0 items-center text-[#B3A998] opacity-0 transition-opacity hover:text-[#6E6457] group-hover/chip:opacity-100"
          aria-label="Remove context"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

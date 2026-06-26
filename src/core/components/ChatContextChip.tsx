import { X, Spline } from "lucide-react";
import { type ChatContextKind } from "@/core/chatContext";

/**
 * One attached-context chip in the chat panel. A small cream pill that
 * reads cleanly both on the light panel (input row) and on the espresso
 * user bubble (a sent message). Purely presentational: the diagram
 * produces the data, ChatView owns add/remove. `onRemove` present =
 * editable chip in the input row; absent = read-only chip in a sent
 * message.
 *
 * The leading marker disambiguates KIND, not just color:
 *   - block / capability: a filled swatch in the element's accent color
 *     (the category encoding). Made large enough that the muted,
 *     low-chroma category palette stays tellable apart at chip size.
 *   - link (a dragged connection): a connection glyph, never a swatch,
 *     so an arrow can never be mistaken for a block. Its label renders
 *     both endpoints with the arrow always visible (each side truncates
 *     independently), so you can see WHICH arrow even when it is long.
 */
export function ChatContextChip({
  kind,
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
  const isLink = kind === "link";
  // A link label is built as "from → to"; split so each endpoint can
  // truncate on its own and the arrow stays put.
  const [from, to] = isLink ? splitLink(label) : [label, ""];

  return (
    <div className="group/chip inline-flex max-w-[230px] items-center gap-1.5 rounded-lg border border-[#E2DACB] bg-[#FBF7EF] py-1 pl-1.5 pr-1.5">
      {isLink ? (
        <Spline
          className="h-3.5 w-3.5 shrink-0 -rotate-90"
          style={{ color: accent }}
          strokeWidth={2.25}
        />
      ) : (
        <span
          className="h-3 w-3 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.16)]"
          style={{ background: accent }}
        />
      )}

      {isLink ? (
        <span className="flex min-w-0 items-center gap-1 text-[11.5px] font-medium text-[#2E2A25]">
          <span className="min-w-0 max-w-[96px] truncate">{from}</span>
          <span className="shrink-0 text-[#B3A998]">→</span>
          <span className="min-w-0 max-w-[96px] truncate">{to}</span>
        </span>
      ) : (
        <span className="min-w-0 truncate text-[11.5px] font-medium text-[#2E2A25]">
          {label}
        </span>
      )}

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

/** Split a "from → to" link label back into its two endpoints. Falls
 *  back to (label, "") if the arrow is missing for any reason. */
function splitLink(label: string): [string, string] {
  const i = label.indexOf("→");
  if (i === -1) return [label.trim(), ""];
  return [label.slice(0, i).trim(), label.slice(i + 1).trim()];
}

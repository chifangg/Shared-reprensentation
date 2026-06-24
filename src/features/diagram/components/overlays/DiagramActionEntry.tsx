import { ArrowRight } from "lucide-react";

export type DiagramActionChip = { label: string; accent: string };

/**
 * The "agent did something on the diagram" record shown inline in the
 * chat transcript (pushed through the core chat-activity channel after a
 * code-editing turn). Same recessed sand material as the agent's other
 * diagram actions, with block chips tinted in their real category accent
 * so the entry ties back to the matching block on the canvas. On mount it
 * flashes a brief blue ring (see `diagram-action-in` in styles.css) to
 * sync with the canvas glow firing at the same moment.
 */
export function DiagramActionEntry({
  verb,
  chips,
  arrow,
}: {
  verb: string;
  chips: DiagramActionChip[];
  arrow?: boolean;
}) {
  return (
    // Indented into the agent's lane (past the avatar + timeline rail).
    <div className="flex justify-start pl-[37px]">
      <div className="diagram-action-in inline-flex max-w-[92%] flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[10px] bg-[#ECE1CB] px-3.5 py-2.5 text-[13px] leading-snug text-[#6E6353]">
        <span className="font-medium text-[#544A36]">{verb}</span>
        {chips.map((chip, i) => (
          <span key={i} className="inline-flex items-center gap-2">
            {arrow && i > 0 && (
              <ArrowRight
                size={14}
                className="text-[#9A8A66]"
                aria-hidden="true"
              />
            )}
            <span
              className="inline-flex max-w-[170px] items-center gap-1.5 truncate rounded-md border bg-white px-2 py-0.5 text-[11.5px] font-medium"
              style={{ borderColor: chip.accent, color: chip.accent }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-[2px]"
                style={{ background: chip.accent }}
              />
              {chip.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

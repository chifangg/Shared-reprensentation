import { SlidersHorizontal } from "lucide-react";
import type { IntentSelection } from "../../types";
import { VERBS } from "./IntentSurvey";
import { intentSummary } from "./IntentSurveySteps";

/**
 * Chip showing the user's current onboarding intent. Lives in the panel
 * header (portaled there from the canvas so it does not cover the
 * diagram) and replaces the old blunt "Regenerate" button. Its two jobs
 * are made explicit:
 *
 *   - LEFT zone  = what you picked. Discrete capability selections render
 *     as small colored tags (a swatch + the label) so multiple picks read
 *     clearly; a free-text answer renders as plain text.
 *   - RIGHT zone = a clear "Change" affordance, so it reads as editable.
 *
 * Clicking reopens the survey pre-filled. Just looking does not
 * regenerate; only changing the selection does (handled by the parent).
 * The "Change" icon is deliberately NOT a pencil, so it does not clash
 * with the pencil that is the "Edit" verb's own icon.
 */

/** Selection tags use ONE neutral parchment style on purpose. The block
 *  category palette already owns the colored space, so coloring these
 *  would clash with (and be mistaken for) the blocks. A colorless chip
 *  reads cleanly as "what you picked" without competing with the diagram. */
const MAX_TAGS = 3;

export function IntentChip({
  intent,
  onEdit,
}: {
  intent: IntentSelection;
  onEdit: () => void;
}) {
  const meta = VERBS.find((v) => v.value === intent.verb);
  const Icon = meta?.icon;
  // Discrete selections that should render as colored tags. Free-text
  // verbs (or free-text answers) fall back to a plain summary string.
  const caps =
    intent.verb === "understand"
      ? intent.understandCaps
      : intent.verb === "edit" || intent.verb === "reference"
        ? intent.capabilities
        : [];
  const shown = caps.slice(0, MAX_TAGS);
  const overflow = caps.length - shown.length;

  return (
    <button
      type="button"
      onClick={onEdit}
      title="Your current focus. Click to change what the diagram emphasizes (it only regenerates if you actually change the selection)."
      className="flex max-w-[480px] items-center gap-2.5 rounded-full border border-[#E7E2DA] bg-white py-1 pl-1.5 pr-2.5 shadow-sm transition-colors hover:border-[#D8CFC2] hover:bg-[#FCFBF9]"
    >
      {Icon && meta && (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          style={{ background: meta.tint, color: meta.accent }}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
      )}
      <span
        className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide"
        style={{ color: meta?.accent }}
      >
        {meta?.label}
      </span>
      {caps.length > 0 ? (
        <span className="flex min-w-0 items-center gap-1">
          {shown.map((c) => (
            <span
              key={c.id}
              className="max-w-[150px] truncate rounded-md border border-[#E4DCD0] bg-[#F2EDE4] px-1.5 py-0.5 text-[11px] font-medium text-[#6B6155]"
              title={c.label}
            >
              {c.label}
            </span>
          ))}
          {overflow > 0 && (
            <span className="shrink-0 rounded-md border border-[#E4DCD0] bg-[#EAE3D9] px-1.5 py-0.5 text-[11px] font-medium text-[#8A8178]">
              +{overflow}
            </span>
          )}
        </span>
      ) : (
        <span className="truncate text-[12.5px] text-[#5C544B]">
          {intentSummary(intent)}
        </span>
      )}
      <span className="mx-0.5 h-4 w-px shrink-0 bg-[#EAE4DA]" />
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#A0894F]">
        <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
        Change
      </span>
    </button>
  );
}

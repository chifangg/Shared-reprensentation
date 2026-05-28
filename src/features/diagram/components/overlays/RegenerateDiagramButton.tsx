import { RotateCcw } from "lucide-react";

/**
 * Top-right FAB. Clears the current goal so the IntentSurvey re-opens
 * (and resets the structure fetch state via useDiagramStructureFetch's
 * idle gate). Used when the user wants to re-answer the onboarding
 * survey for a different angle on the same project.
 */
export function RegenerateDiagramButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Re-answer the survey and regenerate the diagram"
      className="absolute right-4 top-4 z-40 flex h-9 items-center gap-1.5 rounded-full border border-[#D4D4D4] bg-white px-3 text-[12px] font-medium text-[#222222] shadow-md transition-colors hover:border-[#78716C]/40 hover:bg-[#F5F5F4]"
    >
      <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
      Regenerate
    </button>
  );
}

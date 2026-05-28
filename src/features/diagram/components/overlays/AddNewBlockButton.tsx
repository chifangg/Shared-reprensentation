import { Plus } from "lucide-react";

/**
 * Floating "+" FAB pinned to the bottom-right of the canvas. Clicking
 * it (or double-clicking the empty canvas) starts the new-block
 * intent-gate flow.
 */
export function AddNewBlockButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add a new module (or double-click empty canvas)"
      className="absolute bottom-4 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-[#3B5BD9]/30 bg-white text-[#3B5BD9] shadow-lg transition-colors hover:bg-[#F4F7FF]"
    >
      <Plus className="h-5 w-5" strokeWidth={2} />
    </button>
  );
}

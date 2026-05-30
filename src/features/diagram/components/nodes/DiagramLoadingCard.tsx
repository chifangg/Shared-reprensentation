import { Loader2 } from "lucide-react";
import { ElapsedClock } from "./ElapsedClock";

/**
 * The full-canvas card shown before the first block streams in.
 * Replaced by a small bottom-right chip (in DiagramFetchOverlay) once
 * blocks start arriving so the user can see what's been generated.
 */
export function DiagramLoadingCard({ startedAt }: { startedAt: number }) {
  return (
    <div className="flex w-72 flex-col items-center gap-3 rounded-lg bg-white px-6 py-4 text-[#484848] shadow-lg">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        <span className="font-medium">Claude is drawing the diagram…</span>
      </div>
      <div className="flex w-full items-center justify-between text-xs text-[#484848]/70">
        <span>Reading project...</span>
        <ElapsedClock startedAt={startedAt} />
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[#EAEAEA]">
        <div className="h-full w-1/3 animate-[loading-bar_1.4s_ease-in-out_infinite] rounded-full bg-[#484848]/60" />
      </div>
    </div>
  );
}

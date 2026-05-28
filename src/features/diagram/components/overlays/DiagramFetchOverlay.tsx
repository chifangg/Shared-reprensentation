import { AlertCircle, Loader2 } from "lucide-react";
import type { FetchState } from "../../types";
import { DiagramLoadingCard } from "../nodes/DiagramLoadingCard";
import { ElapsedClock } from "../nodes/ElapsedClock";

/**
 * Loading / streaming / error overlay states for the diagram canvas.
 *
 * Three layouts:
 *  - state.loading + no nodes yet → full-canvas blur + DiagramLoadingCard
 *  - state.loading + nodes streaming → bottom-right chip with count
 *  - state.error → centered red alert with Retry button
 *  - otherwise → renders nothing
 */
export function DiagramFetchOverlay({
  state,
  hasFiles,
  nodeCount,
  onRetry,
}: {
  state: FetchState;
  hasFiles: boolean;
  nodeCount: number;
  onRetry: () => void;
}) {
  if (!hasFiles) return null;

  if (state.kind === "loading") {
    // Once any blocks have arrived, drop the full-canvas blur so the
    // user can actually see what's been generated. Replace it with a
    // small bottom-right chip indicating Claude is still streaming.
    if (nodeCount > 0) {
      return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border border-[#D4D4D4] bg-white/95 px-3 py-1.5 text-xs text-[#484848] shadow-md">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          <span>Generating more — {nodeCount} so far</span>
          <ElapsedClock startedAt={state.startedAt} />
        </div>
      );
    }
    return (
      <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
        <DiagramLoadingCard startedAt={state.startedAt} />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center px-4">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-red-200 bg-white px-6 py-4 shadow-md">
          <AlertCircle className="h-5 w-5 text-red-500" strokeWidth={2} />
          <span className="text-center text-sm text-[#484848]">
            {state.message}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-[#484848] px-3 py-1 text-xs font-medium text-white hover:bg-[#222]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return null;
}

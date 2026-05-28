import { Loader2 } from "lucide-react";

/**
 * Top-right "Refocusing on the conversation…" chip shown while the
 * adaptive-focus delta fetch is in flight. Caller controls when to
 * render it (typically gated on a `regenerating` boolean).
 */
export function RegeneratingChip() {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-50 flex items-center gap-2 rounded-full border border-[#78716C]/30 bg-white/95 px-3 py-1.5 text-xs text-[#78716C] shadow-md">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      <span>Refocusing on the conversation…</span>
    </div>
  );
}

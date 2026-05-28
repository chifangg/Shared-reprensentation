import { Check } from "lucide-react";

/**
 * Floating "Just edited" toast pinned to the bottom-center of the
 * canvas after Claude finishes a turn that touched files. Shows file
 * chips (truncated, with hover-title for full path) and Claude's
 * one-paragraph summary text.
 *
 * Auto-dismissed by the parent's dismissRecentEdit on any subsequent
 * user action; clicking ✕ here also dismisses.
 */
export function EditSummaryToast({
  summary,
  onDismiss,
}: {
  summary: { files: string[]; text: string };
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-40 w-[min(560px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-[#3B5BD9]/30 bg-white p-3 shadow-xl">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-[#3B5BD9]">
          <Check className="h-3 w-3" strokeWidth={2.5} />
          Just edited
        </div>
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          className="rounded-md px-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
        >
          ✕
        </button>
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {summary.files.slice(0, 6).map((f) => (
          <span
            key={f}
            title={f}
            className="max-w-[200px] truncate rounded border border-[#D4D4D4] bg-[#FAFAFA] px-1.5 py-0.5 font-mono text-[10px] text-[#444444]"
          >
            {f.split("/").pop() ?? f}
          </span>
        ))}
        {summary.files.length > 6 && (
          <span className="text-[10px] text-[#999999]">
            +{summary.files.length - 6} more
          </span>
        )}
      </div>
      {summary.text && (
        <div className="text-[12px] leading-snug text-[#444444]">
          {summary.text}
        </div>
      )}
    </div>
  );
}

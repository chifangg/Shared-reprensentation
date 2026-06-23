import { FileText, FileX } from "lucide-react";
import type { ToolResultProps } from "@/core/tools/registry";

type Result =
  | {
      ok: true;
      path: string;
      content: string;
      offset: number;
      size: number;
      total_size: number;
      has_more: boolean;
      next_offset?: number;
    }
  | { ok: false; path: string; error: string; available_paths_sample?: string[] };

/**
 * Renders the tool_result bubble for `read_project_file`. The full file
 * body is back in Claude's transcript already; this UI is just a
 * compact "📄 read X (N bytes)" pill so the chat doesn't get drowned
 * in raw source. Errors surface inline with a small list of nearby
 * paths to help the user spot misspellings.
 */
export function ReadProjectFileResultCard({ content }: ToolResultProps<Result>) {
  if (!content || typeof content !== "object") {
    return (
      <div className="rounded-md border border-[#E0E0E0] bg-[#FAFAFA] px-3 py-1.5 text-xs text-[#666666]">
        Tool returned no parseable result.
      </div>
    );
  }

  if (!content.ok) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 text-red-700">
          <FileX className="h-3 w-3" strokeWidth={2} />
          <span className="font-mono">{content.path}</span>
        </div>
        <div className="text-red-600">{content.error}</div>
        {content.available_paths_sample &&
          content.available_paths_sample.length > 0 && (
            <div className="mt-1 text-red-700/80">
              Did you mean:
              <ul className="ml-3 mt-0.5 space-y-0.5">
                {content.available_paths_sample.map((p) => (
                  <li key={p} className="font-mono">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>
    );
  }

  // A read is a low-weight "agent looked at a file" event: one quiet
  // ghost line with a read icon + the path. No line/byte counts. When a
  // large file is paged in, the chunk that still has more to read shows
  // a faint "more" so the chat hints at the continuation without clutter.
  return (
    <div className="inline-flex max-w-full items-center gap-1.5 text-[12px] text-[#9A9081]">
      <FileText className="h-3.5 w-3.5 shrink-0 text-[#B3A998]" strokeWidth={2} />
      <span className="truncate font-mono text-[#8A8175]">{content.path}</span>
      {content.has_more && (
        <span className="shrink-0 text-[#B3A998]">· more</span>
      )}
    </div>
  );
}

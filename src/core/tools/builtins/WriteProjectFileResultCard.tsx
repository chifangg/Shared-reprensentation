import { FilePen, FileX, FilePlus } from "lucide-react";
import type { ToolResultProps } from "@/core/tools/registry";
import type { DiffLine } from "./WriteProjectFile";

type Result =
  | {
      ok: true;
      path: string;
      size: number;
      created: boolean;
      previous_size: number | null;
      added: number;
      removed: number;
      diff: DiffLine[];
    }
  | { ok: false; path: string; error: string };

/**
 * Tool-result bubble for `write_project_file`. Renders a unified-style
 * diff (green +, red -, grey context) so the chat shows exactly what
 * changed — mirroring how Claude Code surfaces its Edit tool results.
 */
export function WriteProjectFileResultCard({
  content,
}: ToolResultProps<Result>) {
  if (!content || typeof content !== "object") {
    return (
      <div className="rounded-md border border-[#E0E0E0] bg-[#FAFAFA] px-3 py-1.5 text-xs text-[#666666]">
        Tool returned no parseable result.
      </div>
    );
  }

  if (!content.ok) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        <FileX className="h-3 w-3" strokeWidth={2} />
        <span className="font-mono">{content.path}</span>
        <span className="text-red-600">— {content.error}</span>
      </div>
    );
  }

  const Icon = content.created ? FilePlus : FilePen;
  const verb = content.created ? "Created" : "Edited";

  return (
    <div className="overflow-hidden rounded-md border border-[#E0E0E0] bg-white text-xs">
      <header className="flex items-center gap-2 border-b border-[#E8E8E8] bg-[#FAFAFA] px-3 py-1.5">
        <Icon className="h-3 w-3 text-[#3B5BD9]" strokeWidth={2} />
        <span className="font-medium text-[#3B5BD9]">{verb}</span>
        <span className="font-mono text-[#222222]">{content.path}</span>
        <span className="ml-auto flex items-center gap-1.5 tabular-nums">
          {content.added > 0 && (
            <span className="text-emerald-600">+{content.added}</span>
          )}
          {content.removed > 0 && (
            <span className="text-red-600">-{content.removed}</span>
          )}
          {content.added === 0 && content.removed === 0 && (
            <span className="text-[#999999]">no changes</span>
          )}
        </span>
      </header>
      {content.diff.length > 0 && (
        <pre className="max-h-72 overflow-auto bg-white p-0 font-mono text-[11px] leading-snug">
          {content.diff.map((line, i) => {
            if (line.type === "gap") {
              return (
                <div
                  key={i}
                  className="select-none border-y border-[#F0F0F0] bg-[#FAFAFA] px-3 py-0.5 text-center text-[10px] text-[#999999]"
                >
                  ⋮
                </div>
              );
            }
            const marker =
              line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
            const cls =
              line.type === "add"
                ? "bg-emerald-50 text-emerald-900"
                : line.type === "remove"
                  ? "bg-red-50 text-red-900"
                  : "text-[#444444]";
            return (
              <div
                key={i}
                className={`flex whitespace-pre px-3 ${cls}`}
              >
                <span className="mr-2 inline-block w-3 select-none text-[#999999]">
                  {marker}
                </span>
                <span>{line.text || " "}</span>
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}

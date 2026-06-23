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

  // Cool-toned "code material" card, recessed into the warm chat surface
  // so a code change reads as a different kind of thing than speech.
  return (
    <div
      className="overflow-hidden rounded-[9px] bg-[#FBFAFC] text-xs"
      style={{
        boxShadow:
          "inset 0 2px 5px rgba(70,80,100,0.13), inset 0 0 0 1px rgba(70,80,100,0.10)",
      }}
    >
      <header className="flex items-center gap-2 border-b border-[#E6E8EC] bg-[#F2F3F6] px-3 py-1.5">
        <Icon className="h-3 w-3 text-[#7A818C]" strokeWidth={2} />
        <span className="font-medium text-[#5C6470]">{verb}</span>
        <span className="font-mono text-[#3C424C]">{content.path}</span>
        <span className="ml-auto flex items-center gap-1.5 tabular-nums">
          {content.added > 0 && (
            <span className="text-emerald-700">+{content.added}</span>
          )}
          {content.removed > 0 && (
            <span className="text-red-600">-{content.removed}</span>
          )}
          {content.added === 0 && content.removed === 0 && (
            <span className="text-[#99A0AB]">no changes</span>
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

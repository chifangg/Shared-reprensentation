/**
 * Serialize the uploaded project as a single XML-tagged string suitable
 * for the `/api/diagram` request body. The diagram backend uses this to
 * brief Claude about the project shape when generating the structure
 * stream (view=structure) and the focus delta (view=focus).
 *
 * Truncation caps are tuned for the diagram backend's streaming-NDJSON
 * response time — feeding it the entire project body unbounded blows
 * out per-request latency without improving the structure pass. Per
 * file 16 KB, total 80 KB. Files past the total cap appear in the tree
 * but their body is replaced with an "[omitted, total context cap
 * reached]" placeholder so the model still sees the path.
 *
 * This was previously in src/core/project.tsx; moved here because the
 * diagram is the only caller and the caps are diagram-specific. Pure
 * function with no React, no runtime side effects.
 */

import type { FileEntry } from "@/core/project";

const PER_FILE_CAP = 16 * 1024;
const TOTAL_CAP = 80 * 1024;

export function buildProjectContext(
  files: FileEntry[],
  goal: string | null,
): string {
  const tree = files
    .map((f) => f.path)
    .sort()
    .join("\n");

  let totalSoFar = 0;
  const fileBlocks = files
    .map((f) => {
      if (f.content.includes("\0")) {
        return `<file path="${f.path}">\n[binary file, ${f.size} bytes]\n</file>`;
      }

      if (totalSoFar >= TOTAL_CAP) {
        return `<file path="${f.path}">\n[${f.size} bytes — omitted, total context cap reached]\n</file>`;
      }

      let body = f.content;
      let truncatedNote = "";
      if (body.length > PER_FILE_CAP) {
        body = body.slice(0, PER_FILE_CAP);
        truncatedNote = `\n... [truncated, full file is ${f.size} bytes]`;
      }
      totalSoFar += body.length;
      return `<file path="${f.path}">\n${body}${truncatedNote}\n</file>`;
    })
    .join("\n\n");

  const goalBlock = goal
    ? `\n\n<user_goal>\n${goal}\n</user_goal>`
    : "";

  return `<project_context>\n<tree>\n${tree}\n</tree>\n\n${fileBlocks}${goalBlock}\n</project_context>`;
}

import { useEffect, useRef } from "react";
import { FilePen, Loader2 } from "lucide-react";
import type { ClientToolProps } from "@/core/tools/registry";
import { useProject } from "@/core/project";

interface WriteProjectFileInput {
  path: string;
  content: string;
}

export type DiffLine =
  | { type: "context"; text: string }
  | { type: "add"; text: string }
  | { type: "remove"; text: string }
  | { type: "gap" };

type WriteProjectFileResult =
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
 * LCS-based line diff. Returns one entry per line of the longest
 * common subsequence reconstruction:
 *  - context: line is identical in both files
 *  - remove:  line existed only in the old version
 *  - add:     line exists only in the new version
 *
 * Output is reduced to "hunks": every changed line plus a few
 * surrounding context lines. Long unchanged stretches collapse into a
 * single `gap` marker so the chat doesn't get drowned in unchanged
 * code when only a few lines actually moved.
 */
export function diffLines(
  oldText: string,
  newText: string,
  contextSize = 2,
): { hunks: DiffLine[]; added: number; removed: number } {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const all: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      all.push({ type: "context", text: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      all.push({ type: "remove", text: a[i - 1] });
      removed++;
      i--;
    } else {
      all.push({ type: "add", text: b[j - 1] });
      added++;
      j--;
    }
  }
  while (i > 0) {
    all.push({ type: "remove", text: a[--i] });
    removed++;
  }
  while (j > 0) {
    all.push({ type: "add", text: b[--j] });
    added++;
  }
  all.reverse();

  // Filter to hunks: keep changed lines + `contextSize` lines around
  // each change cluster, collapse the rest into a single gap marker.
  const near = new Set<number>();
  for (let k = 0; k < all.length; k++) {
    if (all[k].type !== "context") {
      for (let d = -contextSize; d <= contextSize; d++) {
        const idx = k + d;
        if (idx >= 0 && idx < all.length) near.add(idx);
      }
    }
  }
  const hunks: DiffLine[] = [];
  let inGap = false;
  for (let k = 0; k < all.length; k++) {
    if (near.has(k)) {
      hunks.push(all[k]);
      inGap = false;
    } else {
      if (!inGap && hunks.length > 0) {
        hunks.push({ type: "gap" });
      }
      inGap = true;
    }
  }
  return { hunks, added, removed };
}

/**
 * Invisible tool handler: Claude calls `write_project_file` with a path
 * and full new body. We overwrite the in-browser ProjectContext entry
 * (or create a new file if path is unseen) and resolve with a small
 * status payload so the chat can show what changed.
 */
export function WriteProjectFile({
  input,
  resolve,
}: ClientToolProps<WriteProjectFileInput, WriteProjectFileResult>) {
  const { files, updateFileContent } = useProject();
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    const path = input.path?.trim();
    if (!path) {
      resolve({ ok: false, path: path ?? "", error: "empty path" });
      return;
    }
    if (typeof input.content !== "string") {
      resolve({
        ok: false,
        path,
        error: "content must be a string",
      });
      return;
    }

    const existing = files.find((f) => f.path === path);
    const oldContent = existing?.content ?? "";
    const { hunks, added, removed } = diffLines(oldContent, input.content);
    updateFileContent(path, input.content);
    resolve({
      ok: true,
      path,
      size: input.content.length,
      created: !existing,
      previous_size: existing ? existing.size : null,
      added,
      removed,
      diff: hunks,
    });
  }, [files, input.path, input.content, updateFileContent, resolve]);

  // Best-effort byte count: long writes (>10KB) feel like the UI froze,
  // so surface progress as soon as the content arrives in the input.
  const bytes = typeof input.content === "string" ? input.content.length : 0;
  return (
    <div className="flex items-center gap-2 rounded-md border border-[#78716C]/20 bg-[#F5F5F4] px-3 py-1.5 text-xs text-[#78716C]">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      <FilePen className="h-3 w-3" strokeWidth={2} />
      <span className="truncate font-mono">{input.path}</span>
      {bytes > 0 && (
        <span className="ml-auto shrink-0 tabular-nums text-[#78716C]/70">
          writing {bytes.toLocaleString()} bytes…
        </span>
      )}
    </div>
  );
}

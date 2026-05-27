import { useEffect, useRef } from "react";
import { Pencil, Loader2 } from "lucide-react";
import type { ClientToolProps } from "@/core/tools/registry";
import { useProject } from "@/core/project";
import { diffLines, type DiffLine } from "./WriteProjectFile";

interface EditProjectFileInput {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

type EditProjectFileResult =
  | {
      ok: true;
      path: string;
      size: number;
      created: false;
      previous_size: number;
      added: number;
      removed: number;
      diff: DiffLine[];
    }
  | { ok: false; path: string; error: string; match_count?: number };

/**
 * Invisible handler for `edit_project_file`. Mirrors Claude Code's
 * built-in Edit tool: replace one substring with another, in place.
 *
 * Why this exists separately from `write_project_file`: full-file
 * overwrite forces Claude to re-emit the entire body even for a one
 * line change. For a 30KB file that's ~15-20s of output token streaming
 * vs. <1s for a tiny old/new pair. This is the hot path for actual
 * coding work — keep it cheap.
 *
 * Reuses `WriteProjectFileResultCard` for the result bubble since the
 * payload shape matches (diff + size + added/removed).
 */
export function EditProjectFile({
  input,
  resolve,
}: ClientToolProps<EditProjectFileInput, EditProjectFileResult>) {
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
    if (
      typeof input.old_string !== "string" ||
      typeof input.new_string !== "string"
    ) {
      resolve({
        ok: false,
        path,
        error: "old_string and new_string must both be strings",
      });
      return;
    }
    if (input.old_string === "") {
      resolve({
        ok: false,
        path,
        error:
          "old_string cannot be empty — use write_project_file to create a new file",
      });
      return;
    }
    if (input.old_string === input.new_string) {
      resolve({
        ok: false,
        path,
        error: "old_string and new_string are identical — nothing to change",
      });
      return;
    }

    const existing = files.find((f) => f.path === path);
    if (!existing) {
      resolve({
        ok: false,
        path,
        error: `file not found in uploaded project: ${path}`,
      });
      return;
    }

    const oldContent = existing.content;
    const replaceAll = input.replace_all === true;

    // Count occurrences without scanning the whole file for each step.
    let count = 0;
    let scanFrom = 0;
    while (true) {
      const idx = oldContent.indexOf(input.old_string, scanFrom);
      if (idx === -1) break;
      count++;
      scanFrom = idx + input.old_string.length;
      if (count > 1 && !replaceAll) break; // early exit — won't proceed anyway
    }

    if (count === 0) {
      resolve({
        ok: false,
        path,
        error: `old_string not found in ${path}. Re-read the file and pass an exact substring (including indentation and whitespace).`,
        match_count: 0,
      });
      return;
    }
    if (count > 1 && !replaceAll) {
      resolve({
        ok: false,
        path,
        error: `old_string occurs multiple times in ${path}. Include more surrounding context to make it unique, or pass replace_all=true to replace every occurrence.`,
        match_count: count,
      });
      return;
    }

    // Safety net for the most common replace_all footgun: a short
    // common substring (like "server." or "name") matched many places
    // — likely hits unrelated log strings, comments, or other
    // identifiers and corrupts the file. We refuse here and tell
    // Claude how to recover so the user doesn't end up with a quietly
    // mangled file. Long unique strings still go through (e.g.
    // renaming a 30-char constant across the codebase is fine).
    if (replaceAll && count > 3 && input.old_string.length < 20) {
      resolve({
        ok: false,
        path,
        error:
          `Refused: replace_all with a ${input.old_string.length}-char old_string ("${input.old_string}") would change ${count} occurrences in ${path}. This is the classic footgun — short strings hit unrelated log strings / comments / other identifiers and silently corrupt the file. ` +
          `Fix: either (a) drop replace_all and emit a separate edit_project_file call per occurrence, each with enough surrounding lines to be unique; or (b) keep replace_all but extend old_string to include enough context (~20+ chars, ideally a full identifier or line fragment) that it can only match the intended places.`,
        match_count: count,
      });
      return;
    }

    const newContent = replaceAll
      ? oldContent.split(input.old_string).join(input.new_string)
      : oldContent.replace(input.old_string, input.new_string);

    const { hunks, added, removed } = diffLines(oldContent, newContent);
    updateFileContent(path, newContent);
    resolve({
      ok: true,
      path,
      size: newContent.length,
      created: false,
      previous_size: existing.size,
      added,
      removed,
      diff: hunks,
    });
  }, [
    files,
    input.path,
    input.old_string,
    input.new_string,
    input.replace_all,
    updateFileContent,
    resolve,
  ]);

  const oldBytes =
    typeof input.old_string === "string" ? input.old_string.length : 0;
  const newBytes =
    typeof input.new_string === "string" ? input.new_string.length : 0;
  return (
    <div className="flex items-center gap-2 rounded-md border border-[#3B5BD9]/20 bg-[#F4F7FF] px-3 py-1.5 text-xs text-[#3B5BD9]">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      <Pencil className="h-3 w-3" strokeWidth={2} />
      <span className="truncate font-mono">{input.path}</span>
      {(oldBytes > 0 || newBytes > 0) && (
        <span className="ml-auto shrink-0 tabular-nums text-[#3B5BD9]/70">
          editing −{oldBytes} +{newBytes} bytes
        </span>
      )}
    </div>
  );
}

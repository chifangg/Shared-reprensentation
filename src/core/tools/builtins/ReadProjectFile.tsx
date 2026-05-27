import { useEffect, useRef } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { ClientToolProps } from "@/core/tools/registry";
import { useProject } from "@/core/project";

interface ReadProjectFileInput {
  path: string;
}

type ReadProjectFileResult =
  | {
      ok: true;
      path: string;
      content: string;
      size: number;
      /** True when `content` is a prefix of the actual file (we cap big
       *  files because very large tool_result payloads corrupt
       *  somewhere in the Claude Code → backend → frontend chain — see
       *  MAX_READ_BYTES below). */
      truncated?: boolean;
      /** Original file size in bytes (set when truncated is true). */
      full_size?: number;
    }
  | { ok: false; path: string; error: string; available_paths_sample?: string[] };

/**
 * Per-read cap on the content returned to Claude.
 *
 * Root cause: Claude Code's CLI auto-persists any tool_result whose
 * serialized payload exceeds ~50KB. When that triggers, the model only
 * sees a `<persisted-output> ... Preview (first 2KB) ...` summary
 * instead of the actual JSON we returned — our `--allowed-tools` allow
 * list excludes the built-in Read tool, so the model can't retrieve
 * the persisted file either. Net effect: large reads silently lose
 * their data and the result card shows "Tool returned no parseable
 * result" while Claude makes wild guesses about file contents.
 *
 * Cap well under that threshold (raw 30KB + JSON escaping + framing
 * stays below 50KB) so every read round-trips intact. Mark truncation
 * explicitly so Claude knows to either work with the prefix or ask
 * the user to narrow scope.
 */
const MAX_READ_BYTES = 30 * 1024;

/**
 * Invisible tool handler: when Claude calls `read_project_file`, this
 * component mounts in the chat. It immediately looks up the requested
 * path in the in-browser ProjectContext and resolves the tool with the
 * file body (or a structured error suggesting nearby paths if the
 * requested one doesn't exist).
 *
 * The visible chat bubble for a successful read is rendered by
 * `ReadProjectFileResultCard` once the tool_result echoes back.
 */
export function ReadProjectFile({
  input,
  resolve,
}: ClientToolProps<ReadProjectFileInput, ReadProjectFileResult>) {
  const { files } = useProject();
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;

    const requested = input.path.trim();
    if (!requested) {
      resolve({ ok: false, path: requested, error: "empty path" });
      return;
    }

    // Claude habitually probes "." / "/" / "./" as a first move to
    // "see what's in the project" — but `read_project_file` only takes
    // single files, so it errored out with a red card. Instead, treat
    // these as a request for the file tree and return it as plain
    // text content. Saves one round-trip and avoids the scary red
    // "no file matching '.'" bubble.
    if (
      requested === "." ||
      requested === "/" ||
      requested === "./" ||
      requested === ""
    ) {
      const tree = files
        .map((x) => x.path)
        .sort()
        .join("\n");
      const treeBody = `Project file tree (${files.length} files). Pass one of these paths to read its body.\n\n${tree}`;
      resolve({
        ok: true,
        path: requested,
        content: treeBody,
        size: treeBody.length,
      });
      return;
    }

    // Resolution ladder — Claude often passes paths that are close but
    // not exact (wrong prefix, swapped extension, dropped subdir). Try
    // each progressively looser rule and accept the first unambiguous
    // hit so we surface code instead of a red "not found" card.
    //
    //   1. Exact match.
    //   2. Suffix match (Claude trimmed "myproject/" off the front).
    //   3. Same basename anywhere in the tree — only if it's unique.
    //   4. Same basename with a swapped extension among ts/tsx/js/jsx
    //      — only if it's unique.
    //
    // Anything that hits 2–4 gets returned with the actual matched
    // path so Claude (and the user-visible result card) see the right
    // file even though the requested path was off.
    let f = files.find((x) => x.path === requested);
    if (!f) {
      f = files.find(
        (x) =>
          x.path.endsWith("/" + requested) || x.path.endsWith(requested),
      );
    }
    if (!f) {
      const basename = requested.split("/").pop() ?? requested;
      const baseMatches = files.filter(
        (x) => (x.path.split("/").pop() ?? "") === basename,
      );
      if (baseMatches.length === 1) f = baseMatches[0];
    }
    if (!f) {
      const basename = requested.split("/").pop() ?? requested;
      const dot = basename.lastIndexOf(".");
      if (dot > 0) {
        const stem = basename.slice(0, dot);
        const altExts = ["ts", "tsx", "js", "jsx", "mts", "cts"];
        const stemMatches = files.filter((x) => {
          const fname = x.path.split("/").pop() ?? "";
          const fdot = fname.lastIndexOf(".");
          if (fdot <= 0) return false;
          const fstem = fname.slice(0, fdot);
          const fext = fname.slice(fdot + 1);
          return fstem === stem && altExts.includes(fext);
        });
        if (stemMatches.length === 1) f = stemMatches[0];
      }
    }
    if (!f) {
      const sample = files
        .filter((x) =>
          requested
            .toLowerCase()
            .split(/[\/.]/)
            .some((tok) => tok && x.path.toLowerCase().includes(tok)),
        )
        .slice(0, 8)
        .map((x) => x.path);
      resolve({
        ok: false,
        path: requested,
        error: `no file matching '${requested}' in the uploaded project`,
        available_paths_sample:
          sample.length > 0 ? sample : files.slice(0, 8).map((x) => x.path),
      });
      return;
    }

    if (f.content.includes("\0")) {
      resolve({
        ok: false,
        path: f.path,
        error: `binary file (${f.size} bytes) — cannot return as text`,
      });
      return;
    }

    if (f.content.length > MAX_READ_BYTES) {
      resolve({
        ok: true,
        path: f.path,
        content: f.content.slice(0, MAX_READ_BYTES),
        size: MAX_READ_BYTES,
        truncated: true,
        full_size: f.size,
      });
      return;
    }

    resolve({
      ok: true,
      path: f.path,
      content: f.content,
      size: f.size,
    });
  }, [files, input.path, resolve]);

  return (
    <div className="flex items-center gap-2 rounded-md border border-[#3B5BD9]/20 bg-[#F4F7FF] px-3 py-1.5 text-xs text-[#3B5BD9]">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      <FileText className="h-3 w-3" strokeWidth={2} />
      <span className="truncate font-mono">{input.path}</span>
    </div>
  );
}

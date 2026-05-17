import { useEffect, useRef } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { ClientToolProps } from "@/core/tools/registry";
import { useProject } from "@/core/project";

interface ReadProjectFileInput {
  path: string;
}

type ReadProjectFileResult =
  | { ok: true; path: string; content: string; size: number }
  | { ok: false; path: string; error: string; available_paths_sample?: string[] };

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

    // Exact match first; then fall back to a suffix match so Claude
    // can pass "src/foo.py" even if the upload root is "myproject/src/foo.py".
    let f = files.find((x) => x.path === requested);
    if (!f) {
      f = files.find(
        (x) =>
          x.path.endsWith("/" + requested) || x.path.endsWith(requested),
      );
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

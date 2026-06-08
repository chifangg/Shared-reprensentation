import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { FileEntry } from "@/core/project";
import type { FetchState } from "../types";
import { refreshBlock } from "../api/fetchBlockRefresh";

/**
 * After a block-level edit settles (no full regen), re-derive the target
 * block(s)' caption + capabilities from their now-updated source and fold
 * the result back in place, so the drill-in bubbles + description reflect
 * what the user just changed. Layout is preserved; the block keeps its
 * post-edit blue glow.
 *
 * `refreshTargets` (blockId -> extra file paths) is filled by the settle
 * effect: the block the user clicked carries the files created / edited
 * this turn, so a BRAND-NEW file surfaces as a new capability AND joins
 * that block's provenance. Failures are ignored (keep old values).
 */

const MAX_REFRESH = 5;

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

export function useBlockCapabilityRefresh({
  refreshTargets,
  setRefreshTargets,
  state,
  setState,
  files,
}: {
  refreshTargets: Map<string, string[]>;
  setRefreshTargets: Dispatch<SetStateAction<Map<string, string[]>>>;
  state: FetchState;
  setState: Dispatch<SetStateAction<FetchState>>;
  files: FileEntry[];
}): void {
  // Read files / state through refs so the effect fires only on the
  // refresh-queue change, not on every file write or layout tick.
  const filesRef = useRef(files);
  filesRef.current = files;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (refreshTargets.size === 0) return;
    const snapshot = stateRef.current;
    // Consume the queue immediately so this never re-fires for the same set.
    setRefreshTargets(new Map());
    if (snapshot.kind !== "ready") return;

    const projectFiles = filesRef.current;
    const exact = new Map(projectFiles.map((f) => [f.path, f.content]));
    // Resolve a provenance/edited path to file content, tolerating leading
    // path-segment differences (suffix match) like blocksForFiles does.
    const contentOf = (path: string): string => {
      const hit = exact.get(path);
      if (hit !== undefined) return hit;
      const norm = path.replace(/^\.?\//, "");
      const match = projectFiles.find(
        (f) => f.path.endsWith(`/${norm}`) || norm.endsWith(`/${f.path}`),
      );
      return match?.content ?? "";
    };

    const entries = Array.from(refreshTargets.entries()).slice(0, MAX_REFRESH);
    for (const [id, extraFiles] of entries) {
      const block = snapshot.schema.blocks.find((b) => b.id === id);
      if (!block) continue;
      // Extra files that actually exist in the project (so a new file
      // joins provenance; missing paths are dropped).
      const presentExtra = extraFiles.filter((p) => contentOf(p).length > 0);
      const allPaths = uniq([...(block.provenance?.files ?? []), ...presentExtra]);
      const blobs = allPaths
        .map((p) => ({ path: p, content: contentOf(p) }))
        .filter((b) => b.content.length > 0);
      if (blobs.length === 0) continue;

      refreshBlock({ label: block.label, caption: block.caption, files: blobs })
        .then((res) => {
          const hasCaption = !!res.caption;
          const hasCaps = !!res.capabilities && res.capabilities.length > 0;
          if (!hasCaption && !hasCaps && presentExtra.length === 0) return;
          setState((prev) => {
            if (prev.kind !== "ready") return prev;
            return {
              kind: "ready",
              schema: {
                arrows: prev.schema.arrows,
                blocks: prev.schema.blocks.map((b) =>
                  b.id === id
                    ? {
                        ...b,
                        caption: res.caption ?? b.caption,
                        capabilities: hasCaps
                          ? res.capabilities
                          : b.capabilities,
                        provenance: {
                          files: uniq([
                            ...(b.provenance?.files ?? []),
                            ...presentExtra,
                          ]),
                          functions: b.provenance?.functions ?? [],
                        },
                      }
                    : b,
                ),
              },
            };
          });
        })
        .catch(() => {
          // keep old caption / capabilities / provenance
        });
    }
  }, [refreshTargets, setRefreshTargets, setState]);
}

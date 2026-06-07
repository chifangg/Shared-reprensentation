import type { DiagramBlock } from "../types";

/**
 * Map a set of edited file paths to the ids of the blocks that own them
 * (via `provenance.files`). Used to light up the block(s) Claude just
 * edited: a blue pulse while the turn runs, a blue ring once it settles.
 *
 * Path matching is lenient on the prefix because the tool's `path`
 * (e.g. "Annotation_Board/scraper.py") and a block's provenance entry
 * may be recorded with different leading segments. We treat two paths as
 * the same file when, after normalizing slashes, they are equal or one
 * is a path-boundary suffix of the other. Basename-only matching is
 * deliberately avoided so two unrelated "main.py" files don't collide.
 */
function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

function sameFile(a: string, b: string): boolean {
  const x = normalizePath(a);
  const y = normalizePath(b);
  if (x.length === 0 || y.length === 0) return false;
  if (x === y) return true;
  return x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

export function blocksForFiles(
  blocks: DiagramBlock[],
  files: Iterable<string>,
): Set<string> {
  const edited = Array.from(files, normalizePath).filter((f) => f.length > 0);
  const ids = new Set<string>();
  if (edited.length === 0) return ids;
  for (const b of blocks) {
    const owned = b.provenance?.files ?? [];
    for (const pf of owned) {
      if (edited.some((ep) => sameFile(pf, ep))) {
        ids.add(b.id);
        break;
      }
    }
  }
  return ids;
}

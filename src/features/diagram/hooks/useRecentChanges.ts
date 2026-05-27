import {
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { FetchState } from "../types";

export type RecentChanges = {
  blockIds: Set<string>;
  arrowKeys: Set<string>;
};

export type PreRegenSnapshot = {
  blockIds: Set<string>;
  arrowKeys: Set<string>;
};

/**
 * Owns the `recentChanges` state — the set of block ids / arrow keys
 * that should glow on the canvas to highlight what Claude added in
 * the most recent turn.
 *
 * Watches `state.kind === "ready"` transitions. When the prior auto-
 * regen left a snapshot in `preRegenSnapshotRef`, diff it against the
 * fresh schema and flag whatever's new.
 *
 * The settle-effect also writes via `setRecentChanges` when card-
 * driven flows commit (no regen) — both writers share the state, but
 * only this hook owns the diff-on-ready effect.
 *
 * `recentChanges` is cleared by the caller (via setRecentChanges(null)
 * in dismissRecentEdit) on the next user action; per UX feedback the
 * glow persists until the user looks away.
 */
export function useRecentChanges({
  state,
  preRegenSnapshotRef,
}: {
  state: FetchState;
  preRegenSnapshotRef: MutableRefObject<PreRegenSnapshot | null>;
}): {
  recentChanges: RecentChanges | null;
  setRecentChanges: Dispatch<SetStateAction<RecentChanges | null>>;
} {
  const [recentChanges, setRecentChanges] = useState<RecentChanges | null>(
    null,
  );

  useEffect(() => {
    if (state.kind !== "ready") return;
    if (!preRegenSnapshotRef.current) return;
    const snap = preRegenSnapshotRef.current;
    preRegenSnapshotRef.current = null;
    const newBlockIds = new Set<string>();
    for (const b of state.schema.blocks) {
      if (b.pending) continue;
      if (!snap.blockIds.has(b.id)) newBlockIds.add(b.id);
    }
    const newArrowKeys = new Set<string>();
    for (const a of state.schema.arrows) {
      if (a.pending) continue;
      const key = `${a.from}->${a.to}`;
      if (!snap.arrowKeys.has(key)) newArrowKeys.add(key);
    }
    console.log("[recent-debug] diff effect fired", {
      snapBlockIds: Array.from(snap.blockIds),
      snapArrowKeys: Array.from(snap.arrowKeys),
      currentBlockIds: state.schema.blocks
        .filter((b) => !b.pending)
        .map((b) => b.id),
      currentArrowKeys: state.schema.arrows
        .filter((a) => !a.pending)
        .map((a) => `${a.from}->${a.to}`),
      newBlockIds: Array.from(newBlockIds),
      newArrowKeys: Array.from(newArrowKeys),
    });
    if (newBlockIds.size === 0 && newArrowKeys.size === 0) return;
    setRecentChanges({ blockIds: newBlockIds, arrowKeys: newArrowKeys });
    // No auto-dismiss. Per user feedback the "just edited" highlight
    // should persist until they take the NEXT action — that way they
    // can scan the diagram at leisure and see exactly what Claude
    // changed. dismissRecentEdit (in DiagramCanvasInner) wipes it on
    // any user mutation handler.
  }, [state, preRegenSnapshotRef]);

  return { recentChanges, setRecentChanges };
}

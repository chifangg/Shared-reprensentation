import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ClaudeMessage } from "@/core/hooks/useClaudeSession";
import type {
  ConnectionOption,
  DiagramArrow,
  EditTarget,
  FetchState,
} from "../types";
import { dlog } from "../util/debug";
import { blocksForFiles } from "../util/editedBlocks";
import { editedFilesInLatestTurn } from "../util/chatEdits";
import type { EditSummary } from "./useEditSummary";
import type { PreRegenSnapshot, RecentChanges } from "./useRecentChanges";

export type ChosenOption = {
  target: EditTarget;
  option: ConnectionOption;
};

/**
 * Owns the chatRunning false-edge "settle" effect — the most complex
 * single piece of the diagram state machine.
 *
 * Fires once each time chatRunning transitions from true → false (a
 * Claude turn just ended). Three logical branches:
 *
 *   1. **chosenOptionsRef non-empty, arrow targets** — round-2 of an
 *      arrow flow. For each chosen arrow option:
 *      - `block_level`: keep the arrow, apply its label, clear pending
 *      - `detail` / `none`: drop the arrow
 *      Plus settle any `pending="claude"` arrows ChatView produced via
 *      `added_arrows` JSON. No auto-regen — the user just set a label
 *      and a fresh fetch could relabel/rename the arrow surprisingly.
 *
 *   2. **chosenOptionsRef non-empty, block / new-block targets** —
 *      placeholder block becomes a real block with the chosen option's
 *      title + detail. No auto-regen — preserves the user's spatial
 *      memory of where existing blocks sit.
 *
 *   3. **chosenOptionsRef empty BUT a tool_use of
 *      `edit_project_file` / `write_project_file` landed this turn** —
 *      typed-chat edit. Snapshot the schema into `preRegenSnapshotRef`
 *      so the next "ready" transition can diff and glow what Claude
 *      added, then force a regen by setting state to idle + bumping
 *      retryNonce.
 *
 *   4. **Otherwise** — no-op chat reply. Do nothing.
 *
 * Always runs the edit-summary extraction: walks the just-finished
 * assistant turn for tool_use file paths + the trailing text (with
 * JSON fences stripped) and writes the toast via setEditSummary if
 * any files were touched.
 *
 * Always flushes `settledBlockIds` / `settledArrowKeys` into
 * recentChanges so the canvas paints them solid blue until the user's
 * next action.
 *
 * CRITICAL: the next-blocks / next-arrows / settled-sets computation
 * MUST happen synchronously, BEFORE any setState. Mutations inside a
 * setState updater run on the next render — the size check at the
 * bottom would silently see empty sets and skip setRecentChanges,
 * leaving the canvas grey even though something just settled.
 */
export function useChatSettleEffect({
  chatRunning,
  chatMessages,
  state,
  setState,
  chosenOptionsRef,
  preRegenSnapshotRef,
  preserveRegenRef,
  setRetryNonce,
  setRecentChanges,
  setEditSummary,
  setEditRegenIds,
}: {
  chatRunning: boolean;
  chatMessages: ClaudeMessage[];
  state: FetchState;
  setState: Dispatch<SetStateAction<FetchState>>;
  chosenOptionsRef: MutableRefObject<Map<string, ChosenOption>>;
  preRegenSnapshotRef: MutableRefObject<PreRegenSnapshot | null>;
  /** Flipped on here so the structure fetch keeps the old diagram up and
   *  swaps only when the rebuild is ready (no blank during the regen). */
  preserveRegenRef: MutableRefObject<{ active: boolean }>;
  setRetryNonce: Dispatch<SetStateAction<number>>;
  setRecentChanges: Dispatch<SetStateAction<RecentChanges | null>>;
  setEditSummary: Dispatch<SetStateAction<EditSummary | null>>;
  /** Blocks to pulse blue THROUGH the regen window (chat already ended,
   *  so the chatRunning-based pulse has cleared). Cleared on ready. */
  setEditRegenIds: Dispatch<SetStateAction<Set<string>>>;
}): void {
  const prevChatRunningRef = useRef(false);
  useEffect(() => {
    if (prevChatRunningRef.current && !chatRunning) {
      dlog("recent-debug:settle entry — schema snapshot", {
        stateKind: state.kind,
        arrows:
          state.kind === "ready"
            ? state.schema.arrows.map((a) => ({
                key: `${a.from}->${a.to}`,
                pending: a.pending ?? null,
              }))
            : null,
        blocks:
          state.kind === "ready"
            ? state.schema.blocks.map((b) => ({
                id: b.id,
                label: b.label,
                pending: b.pending ?? null,
              }))
            : null,
      });
      const chosen = chosenOptionsRef.current;
      // Only ARROW-kind targets need per-arrow outcome handling here;
      // block / new-block just want a fresh regen, same as a typed
      // chat edit. So narrow `chosen` to its arrow entries first.
      const arrowEntries = Array.from(chosen.values()).filter(
        (entry) => entry.target.kind === "arrow",
      );
      const blockOrNewBlockEntries = Array.from(chosen.values()).filter(
        (entry) => entry.target.kind !== "arrow",
      );
      const hadArrowExecute = arrowEntries.length > 0;
      const hadBlockOrNewBlockExecute = blockOrNewBlockEntries.length > 0;

      // Walk the just-finished assistant turn ONCE for the file paths it
      // edited + its trailing prose. Drives three things below: the regen
      // decision, the "what changed" toast, and the set of blocks to glow
      // (the block that owns an edited file, even on an in-place edit).
      const { files: editedFileList, textChunks } =
        editedFilesInLatestTurn(chatMessages);
      const editedFiles = new Set(editedFileList);
      const editedBlockIds =
        state.kind === "ready"
          ? blocksForFiles(state.schema.blocks, editedFiles)
          : new Set<string>();

      // Collect IDs / arrow keys of EVERYTHING that just settled in
      // this transition so we can flag them in recentChanges (solid
      // blue until the user takes their next action).
      //
      // CRITICAL: we compute the next blocks / arrows + settled sets
      // SYNCHRONOUSLY here, before any setState. Side-effect mutations
      // inside a setState updater callback do not run until the next
      // render — so the size check at the bottom would silently see
      // an empty set and skip setRecentChanges, leaving the canvas
      // grey even though we just settled stuff.
      const settledBlockIds = new Set<string>();
      const settledArrowKeys = new Set<string>();
      // User-drawn arrows that got dropped this turn because the chosen
      // outcome was NOT a block-level relationship. Surfaced as a toast
      // note so the line doesn't just silently vanish.
      const droppedUserArrows: Array<{ from: string; to: string }> = [];
      let nextBlocks =
        state.kind === "ready" ? state.schema.blocks : null;
      let nextArrows =
        state.kind === "ready" ? state.schema.arrows : null;
      let schemaChanged = false;

      if (state.kind === "ready") {
        if (hadArrowExecute) {
          const arrowOptionByKey = new Map<string, ConnectionOption>();
          for (const entry of arrowEntries) {
            if (entry.target.kind !== "arrow") continue;
            arrowOptionByKey.set(
              `${entry.target.from}->${entry.target.to}`,
              entry.option,
            );
          }
          const built: DiagramArrow[] = [];
          for (const a of state.schema.arrows) {
            const key = `${a.from}->${a.to}`;
            const opt = arrowOptionByKey.get(key);
            if (!opt) {
              // No chosen-option for this arrow — either long-settled
              // (no-op) or a Claude-added arrow from ARROWS_ADDED_EVENT
              // (still pending="claude"). Settle the latter and flag.
              if (a.pending === "claude") {
                settledArrowKeys.add(key);
                built.push({ ...a, pending: undefined });
              } else {
                built.push(a);
              }
              continue;
            }
            if (opt.kind === "block_level") {
              settledArrowKeys.add(key);
              built.push({
                ...a,
                label: opt.label?.trim() || "uses",
                pending: undefined,
              });
            } else if (a.pending) {
              // detail / none on a user-drawn arrow: the edit ran but no
              // block-level relationship resulted, so the arrow drops.
              // Record it so we can TELL the user rather than silently
              // removing their line.
              droppedUserArrows.push({ from: a.from, to: a.to });
            }
            // (a settled non-pending detail/none arrow drops silently)
          }
          nextArrows = built;
          schemaChanged = true;
          chosen.clear();
        } else {
          // No user-chosen-option this turn, but Claude may still have
          // added arrows via ARROWS_ADDED_EVENT (pending="claude").
          // Settle them so the marching-ants stops AND flag them.
          const hasClaudePending = state.schema.arrows.some(
            (a) => a.pending === "claude",
          );
          if (hasClaudePending) {
            nextArrows = state.schema.arrows.map((a) => {
              if (a.pending !== "claude") return a;
              settledArrowKeys.add(`${a.from}->${a.to}`);
              return { ...a, pending: undefined };
            });
            schemaChanged = true;
          }
        }

        // Card-driven flows (block / new-block) — settle locally, NO
        // regen. The user already knows what they asked for; a full
        // wipe + re-layout would lose their spatial memory of where
        // existing blocks sit. For new-block specifically: update the
        // placeholder so it shows the chosen module title instead of
        // staying as "New module…".
        if (hadBlockOrNewBlockExecute) {
          const newBlockOptions = blockOrNewBlockEntries
            .filter((e) => e.target.kind === "new-block")
            .map((e) => e.option);
          if (newBlockOptions.length > 0) {
            // Walk placeholder blocks (FIFO) and bind each to one
            // chosen option in order. If user fired multiple new-block
            // flows back-to-back this matches them positionally.
            let optIdx = 0;
            nextBlocks = state.schema.blocks.map((b) => {
              if (!b.pending || !b.id.startsWith("__pending_new_")) return b;
              const opt = newBlockOptions[optIdx];
              if (!opt) return b;
              settledBlockIds.add(b.id);
              optIdx++;
              return {
                ...b,
                label: opt.title.slice(0, 40),
                caption:
                  opt.detail.slice(0, 200) || "Just created by Claude.",
                pending: undefined,
              };
            });
            schemaChanged = true;
          }
          chosen.clear();
        }
      }

      if (schemaChanged && nextBlocks && nextArrows) {
        setState({
          kind: "ready",
          schema: { blocks: nextBlocks, arrows: nextArrows },
        });
      }

      // Auto-regen ONLY for typed-chat turns that edited files. Skip
      // when the turn was a card-driven (arrow / block / new-block)
      // execute — those already settled their target locally above
      // and regen would destroy the rest of the user's spatial layout.
      const shouldRegen =
        !hadArrowExecute &&
        !hadBlockOrNewBlockExecute &&
        editedFiles.size > 0;
      dlog("recent-debug:shouldRegen", {
        hadArrowExecute,
        hadBlockOrNewBlockExecute,
        shouldRegen,
        editedFiles: Array.from(editedFiles),
        editedBlockIds: Array.from(editedBlockIds),
      });
      if (shouldRegen) {
        chosen.clear();
        // Snapshot what's currently on screen so the next "ready"
        // transition can diff against it and glow whatever Claude
        // added during this turn. editedBlockIds is carried so blocks
        // edited IN PLACE (no new id) still glow after the regen.
        if (state.kind === "ready") {
          preRegenSnapshotRef.current = {
            blockIds: new Set(
              state.schema.blocks
                .filter((b) => !b.pending)
                .map((b) => b.id),
            ),
            arrowKeys: new Set(
              state.schema.arrows
                .filter((a) => !a.pending)
                .map((a) => `${a.from}->${a.to}`),
            ),
            editedBlockIds: new Set(editedBlockIds),
          };
        }
        // Keep the old diagram visible through the rebuild and pulse the
        // edited block(s) the whole time (the chatRunning-based pulse has
        // already cleared since the turn ended).
        preserveRegenRef.current.active = true;
        setEditRegenIds(new Set(editedBlockIds));
        setState({ kind: "idle" });
        setRetryNonce((n) => n + 1);
      }

      // No-regen paths (card-driven execute): glow the edited block(s)
      // right away so an in-place code change is still visible. For the
      // regen path the snapshot above carries them instead.
      if (!shouldRegen) {
        for (const id of editedBlockIds) settledBlockIds.add(id);
      }

      // If a user-drawn arrow was dropped (no block-level relationship),
      // build a plain-language note naming the two blocks so the user
      // understands the edit ran but the link wasn't kept.
      let droppedNote: string | undefined;
      if (droppedUserArrows.length > 0 && state.kind === "ready") {
        const labelOf = (id: string) =>
          state.schema.blocks.find((b) => b.id === id)?.label ?? id;
        const { from, to } = droppedUserArrows[0];
        const more =
          droppedUserArrows.length > 1
            ? ` (and ${droppedUserArrows.length - 1} more)`
            : "";
        droppedNote = `Edit applied, but no direct link between "${labelOf(
          from,
        )}" and "${labelOf(to)}" resulted, so that connection was not kept${more}.`;
      }

      // Build the edit-summary toast from the precomputed edit paths +
      // trailing prose (JSON fences stripped) so the user gets a quick
      // "here's what just changed" without scrolling the chat. Fires when
      // files changed OR a user connection was dropped (so the note shows).
      if (editedFiles.size > 0 || droppedNote) {
        const fullText = textChunks.join("\n");
        const stripped = fullText
          .replace(/```(?:json)?\s*\n[\s\S]*?\n```/g, "")
          .trim();
        const firstParagraph = stripped.split(/\n\n+/)[0] ?? "";
        setEditSummary({
          files: Array.from(editedFiles),
          text:
            firstParagraph.length > 220
              ? `${firstParagraph.slice(0, 217)}…`
              : firstParagraph,
          note: droppedNote,
        });
      }

      // Flush everything that just settled into recentChanges so the
      // canvas paints them solid blue until the user's next action.
      // Skipped when nothing settled (e.g. a no-op chat reply).
      dlog("recent-debug:settle effect", {
        hadArrowExecute,
        hadBlockOrNewBlockExecute,
        shouldRegen,
        settledBlockIds: Array.from(settledBlockIds),
        settledArrowKeys: Array.from(settledArrowKeys),
      });
      if (settledBlockIds.size > 0 || settledArrowKeys.size > 0) {
        setRecentChanges({
          blockIds: settledBlockIds,
          arrowKeys: settledArrowKeys,
        });
      }
    }
    prevChatRunningRef.current = chatRunning;
    // chatMessages is read inside; including it as a dep means the
    // effect runs more often than strictly necessary, but the
    // transition guard above keeps it idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRunning, chatMessages]);
}

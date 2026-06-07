import { useEffect, useState } from "react";
import type { ClaudeMessage } from "@/core/hooks/useClaudeSession";
import type { DiagramBlock } from "../types";
import { blocksForFiles } from "../util/editedBlocks";
import { editedFilesInLatestTurn } from "../util/chatEdits";

/**
 * While a Claude turn is running, returns the ids of blocks whose files
 * Claude has edited SO FAR this turn, so the canvas can pulse them blue
 * ("editing in progress"). Clears the instant the turn ends; the settle
 * effect then takes over with the persistent post-edit glow.
 *
 * Reads the streaming assistant message live (walking back to the last
 * user turn), so a block lights up the moment its file is touched rather
 * than only after the whole turn settles.
 */
export function useEditingBlocks({
  chatRunning,
  chatMessages,
  blocks,
}: {
  chatRunning: boolean;
  chatMessages: ClaudeMessage[];
  blocks: DiagramBlock[];
}): Set<string> {
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!chatRunning) {
      setEditingIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const { files } = editedFilesInLatestTurn(chatMessages);
    const next = blocksForFiles(blocks, files);
    setEditingIds((prev) => (sameSet(prev, next) ? prev : next));
  }, [chatRunning, chatMessages, blocks]);

  return editingIds;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

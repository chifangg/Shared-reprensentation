import { useState, type Dispatch, type SetStateAction } from "react";

export type EditSummary = {
  files: string[];
  text: string;
};

/**
 * Owns the `editSummary` toast state.
 *
 * The actual extraction happens inside `useChatSettleEffect` (which
 * walks the just-finished assistant turn for `edit/write_project_file`
 * tool_use blocks + the trailing text) — this hook just owns the
 * state slot and the setter so the caller can dismiss it on the next
 * user action.
 *
 * Splitting the state declaration into its own hook keeps the
 * settle-effect's input list short and makes the editSummary surface
 * easy to find when refactoring the toast UI later.
 */
export function useEditSummary(): {
  editSummary: EditSummary | null;
  setEditSummary: Dispatch<SetStateAction<EditSummary | null>>;
} {
  const [editSummary, setEditSummary] = useState<EditSummary | null>(null);
  return { editSummary, setEditSummary };
}

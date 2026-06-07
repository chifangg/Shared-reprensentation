import type { ClaudeMessage } from "@/core/hooks/useClaudeSession";

/**
 * Walk the most recent assistant turn for the files it edited.
 *
 * Subtlety that bit us: tool calls come back as `user`-typed
 * `tool_result` messages interleaved between the assistant's tool_use
 * messages. A naive "stop at the first user message" walk therefore
 * breaks at the LAST tool_result (just before Claude's closing summary)
 * and sees none of the edits. We must skip tool_result messages and
 * stop only at the real human prompt (string content, or an array with
 * no tool_result block).
 */

type AnyMsg = { type?: string; message?: { content?: unknown } };

function isUserPrompt(m: AnyMsg): boolean {
  if (m.type !== "user") return false;
  const c = m.message?.content;
  if (typeof c === "string") return true;
  if (Array.isArray(c)) {
    return !c.some((b) => (b as { type?: string })?.type === "tool_result");
  }
  return true;
}

/**
 * Edited/written file paths in the latest assistant turn, plus its text
 * chunks (oldest first) for the edit-summary toast. Walks back to the
 * last human prompt, skipping interleaved tool_result messages.
 */
export function editedFilesInLatestTurn(messages: ClaudeMessage[]): {
  files: string[];
  textChunks: string[];
} {
  const files = new Set<string>();
  const textChunks: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AnyMsg;
    if (isUserPrompt(m)) break;
    if (m.type !== "assistant") continue;
    const content = m.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<{
      type?: string;
      name?: string;
      input?: { path?: string };
      text?: string;
    }>) {
      if (
        b?.type === "tool_use" &&
        (b.name === "edit_project_file" || b.name === "write_project_file") &&
        typeof b.input?.path === "string"
      ) {
        files.add(b.input.path);
      } else if (b?.type === "text" && typeof b.text === "string") {
        textChunks.unshift(b.text);
      }
    }
  }
  return { files: Array.from(files), textChunks };
}

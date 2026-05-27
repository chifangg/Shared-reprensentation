/**
 * Compact the last few turns of chat history into a short transcript
 * string the `/api/diagram` view=focus endpoint can use to decide which
 * blocks the conversation is currently about.
 *
 * Only `type: "user"` text and assistant-text content blocks contribute;
 * tool-use / thinking / tool-result blocks are dropped. The last
 * `maxTurns * 2` turns are retained, so a default `maxTurns=3` keeps
 * the last six user+assistant turns combined.
 *
 * Pure function over the raw stream-json shape — no React, no IO. The
 * loose `(m as { type?: string })` access mirrors the loose
 * `ClaudeMessage = { [key: string]: unknown }` shape from
 * useClaudeSession; a stricter type-guard helper could replace this if
 * we ever want to surface the same context in multiple places.
 */

import type { ClaudeMessage } from "@/core/hooks/useClaudeSession";

export function buildChatContext(
  msgs: ClaudeMessage[],
  maxTurns = 3,
): string {
  type Turn = { role: "user" | "assistant"; text: string };
  const turns: Turn[] = [];
  for (const m of msgs) {
    const t = (m as { type?: string }).type;
    const inner = (m as { message?: { content?: unknown } }).message?.content;
    if (t === "user") {
      if (typeof inner === "string") {
        turns.push({ role: "user", text: inner });
      }
    } else if (t === "assistant" && Array.isArray(inner)) {
      const text = (inner as { type?: string; text?: string }[])
        .filter((b) => b?.type === "text" && typeof b?.text === "string")
        .map((b) => b.text)
        .join(" ");
      if (text.trim()) turns.push({ role: "assistant", text });
    }
  }
  const recent = turns.slice(-maxTurns * 2);
  return recent
    .map((t) => `${t.role.toUpperCase()}: ${t.text}`)
    .join("\n\n");
}

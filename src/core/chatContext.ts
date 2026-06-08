/**
 * Chat context attachments: the generic mechanism for dragging an item
 * into the chat panel as context for the next message.
 *
 * Core stays feature-agnostic: it knows only the `ChatContextItem` shape
 * (a label, a sublabel, an accent color, and a pre-serialized line for
 * the model). The diagram feature is what produces items from blocks /
 * capabilities / connections; core just renders the chips, accepts the
 * drop, serializes attached items into the prompt, and parses them back
 * out for the transcript. Nothing here imports the diagram.
 */

export type ChatContextKind = "block" | "capability" | "link";

export const CONTEXT_KIND_LABEL: Record<ChatContextKind, string> = {
  block: "BLOCK",
  capability: "CAPABILITY",
  link: "LINK",
};

export type ChatContextItem = {
  /** Stable id so the same element can't be attached twice. */
  id: string;
  kind: ChatContextKind;
  /** Main line, e.g. "Chat Log Scraper". */
  label: string;
  /** Second line, e.g. "3 files, 4 capabilities". */
  sublabel?: string;
  /** Hex accent for the chip's left bar + tag. */
  accent: string;
  /** Model-facing line (without a leading bullet), e.g.
   *  `BLOCK "Chat Log Scraper": ... | files: ...`. */
  serialized: string;
};

const OPEN = "<attached_context>";
const CLOSE = "</attached_context>";

/** Fold attached items into the prompt as a structured context block. */
export function appendContextToPrompt(
  text: string,
  items: ChatContextItem[],
): string {
  if (items.length === 0) return text;
  const body = items.map((i) => `- ${i.serialized}`).join("\n");
  return `${text}\n\n${OPEN}\n${body}\n${CLOSE}`;
}

export type DisplayContextItem = {
  kind: ChatContextKind;
  label: string;
  accent: string;
};

/** Default chip accent per kind, for the transcript (where we only have
 *  the serialized lines, not the original element's category color). */
const KIND_ACCENT: Record<ChatContextKind, string> = {
  block: "#64748B",
  capability: "#B8995A",
  link: "#8C8AA3",
};

/**
 * Split a stored user message into its visible text and the attached
 * context (parsed back into light chips), so the transcript shows what
 * was attached without dumping the raw serialized block.
 */
export function extractAttachedContext(text: string): {
  text: string;
  items: DisplayContextItem[];
} {
  const start = text.indexOf(OPEN);
  const end = text.indexOf(CLOSE);
  if (start === -1 || end === -1 || end < start) return { text, items: [] };
  const block = text.slice(start + OPEN.length, end);
  const clean = (text.slice(0, start) + text.slice(end + CLOSE.length)).trim();
  const items: DisplayContextItem[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.replace(/^\s*-\s*/, "").trim();
    if (!line) continue;
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (line.startsWith("BLOCK") && quoted[0]) {
      items.push({ kind: "block", label: quoted[0], accent: KIND_ACCENT.block });
    } else if (line.startsWith("CAPABILITY") && quoted[0]) {
      items.push({
        kind: "capability",
        label: quoted[0],
        accent: KIND_ACCENT.capability,
      });
    } else if (line.startsWith("LINK") && quoted.length >= 2) {
      items.push({
        kind: "link",
        label: `${quoted[0]} → ${quoted[1]}`,
        accent: KIND_ACCENT.link,
      });
    }
  }
  return { text: clean, items };
}

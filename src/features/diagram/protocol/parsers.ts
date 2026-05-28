/**
 * JSON-tail parsers for the chat ↔ diagram protocol.
 *
 * Claude's assistant turns embed structured tails as fenced JSON code
 * blocks. We scan all blocks (not just the first) so a single turn
 * can mix prose + an `options` block + an `added_arrows` block.
 *
 * Lenient on surrounding prose, strict on schema — anything that
 * doesn't shape-match drops silently so a malformed payload can't
 * crash the chat render.
 *
 * Pure functions, no React. Imported by ChatView's inline sinks
 * (ArrowsAddedSink, OptionsHandoff) and would also be useful to test
 * in isolation once a unit-test setup lands.
 */

import type { ConnectionOption } from "../types";

/**
 * Yield each ```json fenced body in a text block, in order. We scan
 * ALL of them (not just the first) so an assistant turn can emit a
 * text summary + an added_arrows JSON + an options JSON, etc.
 */
export function allJsonBlocks(text: string): string[] {
  const re = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/**
 * Strip ALL ```json fenced code blocks from a text. Used when an
 * assistant text block carries structured JSON tails (options /
 * added_arrows) that we surface separately as cards / arrows; the
 * markdown-rendered remainder should only show the human-readable
 * prose.
 */
export function stripJsonCodeBlocks(text: string): string {
  return text.replace(/```(?:json)?\s*\n[\s\S]*?\n```/g, "").trim();
}

/**
 * Find a JSON code block shaped like `{ "options": [...] }` in an
 * assistant text response. Returns the validated option list, or null
 * if the body doesn't fit the schema (parse error, missing fields,
 * unknown kind).
 */
export function parseOptionsBlock(
  text: string,
): { options: ConnectionOption[] } | null {
  for (const body of allJsonBlocks(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const rawOpts = (parsed as { options?: unknown }).options;
    if (!Array.isArray(rawOpts)) continue;
    const options: ConnectionOption[] = [];
    for (const o of rawOpts) {
      if (!o || typeof o !== "object") continue;
      const obj = o as Record<string, unknown>;
      if (typeof obj.title !== "string") continue;
      if (typeof obj.detail !== "string") continue;
      if (
        obj.kind !== "block_level" &&
        obj.kind !== "detail" &&
        obj.kind !== "none"
      )
        continue;
      options.push({
        title: obj.title,
        detail: obj.detail,
        kind: obj.kind,
        label: typeof obj.label === "string" ? obj.label : undefined,
      });
    }
    if (options.length > 0) return { options };
  }
  return null;
}

/**
 * Find a JSON code block shaped like `{ "added_arrows": [...] }` in
 * an assistant text response. Returns the validated arrow list, or
 * null if no block matches the schema.
 */
export function parseAddedArrowsBlock(
  text: string,
): { arrows: Array<{ from: string; to: string; label: string }> } | null {
  for (const body of allJsonBlocks(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const raw = (parsed as { added_arrows?: unknown }).added_arrows;
    if (!Array.isArray(raw)) continue;
    const arrows: Array<{ from: string; to: string; label: string }> = [];
    for (const a of raw) {
      if (!a || typeof a !== "object") continue;
      const obj = a as Record<string, unknown>;
      if (typeof obj.from !== "string") continue;
      if (typeof obj.to !== "string") continue;
      arrows.push({
        from: obj.from,
        to: obj.to,
        label: typeof obj.label === "string" ? obj.label : "uses",
      });
    }
    if (arrows.length > 0) return { arrows };
  }
  return null;
}

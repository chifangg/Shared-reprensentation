/**
 * Sentinel-marker grammar for the chat ↔ diagram protocol.
 *
 * Two layers of markers are embedded inside user-side prompts:
 *
 *   1. The OUTER sentinel on line 1 ("<<diagram-edit summary=...>>")
 *      tells the chat renderer to collapse this user message into a
 *      compact "diagram edit" bubble with a "see prompt" expander —
 *      Claude reads the body normally; the marker line is ignored.
 *
 *   2. The INNER target sentinel on line 2 (e.g. "<<arrow from=X to=Y>>")
 *      carries machine-readable metadata about which diagram element
 *      this round is editing. The chat renderer extracts it via
 *      parseTargetMetadata so cards rendered later in the same turn
 *      know which target to fire OPTION_EXECUTED_EVENT for.
 *
 * Both markers are designed so Claude ignores them gracefully — they
 * look like XML-ish noise and the prompt body explains the actual task.
 *
 * Pure module: no React, no runtime side effects, safe to import from
 * either side of the chat ↔ diagram seam.
 */

import type { EditTarget } from "../types";

// ---------------------------------------------------------------------------
// Outer sentinel — wraps the visual-edit summary on line 1.
// ---------------------------------------------------------------------------

/**
 * Marker on the FIRST line of a visual-edit prompt. The chat renderer
 * detects this prefix, extracts the human-readable summary, and shows
 * a compact bubble instead of dumping the full structured prompt body
 * (which is for Claude's eyes, not the user's). Claude itself ignores
 * the marker line — it just reads the rest of the prompt as context.
 */
export const VISUAL_EDIT_SENTINEL_PREFIX = "<<diagram-edit summary=\"";
export const VISUAL_EDIT_SENTINEL_SUFFIX = "\">>";

// ---------------------------------------------------------------------------
// Inner target sentinel — carries the EditTarget kind/identity on line 2.
// ---------------------------------------------------------------------------

export const VISUAL_EDIT_ARROW_PREFIX = "<<arrow from=\"";
export const VISUAL_EDIT_ARROW_MID = "\" to=\"";
export const VISUAL_EDIT_ARROW_SUFFIX = "\">>";

export const VISUAL_EDIT_BLOCK_PREFIX = "<<block id=\"";
export const VISUAL_EDIT_BLOCK_SUFFIX = "\">>";

export const VISUAL_EDIT_NEW_BLOCK = "<<new-block>>";

export function buildTargetSentinel(t: EditTarget): string {
  switch (t.kind) {
    case "arrow":
      return `${VISUAL_EDIT_ARROW_PREFIX}${t.from}${VISUAL_EDIT_ARROW_MID}${t.to}${VISUAL_EDIT_ARROW_SUFFIX}`;
    case "block":
      return `${VISUAL_EDIT_BLOCK_PREFIX}${t.id}${VISUAL_EDIT_BLOCK_SUFFIX}`;
    case "new-block":
      return VISUAL_EDIT_NEW_BLOCK;
  }
}

export function parseTargetMetadata(text: string): EditTarget | null {
  for (const line of text.split("\n").slice(0, 5)) {
    if (line.startsWith(VISUAL_EDIT_ARROW_PREFIX)) {
      const after = line.slice(VISUAL_EDIT_ARROW_PREFIX.length);
      const mid = after.indexOf(VISUAL_EDIT_ARROW_MID);
      if (mid === -1) continue;
      const from = after.slice(0, mid);
      const rest = after.slice(mid + VISUAL_EDIT_ARROW_MID.length);
      if (!rest.endsWith(VISUAL_EDIT_ARROW_SUFFIX)) continue;
      const to = rest.slice(0, rest.length - VISUAL_EDIT_ARROW_SUFFIX.length);
      return { kind: "arrow", from, to };
    }
    if (line.startsWith(VISUAL_EDIT_BLOCK_PREFIX)) {
      const after = line.slice(VISUAL_EDIT_BLOCK_PREFIX.length);
      if (!after.endsWith(VISUAL_EDIT_BLOCK_SUFFIX)) continue;
      const id = after.slice(0, after.length - VISUAL_EDIT_BLOCK_SUFFIX.length);
      return { kind: "block", id };
    }
    if (line === VISUAL_EDIT_NEW_BLOCK) {
      return { kind: "new-block" };
    }
  }
  return null;
}

/**
 * Parse a user message; if it begins with the visual-edit sentinel,
 * return the summary and the body (everything after the sentinel line)
 * separately so the chat can render them as a compact + expandable
 * pair. Returns null for ordinary typed user messages.
 */
export function parseVisualEditMessage(
  text: string,
): { summary: string; body: string } | null {
  if (!text.startsWith(VISUAL_EDIT_SENTINEL_PREFIX)) return null;
  const nl = text.indexOf("\n");
  const firstLine = nl === -1 ? text : text.slice(0, nl);
  if (!firstLine.endsWith(VISUAL_EDIT_SENTINEL_SUFFIX)) return null;
  const summary = firstLine.slice(
    VISUAL_EDIT_SENTINEL_PREFIX.length,
    firstLine.length - VISUAL_EDIT_SENTINEL_SUFFIX.length,
  );
  let body = nl === -1 ? "" : text.slice(nl + 1).replace(/^\n+/, "");
  // Strip the optional arrow-metadata sentinel from the body so it
  // doesn't show up in the chat "see prompt" preview as gibberish —
  // it's meant for machine consumption only.
  if (body.startsWith(VISUAL_EDIT_ARROW_PREFIX)) {
    const nl2 = body.indexOf("\n");
    if (nl2 !== -1) body = body.slice(nl2 + 1).replace(/^\n+/, "");
    else body = "";
  }
  return { summary, body };
}

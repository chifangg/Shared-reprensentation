/**
 * Streaming POST to /api/diagram with view=color_scheme.
 *
 * Asks the backend to design ONE color encoding for the existing diagram:
 * it groups the given blocks, names the grouping, and assigns every block
 * to a group. The model picks the grouping; the frontend paints each
 * group from a fixed palette (see color/scheme.ts colorSchemeFromAI), so
 * a generated scheme is always legible.
 *
 * Two modes, both through this one call:
 *  - "describe your own": `instruction` carries the user's grouping ask
 *    (e.g. "by data flow stage"); the backend wraps it as
 *    <encoding_request>.
 *  - "ask AI": `instruction` empty; the backend picks the most insightful
 *    encoding for the project on its own.
 *
 * The backend emits a single `scheme` NDJSON line then `done`. Unlike the
 * other diagram fetches (which accumulate many events), this resolves to
 * the one scheme payload.
 */

import type { AISchemePayload } from "../color/scheme";
import type { DiagramBlock } from "../types";
import { dlog } from "../util/debug";

/** Compact, color-scheme-relevant digest of the blocks. The grouping
 *  decision needs labels / captions / categories / capabilities, NOT the
 *  whole codebase, so this is far cheaper than buildProjectContext. */
export function buildColorSchemeContext(blocks: DiagramBlock[]): string {
  const lines = blocks.map((b) => {
    const caps = (b.capabilities ?? []).join("; ");
    return [
      `- id: ${b.id}`,
      `  label: ${b.label}`,
      b.category ? `  category: ${b.category}` : null,
      b.caption ? `  caption: ${b.caption}` : null,
      caps ? `  capabilities: ${caps}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return `<blocks>\n${lines.join("\n")}\n</blocks>`;
}

/** Runtime validation of the streamed `scheme` payload into the typed
 *  shape colorSchemeFromAI expects. Returns null on anything malformed. */
function parseSchemePayload(data: unknown): AISchemePayload | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.name !== "string" || !d.name.trim()) return null;
  if (!Array.isArray(d.groups) || !Array.isArray(d.assignments)) return null;

  const groups: AISchemePayload["groups"] = [];
  for (const g of d.groups) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") continue;
    groups.push({
      key: o.key,
      label: o.label,
      ...(typeof o.blurb === "string" ? { blurb: o.blurb } : {}),
    });
  }

  const assignments: AISchemePayload["assignments"] = [];
  for (const a of d.assignments) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    if (typeof o.block_id !== "string" || typeof o.group_key !== "string") {
      continue;
    }
    assignments.push({ block_id: o.block_id, group_key: o.group_key });
  }

  if (groups.length < 2 || assignments.length === 0) return null;
  return {
    name: d.name,
    description: typeof d.description === "string" ? d.description : undefined,
    groups,
    assignments,
  };
}

/**
 * Run the color_scheme view and resolve to the single scheme payload, or
 * throw on error / empty stream. `instruction` is the optional
 * describe-your-own grouping ask.
 */
export async function fetchColorScheme({
  blocksContext,
  instruction,
  signal,
}: {
  blocksContext: string;
  instruction: string | null;
  signal: AbortSignal;
}): Promise<AISchemePayload> {
  const resp = await fetch("/api/diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_context: blocksContext,
      view: "color_scheme",
      instruction: instruction ?? "",
    }),
    signal,
  });
  if (!resp.body) throw new Error("no response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let payload: AISchemePayload | null = null;
  let errorMessage: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const obj = raw as { kind?: unknown; data?: unknown; message?: unknown };
      dlog("diagram/color_scheme", obj);
      if (obj.kind === "scheme") {
        const parsed = parseSchemePayload(obj.data);
        if (parsed) payload = parsed;
      } else if (obj.kind === "error") {
        errorMessage =
          typeof obj.message === "string" ? obj.message : "stream error";
      }
    }
  }

  if (errorMessage) throw new Error(errorMessage);
  if (!payload) throw new Error("No usable color scheme was generated.");
  return payload;
}

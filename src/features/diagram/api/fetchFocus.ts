/**
 * Streaming POST to /api/diagram with view=focus.
 *
 * Owns the NDJSON parsing loop for the adaptive-focus delta fetch:
 * reads the response body line-by-line, parses each into a
 * `FocusStreamEvent`, and forwards to the caller's `onEvent`.
 *
 * The backend emits one JSON object per line: `focus` (the list of
 * focused base block ids), `detail_block` (a zoomed-in block to add
 * to the side panel), or `detail_arrow` (a connecting arrow within
 * the focused subgraph).
 */

import type { DiagramArrow, DiagramBlock } from "../types";
import { dlog } from "../util/debug";

export type FocusStreamEvent =
  | { kind: "focus"; ids: string[] }
  | { kind: "detail_block"; data: DiagramBlock }
  | { kind: "detail_arrow"; data: DiagramArrow };

/** Best-effort runtime validation of an NDJSON line into a typed event. */
function parseFocusLine(line: string): FocusStreamEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as {
    kind?: unknown;
    data?: unknown;
    ids?: unknown;
  };
  if (obj.kind === "focus" && Array.isArray(obj.ids)) {
    return {
      kind: "focus",
      ids: obj.ids.filter((id): id is string => typeof id === "string"),
    };
  }
  if (obj.kind === "detail_block" && obj.data) {
    return { kind: "detail_block", data: obj.data as DiagramBlock };
  }
  if (obj.kind === "detail_arrow" && obj.data) {
    return { kind: "detail_arrow", data: obj.data as DiagramArrow };
  }
  return null;
}

export async function fetchFocusStream({
  projectContext,
  chatContext,
  baseSchemaJson,
  signal,
  onEvent,
}: {
  projectContext: string;
  chatContext: string;
  baseSchemaJson: string;
  signal: AbortSignal;
  onEvent: (evt: FocusStreamEvent) => void;
}): Promise<void> {
  const resp = await fetch("/api/diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_context: projectContext,
      view: "focus",
      chat_context: chatContext,
      base_schema: baseSchemaJson,
    }),
    signal,
  });
  if (!resp.body) throw new Error("no response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const evt = parseFocusLine(line);
      if (!evt) continue;
      dlog("diagram/focus", evt);
      onEvent(evt);
    }
  }
}

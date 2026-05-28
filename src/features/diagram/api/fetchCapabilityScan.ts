/**
 * Streaming POST to /api/diagram with view=capability_scan.
 *
 * Lighter than fetchStructureStream: the backend emits only `capability`
 * tool calls (id + label + caption) and a terminal `done`. No arrows,
 * no provenance. Used by the onboarding survey to populate its picklist
 * for Edit / Reference verbs.
 *
 * Fires in PARALLEL with the survey modal opening — by the time the
 * user reaches the picklist step, the candidates are usually already in.
 */

import type { CapabilityCandidate } from "../types";
import { dlog } from "../util/debug";

export type CapabilityScanEvent =
  | { kind: "capability"; data: CapabilityCandidate }
  | { kind: "error"; message: string };

function parseCapabilityLine(line: string): CapabilityScanEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { kind?: unknown; data?: unknown; message?: unknown };
  if (obj.kind === "capability" && obj.data) {
    return { kind: "capability", data: obj.data as CapabilityCandidate };
  }
  if (obj.kind === "error") {
    return {
      kind: "error",
      message: typeof obj.message === "string" ? obj.message : "stream error",
    };
  }
  return null;
}

export async function fetchCapabilityScanStream({
  projectContext,
  signal,
  onEvent,
}: {
  projectContext: string;
  signal: AbortSignal;
  onEvent: (evt: CapabilityScanEvent) => void;
}): Promise<void> {
  const resp = await fetch("/api/diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_context: projectContext,
      view: "capability_scan",
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
      const evt = parseCapabilityLine(line);
      if (!evt) continue;
      dlog("diagram/capability_scan", evt);
      onEvent(evt);
    }
  }
}

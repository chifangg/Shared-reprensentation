/**
 * Client for `POST /api/connection-detail` (read-only).
 *
 * Given two blocks' source + the arrow verb, returns three "lenses" on
 * the relationship: realization (how it is wired, one sentence), uses
 * (packages / APIs it relies on), and hidden (seam details the block
 * captions omit). Any field may be absent or empty; the caller simply
 * does not render that lens.
 */

import type { ApiResponse } from "@/core/apiAdapter";
import type { FunctionDetailFile } from "./fetchFunctionDetail";

export type ConnectionDetailResult = {
  realization?: string;
  uses?: string[];
  hidden?: string[];
};

export async function describeConnection({
  fromLabel,
  toLabel,
  verb,
  fromCaption,
  toCaption,
  files,
}: {
  fromLabel: string;
  toLabel: string;
  verb: string;
  fromCaption: string;
  toCaption: string;
  files: FunctionDetailFile[];
}): Promise<ConnectionDetailResult> {
  const resp = await fetch("/api/connection-detail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from_label: fromLabel,
      to_label: toLabel,
      verb,
      from_caption: fromCaption,
      to_caption: toCaption,
      files,
    }),
  });
  const json = (await resp.json()) as ApiResponse<ConnectionDetailResult>;
  if (!json.success || !json.data) {
    throw new Error(json.error || "connection-detail request failed");
  }
  return json.data;
}

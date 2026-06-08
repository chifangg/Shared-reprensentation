/**
 * Client for `POST /api/block-refresh`.
 *
 * After a block-level edit (no full regen), re-derive that one block's
 * caption + capabilities from its current source so the drill-in bubbles
 * and description reflect what the user just changed. Either field may be
 * absent; the caller keeps the old value in that case.
 */

import type { ApiResponse } from "@/core/apiAdapter";
import type { FunctionDetailFile } from "./fetchFunctionDetail";

export type BlockRefreshResult = {
  caption?: string;
  capabilities?: string[];
};

export async function refreshBlock({
  label,
  caption,
  files,
}: {
  label: string;
  caption: string;
  files: FunctionDetailFile[];
}): Promise<BlockRefreshResult> {
  const resp = await fetch("/api/block-refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, caption, files }),
  });
  const json = (await resp.json()) as ApiResponse<BlockRefreshResult>;
  if (!json.success || !json.data) {
    throw new Error(json.error || "block-refresh request failed");
  }
  return json.data;
}

/**
 * Client for `POST /api/function-detail` (read-only).
 *
 * Two modes back the bubble drill-in edit card:
 *   - "describe": plain-language account of what a function does, read
 *     from its real source so the text never drifts from the code.
 *   - "preview": a plain-language restatement of what a requested change
 *     will do. The backend is told not to name files or identifiers, so
 *     the user confirms the capability change, not the code location.
 *
 * Both are one-shot JSON (not streamed), wrapped in the backend's
 * ApiResponse envelope.
 */

import type { ApiResponse } from "@/core/apiAdapter";

export type FunctionDetailFile = { path: string; content: string };

export type FunctionDescribeResult = {
  description: string;
  behaviors: string[];
};

export type FunctionPreviewResult = {
  summary: string;
};

async function postFunctionDetail<T>(body: unknown): Promise<T> {
  const resp = await fetch("/api/function-detail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await resp.json()) as ApiResponse<T>;
  if (!json.success || !json.data) {
    throw new Error(json.error || "function-detail request failed");
  }
  return json.data;
}

export function describeFunction({
  functionName,
  files,
}: {
  functionName: string;
  files: FunctionDetailFile[];
}): Promise<FunctionDescribeResult> {
  return postFunctionDetail<FunctionDescribeResult>({
    function_name: functionName,
    files,
    mode: "describe",
  });
}

export function previewFunctionChange({
  functionName,
  files,
  instruction,
}: {
  functionName: string;
  files: FunctionDetailFile[];
  instruction: string;
}): Promise<FunctionPreviewResult> {
  return postFunctionDetail<FunctionPreviewResult>({
    function_name: functionName,
    files,
    mode: "preview",
    instruction,
  });
}

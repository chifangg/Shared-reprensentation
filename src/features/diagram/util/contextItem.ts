import type { ChatContextItem } from "@/core/chatContext";
import type { BlockCategory } from "../types";
import { categoryStyle } from "./blockCategory";

/**
 * Build the `ChatContextItem` payloads that the diagram drag-sources hand
 * to the chat panel when a block / capability bubble / connection pill is
 * dragged in. Core stays diagram-agnostic; the per-kind color + the
 * model-facing serialization are decided here.
 */

const CAPABILITY_ACCENT = "#B8995A";
const LINK_ACCENT = "#8C8AA3";
const BLOCK_FALLBACK_ACCENT = "#64748B";

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function blockContextItem(data: {
  label: string;
  caption: string;
  files: string[];
  capabilities?: string[];
  category?: BlockCategory;
}): ChatContextItem {
  const accent = categoryStyle(data.category)?.accent ?? BLOCK_FALLBACK_ACCENT;
  const caps = data.capabilities ?? [];
  const fileCount = data.files.length;
  const sublabel = [
    fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "",
    caps.length > 0
      ? `${caps.length} capabilit${caps.length === 1 ? "y" : "ies"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const serialized =
    `BLOCK "${data.label}": ${truncate(data.caption, 100)}` +
    (fileCount > 0 ? ` | files: ${data.files.join(", ")}` : "") +
    (caps.length > 0 ? ` | capabilities: ${caps.join(", ")}` : "");
  return {
    id: `block:${data.label}`,
    kind: "block",
    label: data.label,
    sublabel: sublabel || undefined,
    accent,
    serialized,
  };
}

export function capabilityContextItem(
  capability: string,
  blockLabel: string,
): ChatContextItem {
  return {
    id: `capability:${blockLabel}/${capability}`,
    kind: "capability",
    label: capability,
    sublabel: `in ${blockLabel}`,
    accent: CAPABILITY_ACCENT,
    serialized: `CAPABILITY "${capability}" (in "${blockLabel}")`,
  };
}

export function linkContextItem(
  fromLabel: string,
  toLabel: string,
  verb: string,
): ChatContextItem {
  const v = verb.trim();
  return {
    id: `link:${fromLabel}->${toLabel}`,
    kind: "link",
    label: `${fromLabel} → ${toLabel}`,
    sublabel: v || undefined,
    accent: LINK_ACCENT,
    serialized: `LINK "${fromLabel}" -> "${toLabel}"${v ? ` (${v})` : ""}`,
  };
}

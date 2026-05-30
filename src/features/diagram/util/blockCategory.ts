import type { BlockCategory } from "../types";

/**
 * The closed category taxonomy the model assigns each block (see the
 * `category` enum in block_input_schema, backend/src/diagram/tools.rs)
 * and the muted, beige-anchored palette the canvas color-codes with.
 *
 * Palette goals (locked with the user):
 *   - Anchored to the warm cream the rest of the UI uses, so the tints
 *     read as a family rather than a rainbow.
 *   - Low chroma / mid lightness, no eye-searing saturated fills.
 *   - Distinct from the sand/gold bubble palette (#F3ECDD / #B8995A) so
 *     a tinted block never reads as a bubble.
 *
 * `tint` is the card background; `accent` is the left border + legend
 * swatch. Keep these six keys in lockstep with the backend enum.
 */
export const BLOCK_CATEGORIES: Record<
  BlockCategory,
  { label: string; tint: string; accent: string; blurb: string }
> = {
  interface: {
    label: "Interface",
    tint: "#F1E3DE",
    accent: "#B17F74",
    blurb: "Entry surfaces the user or other systems reach: UI screens, API endpoints, CLI commands.",
  },
  logic: {
    label: "Logic",
    tint: "#E4E8DB",
    accent: "#7F8A61",
    blurb: "Processing, engines, rules, business logic.",
  },
  data: {
    label: "Data",
    tint: "#DDE4E8",
    accent: "#67808C",
    blurb: "Stored data: models, schemas, persistence, files.",
  },
  integration: {
    label: "Integration",
    tint: "#E9DFE5",
    accent: "#90798A",
    blurb: "External services this project calls out to and third-party glue.",
  },
  config: {
    label: "Config",
    tint: "#EAE4DB",
    accent: "#978B77",
    blurb: "Setup, theming, build, infra, tooling.",
  },
  state: {
    label: "State",
    tint: "#DCE6E2",
    accent: "#6E897F",
    blurb: "Runtime app state: stores, session, in-memory caches.",
  },
};

/** Legend / iteration order, the rough reading-relevance order the
 *  model is told to emit in. */
export const CATEGORY_ORDER: BlockCategory[] = [
  "interface",
  "logic",
  "data",
  "state",
  "integration",
  "config",
];

/** Resolve the palette for a block's category, or null when the block
 *  has no (recognized) category so callers fall back to the neutral
 *  card style. */
export function categoryStyle(
  category: string | undefined,
): { label: string; tint: string; accent: string } | null {
  if (!category) return null;
  return BLOCK_CATEGORIES[category as BlockCategory] ?? null;
}

import type { BlockCategory } from "../types";

/**
 * The closed category taxonomy the model assigns each block (see the
 * `category` enum in block_input_schema, backend/src/diagram/tools.rs)
 * and the muted, beige-anchored palette the canvas color-codes with.
 *
 * Basis (see ~/Desktop/category_taxonomy.txt for the full write-up):
 * each block is a component classified on two axes, after the
 * architecture-recovery and style-classification literature. Axis 1 is
 * its position at the system boundary (interface = inbound edge,
 * integration = outbound edge, else internal). Axis 2 is what an
 * internal component manages, using Garlan and Shaw's distinction of
 * whether it retains state across calls and whether that state is shared
 * (logic = stateless, state = transient runtime state, data = persistent
 * or shared). config is the residual for elements off the runtime path.
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
    blurb: "Inbound edge where the outside reaches in: UI screens, API endpoints, CLI commands.",
  },
  logic: {
    label: "Logic",
    tint: "#E4E8DB",
    accent: "#7F8A61",
    blurb: "Internal processing that keeps no state: engines, rules, transforms, business logic.",
  },
  data: {
    label: "Data",
    tint: "#DDE4E8",
    accent: "#67808C",
    blurb: "Persistent or shared data: models, schemas, databases, files.",
  },
  integration: {
    label: "Integration",
    tint: "#E9DFE5",
    accent: "#90798A",
    blurb: "Outbound edge: external services this project calls out to, third-party clients.",
  },
  config: {
    label: "Config",
    tint: "#EAE4DB",
    accent: "#978B77",
    blurb: "Off the runtime path: setup, build, theming, infra, tooling.",
  },
  state: {
    label: "State",
    tint: "#DCE6E2",
    accent: "#6E897F",
    blurb: "Runtime state held across calls but not persisted: stores, session, caches.",
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

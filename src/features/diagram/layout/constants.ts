/**
 * Layout-time magic numbers shared across the dagre pass and the
 * components that render its output (BlockNode dimensions, focus
 * panel min/max width, arrow-cluster proximity threshold).
 *
 * These are tuned for the current UI density; moving them in lockstep
 * across the layout pass and the renderers prevents subtle misalignment
 * (e.g. dagre reserving 220px columns while BlockNode renders 200px
 * cards would shift every arrow midpoint).
 */

/** Width reserved per block by dagre + width applied to each BlockNode card. */
export const NODE_W = 220;

/** Base height reserved per block (selected blocks override via estimateExpandedHeight). */
export const NODE_H = 90;

/** Min / max width of the adaptive-focus side panel; clamped while the user drags the handle. */
export const PANEL_MIN = 280;
export const PANEL_MAX = 720;

/**
 * Arrow-midpoint proximity threshold for label-cluster merging. Arrows
 * whose midpoints fall within this many pixels (both x AND y) are
 * treated as visually overlapping and have their labels merged into
 * one (e.g. "imports / fetches / subscribes") to avoid stacked pills.
 */
export const PROX = 100;

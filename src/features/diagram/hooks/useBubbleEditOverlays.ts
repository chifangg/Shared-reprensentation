import { useCallback, useEffect, useState } from "react";
import type { Node } from "@xyflow/react";

/**
 * State machine behind the two bubble-drill-in editors: the per-function
 * capability detail card and the per-surface appearance card.
 *
 * Extracted from DiagramCanvas so that orchestrator does not carry this
 * feature's state, click-routing, and reset inline (it was already past
 * a thousand lines). The actual code-writing dispatch stays in
 * DiagramCanvas, which owns the bus and clearBubbles; this hook only
 * tracks which editor is open and opens the right one from a bubble click.
 */

export type BubbleDetailTarget = {
  functionName: string;
  displayLabel: string;
  blockId: string;
  x: number;
  y: number;
};

export type BubbleAppearanceTarget = { blockId: string };

export function useBubbleEditOverlays(projectKey: number) {
  const [detail, setDetail] = useState<BubbleDetailTarget | null>(null);
  const [appearance, setAppearance] = useState<BubbleAppearanceTarget | null>(
    null,
  );

  // Close both editors on a USER-initiated project change.
  useEffect(() => {
    setDetail(null);
    setAppearance(null);
  }, [projectKey]);

  /** Route a click on a bubble node to the right editor. Appearance
   *  bubbles open the restyle card; every other bubble is a function and
   *  opens the capability detail card anchored at the click point. */
  const openFromBubble = useCallback((node: Node, evt: React.MouseEvent) => {
    const d = node.data as {
      kind?: "function" | "appearance";
      label?: string;
      displayLabel?: string;
      parentBlockId?: string;
    };
    if (!d.parentBlockId) return;
    if (d.kind === "appearance") {
      setAppearance({ blockId: d.parentBlockId });
      return;
    }
    if (!d.label) return;
    setDetail({
      functionName: d.label,
      displayLabel: d.displayLabel ?? d.label,
      blockId: d.parentBlockId,
      x: evt.clientX,
      y: evt.clientY,
    });
  }, []);

  const closeDetail = useCallback(() => setDetail(null), []);
  const closeAppearance = useCallback(() => setAppearance(null), []);

  return {
    detail,
    appearance,
    openFromBubble,
    closeDetail,
    closeAppearance,
  };
}

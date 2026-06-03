import { useCallback, useEffect, useState } from "react";
import type { Node } from "@xyflow/react";

/**
 * State machine behind the bubble-drill-in capability detail card.
 *
 * Extracted from DiagramCanvas so that orchestrator does not carry this
 * feature's state, click-routing, and reset inline (it was already past
 * a thousand lines). The actual code-writing dispatch stays in
 * DiagramCanvas, which owns the bus and clearBubbles; this hook only
 * tracks whether the detail card is open and opens it from a bubble click.
 */

export type BubbleDetailTarget = {
  functionName: string;
  displayLabel: string;
  blockId: string;
  x: number;
  y: number;
};

export function useBubbleEditOverlays(projectKey: number) {
  const [detail, setDetail] = useState<BubbleDetailTarget | null>(null);

  // Close the editor on a USER-initiated project change.
  useEffect(() => {
    setDetail(null);
  }, [projectKey]);

  /** Open the capability detail card for a clicked function bubble,
   *  anchored at the click point. */
  const openFromBubble = useCallback((node: Node, evt: React.MouseEvent) => {
    const d = node.data as {
      label?: string;
      displayLabel?: string;
      parentBlockId?: string;
    };
    if (!d.parentBlockId || !d.label) return;
    setDetail({
      functionName: d.label,
      displayLabel: d.displayLabel ?? d.label,
      blockId: d.parentBlockId,
      x: evt.clientX,
      y: evt.clientY,
    });
  }, []);

  const closeDetail = useCallback(() => setDetail(null), []);

  return {
    detail,
    openFromBubble,
    closeDetail,
  };
}

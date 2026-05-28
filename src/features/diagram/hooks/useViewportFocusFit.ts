import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import type { DiagramView } from "../types";
import type { FocusState } from "./useAdaptiveFocus";

/**
 * Camera pan to focused base block(s) when an adaptive-focus delta
 * arrives. Detail content lives in the side panel, so the main canvas
 * only re-fits to the base blocks the chat is talking about.
 *
 * 320ms timer waits for the side panel's slide-in animation to finish
 * so the canvas viewport has its real (smaller) width when we fit.
 * Otherwise the focused blocks would land off-screen behind the panel.
 */
export function useViewportFocusFit({
  view,
  focused,
}: {
  view: DiagramView;
  focused: FocusState | null;
}): void {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (view !== "focus") return;
    if (!focused) return;
    if (focused.ids.length === 0) return;
    const t = window.setTimeout(() => {
      fitView({
        nodes: focused.ids.map((id) => ({ id })),
        padding: 0.3,
        duration: 700,
        maxZoom: 1.3,
        minZoom: 0.5,
      });
    }, 320);
    return () => window.clearTimeout(t);
  }, [focused, view, fitView]);
}

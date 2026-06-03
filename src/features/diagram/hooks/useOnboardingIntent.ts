import { useCallback, useEffect, useState } from "react";
import type { IntentSelection } from "../types";

/**
 * Onboarding intent: the structured survey answer plus whether the revise
 * editor is open. Extracted from DiagramCanvas so the orchestrator does
 * not carry this feature's state and submit handlers inline.
 *
 * The hook owns intent / editingIntent and the two submit paths. The
 * canvas wipe needed on a real regenerate is passed in as `onRegenerate`,
 * since those setters belong to the canvas, not this feature.
 */
export function useOnboardingIntent({
  projectKey,
  userGoal,
  setUserGoal,
  onRegenerate,
}: {
  projectKey: number;
  userGoal: string | null;
  setUserGoal: (goal: string | null) => void;
  onRegenerate: () => void;
}) {
  const [intent, setIntent] = useState<IntentSelection | null>(null);
  const [editingIntent, setEditingIntent] = useState(false);

  // Reset on USER-initiated project change.
  useEffect(() => {
    setIntent(null);
    setEditingIntent(false);
  }, [projectKey]);

  /** First-time onboarding submit: store the selection + composed goal.
   *  Setting userGoal (from null) lets the structure fetch fire. */
  const complete = useCallback(
    (goal: string, selection: IntentSelection) => {
      setIntent(selection);
      setUserGoal(goal);
    },
    [setUserGoal],
  );

  /** Revise submit (from reopening the chip). Close the editor; only if
   *  the goal actually changed do we set it and regenerate, so just
   *  looking never forces a regenerate. */
  const revise = useCallback(
    (goal: string, selection: IntentSelection) => {
      setEditingIntent(false);
      setIntent(selection);
      if (goal === userGoal) return;
      setUserGoal(goal);
      onRegenerate();
    },
    [userGoal, setUserGoal, onRegenerate],
  );

  const openEditor = useCallback(() => setEditingIntent(true), []);
  const closeEditor = useCallback(() => setEditingIntent(false), []);

  return { intent, editingIntent, complete, revise, openEditor, closeEditor };
}

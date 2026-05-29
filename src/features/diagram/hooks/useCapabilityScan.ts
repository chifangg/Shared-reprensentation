/**
 * Owns the capability_scan fetch lifecycle.
 *
 * Fires on USER-initiated project change (projectKey bump) and produces
 * a CapabilityScanState for the onboarding survey to consume. The survey
 * stays gated behind a loading overlay until this reaches `ready`/`error`
 * (see DiagramCanvas) — both survey branches pick from these candidates,
 * so opening before they arrive would show an empty picklist.
 *
 * Mirrors the filesKey + cleanup-via-abort pattern from
 * useDiagramStructureFetch; same caveat about omitting `state.kind`
 * from the deps array (would cause the abort-then-rerun cycle).
 */

import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "@/core/project";
import type { CapabilityCandidate, CapabilityScanState } from "../types";
import { buildProjectContext } from "../api/buildProjectContext";
import { fetchCapabilityScanStream } from "../api/fetchCapabilityScan";

export function useCapabilityScan({
  projectKey,
  files,
}: {
  projectKey: number;
  files: FileEntry[];
}): CapabilityScanState {
  const [state, setState] = useState<CapabilityScanState>({ kind: "idle" });

  const filesKey = useMemo(
    () =>
      files
        .map((f) => f.path)
        .sort()
        .join("|"),
    [files],
  );

  // Reset on USER-initiated project change.
  useEffect(() => {
    setState({ kind: "idle" });
  }, [projectKey]);

  useEffect(() => {
    if (files.length === 0) return;
    if (state.kind !== "idle") return;

    setState({ kind: "loading", startedAt: Date.now() });
    const controller = new AbortController();
    const projectContext = buildProjectContext(files, null);
    const candidates: CapabilityCandidate[] = [];

    (async () => {
      let errorMessage: string | null = null;
      try {
        await fetchCapabilityScanStream({
          projectContext,
          signal: controller.signal,
          onEvent: (evt) => {
            if (evt.kind === "capability") {
              candidates.push(evt.data);
            } else if (evt.kind === "error") {
              errorMessage = evt.message;
            }
          },
        });
        if (controller.signal.aborted) return;
        if (errorMessage) {
          setState({ kind: "error", message: errorMessage });
        } else {
          setState({ kind: "ready", candidates });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: String(e) });
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  return state;
}

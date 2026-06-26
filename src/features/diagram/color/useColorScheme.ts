import { useCallback, useMemo, useRef, useState } from "react";
import {
  BUILTIN_SCHEMES,
  colorSchemeFromAI,
  type ColorScheme,
} from "./scheme";
import {
  buildColorSchemeContext,
  fetchColorScheme,
} from "../api/fetchColorScheme";
import type { DiagramBlock } from "../types";

/**
 * Owns the diagram's active color-encoding scheme + the list of available
 * schemes. Ships the built-ins (Category + the Complexity test fixture)
 * and grows AI-generated / custom schemes through `generate`.
 *
 * `generate(blocks, instruction)` runs the color_scheme view: with an
 * instruction it builds the user's "describe your own" grouping; without
 * one it asks the model to pick the most insightful encoding. On success
 * it appends the scheme and switches to it.
 *
 * Lives in DiagramCanvas (the only consumer): it resolves block colors
 * through `active` and feeds the legend/switcher. No provider needed yet.
 */
export function useColorScheme() {
  const [schemes, setSchemes] = useState<ColorScheme[]>(BUILTIN_SCHEMES);
  const [activeId, setActiveId] = useState<string>(BUILTIN_SCHEMES[0].id);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const genAbortRef = useRef<AbortController | null>(null);

  const active = useMemo(
    () => schemes.find((s) => s.id === activeId) ?? schemes[0],
    [schemes, activeId],
  );

  /** Append a generated scheme and switch to it. */
  const addScheme = useCallback((scheme: ColorScheme) => {
    setSchemes((prev) => {
      const without = prev.filter((s) => s.id !== scheme.id);
      return [...without, scheme];
    });
    setActiveId(scheme.id);
  }, []);

  const clearGenError = useCallback(() => setGenError(null), []);

  /** Generate a scheme for these blocks. `instruction` null/empty = let
   *  the model pick the encoding; non-empty = honor the user's grouping. */
  const generate = useCallback(
    async (blocks: DiagramBlock[], instruction: string | null) => {
      genAbortRef.current?.abort();
      const controller = new AbortController();
      genAbortRef.current = controller;
      const trimmed = instruction?.trim() || null;
      setGenError(null);
      setGenerating(true);
      try {
        const payload = await fetchColorScheme({
          blocksContext: buildColorSchemeContext(blocks),
          instruction: trimmed,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        addScheme(colorSchemeFromAI(payload, trimmed ? "custom" : "ai"));
      } catch (e) {
        if (controller.signal.aborted) return;
        setGenError(
          e instanceof Error ? e.message : "Could not generate a scheme.",
        );
      } finally {
        if (!controller.signal.aborted) setGenerating(false);
      }
    },
    [addScheme],
  );

  return {
    schemes,
    active,
    activeId,
    setActiveId,
    addScheme,
    generate,
    generating,
    genError,
    clearGenError,
  };
}

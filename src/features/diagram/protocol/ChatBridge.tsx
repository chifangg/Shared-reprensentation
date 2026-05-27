/**
 * Chat-side bridge components that mediate between Claude's assistant
 * responses and the diagram bus.
 *
 * ChatView renders these inline alongside the assistant's markdown:
 *  - ArrowsAddedSink: invisible component that watches its text prop
 *    for a trailing `added_arrows` JSON and emits "arrows-added" on
 *    the diagram bus once per unique payload.
 *  - OptionsHandoff: visible 1-line UI plus an "options-ready" emit;
 *    surfaces a "look at the canvas → N suggestions" prompt where the
 *    JSON would otherwise have rendered.
 *
 * Both components live in the diagram feature module — they belong
 * with the rest of the protocol code, not in core/. ChatView imports
 * them as small JSX building blocks and remains unaware of the
 * underlying bus topics or JSON shapes.
 */

import { useEffect, useMemo, useRef } from "react";
import type { ConnectionOption, EditTarget } from "../types";
import { useDiagramBus } from "./bus";
import { parseAddedArrowsBlock } from "./parsers";

/**
 * Invisible component: when its `text` contains an `added_arrows`
 * JSON block, emits "arrows-added" on the diagram bus exactly once
 * per unique payload. Lives next to the markdown render so the emit
 * happens as soon as the streaming text settles.
 */
export function ArrowsAddedSink({ text }: { text: string }) {
  const bus = useDiagramBus();
  const parsed = useMemo(() => parseAddedArrowsBlock(text), [text]);
  const key = useMemo(
    () =>
      parsed
        ? parsed.arrows.map((a) => `${a.from}|${a.to}|${a.label}`).join("·")
        : null,
    [parsed],
  );
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!parsed || !key) return;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    bus.emit("arrows-added", { arrows: parsed.arrows });
  }, [parsed, key, bus]);
  return null;
}

/**
 * Chat-side stub for the cards UI. Parses Claude's JSON options
 * inline, but the clickable cards live on the canvas (rendered by the
 * diagram next to the new arrow). This component:
 *   1. Emits "options-ready" on the diagram bus once per unique
 *      (target, options) payload.
 *   2. Shows a minimal "look at the canvas" prompt where the JSON
 *      would otherwise have been.
 */
export function OptionsHandoff({
  options,
  target,
}: {
  options: ConnectionOption[];
  target: EditTarget;
}) {
  const bus = useDiagramBus();
  // Cheap content-based key so we only dispatch when the parsed body
  // actually changes (e.g. streaming finishes; React re-renders on
  // every chunk). Without this we'd flood the diagram with duplicate
  // events on every keystroke of Claude's streaming response.
  const targetKey =
    target.kind === "arrow"
      ? `arrow:${target.from}->${target.to}`
      : target.kind === "block"
        ? `block:${target.id}`
        : "new-block";
  const optionsKey = useMemo(
    () => `${targetKey}|${options.map((o) => o.title).join("·")}`,
    [targetKey, options],
  );
  const lastSentKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSentKeyRef.current === optionsKey) return;
    lastSentKeyRef.current = optionsKey;
    bus.emit("options-ready", { target, options });
  }, [optionsKey, target, options, bus]);

  return (
    <div className="rounded-md border border-[#3B5BD9]/30 bg-[#1A1A20] px-3 py-2 text-xs text-[#7B96E8]">
      Please select your desired change from the canvas → {options.length}{" "}
      suggestion{options.length === 1 ? "" : "s"} ready.
    </div>
  );
}

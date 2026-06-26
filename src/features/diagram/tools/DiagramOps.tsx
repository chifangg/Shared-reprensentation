import { useEffect, useRef } from "react";
import { Palette, Trash2 } from "lucide-react";
import type { ClientToolProps, ToolResultProps } from "@/core/tools/registry";
import { useDiagramBus } from "../protocol/bus";
import { BLOCK_CATEGORIES } from "../util/blockCategory";

/**
 * Chat-driven diagram edits (bidirectional editing): the chat can change a
 * block's color (category) or delete a block, not just edit code. The
 * handlers run in the browser like the read/write file tools, but instead
 * of touching files they emit a "diagram-op" on the diagram bus; the canvas
 * applies it to the current schema. Best-effort, matched by block label.
 */

const CATEGORIES = Object.keys(BLOCK_CATEGORIES);

// --- change_block_color -----------------------------------------------------

interface ColorInput {
  block: string;
  category: string;
}
type ColorResult =
  | { ok: true; op: "recolor"; block: string; category: string }
  | { ok: false; error: string };

export function ChangeBlockColor({
  input,
  resolve,
}: ClientToolProps<ColorInput, ColorResult>) {
  const bus = useDiagramBus();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const block = (input.block ?? "").trim();
    const category = (input.category ?? "").trim().toLowerCase();
    if (!block) {
      resolve({ ok: false, error: "missing block label" });
      return;
    }
    if (!CATEGORIES.includes(category)) {
      resolve({
        ok: false,
        error: `category must be one of: ${CATEGORIES.join(", ")}`,
      });
      return;
    }
    bus.emit("diagram-op", { op: "recolor", block, category });
    resolve({ ok: true, op: "recolor", block, category });
  }, [input, resolve, bus]);
  return null;
}

// --- delete_block -----------------------------------------------------------

interface DeleteInput {
  block: string;
}
type DeleteResult =
  | { ok: true; op: "delete"; block: string }
  | { ok: false; error: string };

export function DeleteBlock({
  input,
  resolve,
}: ClientToolProps<DeleteInput, DeleteResult>) {
  const bus = useDiagramBus();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const block = (input.block ?? "").trim();
    if (!block) {
      resolve({ ok: false, error: "missing block label" });
      return;
    }
    bus.emit("diagram-op", { op: "delete", block });
    resolve({ ok: true, op: "delete", block });
  }, [input, resolve, bus]);
  return null;
}

// --- shared result card -----------------------------------------------------

type OpResult = ColorResult | DeleteResult;

export function DiagramOpResultCard({ content }: ToolResultProps<OpResult>) {
  if (!content || typeof content !== "object") return null;
  if (!content.ok) {
    return (
      <span className="self-start text-[11.5px] text-[#A89E8E]">
        diagram edit skipped: {content.error}
      </span>
    );
  }
  const accent =
    content.op === "recolor"
      ? BLOCK_CATEGORIES[content.category as keyof typeof BLOCK_CATEGORIES]
          ?.accent ?? "#978B77"
      : "#9A7212";
  return (
    <div
      className="inline-flex max-w-[92%] items-center gap-2.5 self-start rounded-[10px] bg-[#ECE1CB] px-3.5 py-2.5 text-[13px] leading-snug text-[#6E6353]"
      style={{
        boxShadow:
          "inset 0 2px 5px rgba(120,98,55,0.22), inset 0 -1px 0 rgba(255,255,255,0.55)",
      }}
    >
      {content.op === "recolor" ? (
        <Palette size={15} className="shrink-0 text-[#9A7E4E]" aria-hidden="true" />
      ) : (
        <Trash2 size={15} className="shrink-0 text-[#9A7212]" aria-hidden="true" />
      )}
      <span className="font-medium text-[#544A36]">
        {content.op === "recolor" ? "Recolored" : "Removed"}
      </span>
      <span
        className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-0.5 text-[11.5px] font-medium"
        style={{ borderColor: accent, color: accent }}
      >
        <span
          className="h-1.5 w-1.5 rounded-[2px]"
          style={{ background: accent }}
        />
        {content.block}
      </span>
      {content.op === "recolor" && (
        <span className="text-[#8C8273]">to {content.category}</span>
      )}
    </div>
  );
}

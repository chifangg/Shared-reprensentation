import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { DIAGRAM_VIEW_LABELS, type DiagramView } from "../types";

/**
 * Dropdown that toggles between overview and focus diagram views.
 * Lives in the diagram panel header (rendered by AppShell). Closes on
 * outside-click via a document-level mousedown listener.
 */
export function DiagramViewSwitcher({
  view,
  onChange,
}: {
  view: DiagramView;
  onChange: (v: DiagramView) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as globalThis.Node | null;
      if (ref.current && target && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-[#484848]/15 bg-white/70 px-2.5 py-1 text-xs font-medium tracking-tight text-[#484848] shadow-sm transition-colors hover:bg-white"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{DIAGRAM_VIEW_LABELS[view]}</span>
        <ChevronDown
          className={`h-3 w-3 text-[#484848]/60 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-10 mt-1.5 w-48 overflow-hidden rounded-md border border-[#484848]/10 bg-white shadow-lg"
        >
          {(Object.keys(DIAGRAM_VIEW_LABELS) as DiagramView[]).map((v) => {
            const selected = v === view;
            return (
              <button
                key={v}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[#F4F4F4] ${
                  selected
                    ? "font-medium text-[#484848]"
                    : "text-[#484848]/80"
                }`}
              >
                <span>{DIAGRAM_VIEW_LABELS[v]}</span>
                {selected && (
                  <Check
                    className="h-3 w-3 text-[#484848]"
                    strokeWidth={2.5}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

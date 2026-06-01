import { useMemo, useState } from "react";
import { X, Check, ArrowRight } from "lucide-react";

/**
 * Structured appearance editor for one interface surface (a block whose
 * category is "interface").
 *
 * Appearance is orthogonal to capability: color, font, and shape are not
 * "what a function does", so they have no natural bubble. But the user is
 * in edit mode, and edit mode must let them change how a surface looks.
 * This card gives that a home, scoped to the block they opened.
 *
 * The controls are structured (swatches, a font menu, a corner-radius
 * picker) rather than free typing, because describing a color or a font
 * in prose is exactly where edits go wrong. A free-text box stays as the
 * fallback for anything the controls do not cover.
 *
 * The preview is computed locally from the chosen values: the user picked
 * them, so "what will change" is just a readout of those picks, no AI
 * round-trip. On confirm we hand a composed instruction up to the parent,
 * which routes it through the same block-target write pipeline as every
 * other visual edit (so the surface's code is changed and the block
 * glows). This card never writes code itself.
 */

type Phase = "edit" | "preview";

type Swatch = { label: string; hex: string };

const BACKGROUNDS: Swatch[] = [
  { label: "White", hex: "#FFFFFF" },
  { label: "Beige", hex: "#F3ECDD" },
  { label: "Sand", hex: "#EFE5D0" },
  { label: "Sage", hex: "#E4E8DB" },
  { label: "Sky", hex: "#DDE4E8" },
  { label: "Clay", hex: "#F1E3DE" },
  { label: "Charcoal", hex: "#2A2622" },
];

const FONTS: { label: string; phrase: string }[] = [
  { label: "Sans", phrase: "a clean sans-serif font" },
  { label: "Serif", phrase: "a serif font" },
  { label: "Mono", phrase: "a monospace font" },
  { label: "Rounded", phrase: "a rounded, friendly font" },
];

const CORNERS: { label: string; phrase: string }[] = [
  { label: "Square", phrase: "square corners (no radius)" },
  { label: "Small", phrase: "slightly rounded corners" },
  { label: "Medium", phrase: "medium rounded corners" },
  { label: "Large", phrase: "large rounded corners" },
];

export function AppearanceCard({
  blockLabel,
  onClose,
  onConfirm,
}: {
  blockLabel: string;
  onClose: () => void;
  onConfirm: (instruction: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("edit");
  const [bg, setBg] = useState<Swatch | null>(null);
  const [font, setFont] = useState<(typeof FONTS)[number] | null>(null);
  const [corners, setCorners] = useState<(typeof CORNERS)[number] | null>(null);
  const [freeText, setFreeText] = useState("");

  // Human-readable list of the changes the user actually picked.
  const changeLines = useMemo(() => {
    const lines: string[] = [];
    if (bg) lines.push(`Background to ${bg.label.toLowerCase()} (${bg.hex})`);
    if (font) lines.push(`Font to ${font.label.toLowerCase()}`);
    if (corners) lines.push(`Corners to ${corners.label.toLowerCase()}`);
    if (freeText.trim()) lines.push(freeText.trim());
    return lines;
  }, [bg, font, corners, freeText]);

  const canApply = changeLines.length > 0;

  const confirm = () => {
    const parts: string[] = [];
    if (bg) parts.push(`set the background color to ${bg.label} (${bg.hex})`);
    if (font) parts.push(`change the text to ${font.phrase}`);
    if (corners) parts.push(`use ${corners.phrase}`);
    if (freeText.trim()) parts.push(freeText.trim());
    const instruction =
      `Restyle the user-facing surface for the "${blockLabel}" capability. ` +
      `Apply only these visual changes and leave behavior and logic untouched: ` +
      `${parts.join("; ")}. Keep it visually consistent with the rest of the app.`;
    onConfirm(instruction);
  };

  const swatchBtn = (active: boolean) =>
    `h-7 w-7 rounded-full border-2 transition-transform ${
      active
        ? "border-[#2A2622] scale-110"
        : "border-[#E7E2DA] hover:scale-105"
    }`;

  const chip = (active: boolean) =>
    `rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
      active
        ? "border-[#2A2622] bg-[#2A2622] text-white"
        : "border-[#E7E2DA] bg-white text-[#555] hover:border-[#C9B58E]"
    }`;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-[#0F172A]/30 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[min(460px,calc(100%-48px))] rounded-2xl border border-[#E7E2DA] bg-[#FCFBF9] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#EFEAE2] px-5 py-3.5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#999]">
              Appearance
            </div>
            <div className="mt-0.5 text-[14px] font-semibold text-[#2A2622]">
              {blockLabel}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#999] transition-colors hover:bg-[#F0EBE2] hover:text-[#555]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {phase === "edit" ? (
            <div className="space-y-4">
              {/* Background */}
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-[#888]">
                  Background
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {BACKGROUNDS.map((s) => (
                    <button
                      key={s.hex}
                      title={s.label}
                      onClick={() => setBg(bg?.hex === s.hex ? null : s)}
                      className={swatchBtn(bg?.hex === s.hex)}
                      style={{ backgroundColor: s.hex }}
                    />
                  ))}
                </div>
              </div>

              {/* Font */}
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-[#888]">
                  Font
                </div>
                <div className="flex flex-wrap gap-2">
                  {FONTS.map((f) => (
                    <button
                      key={f.label}
                      onClick={() =>
                        setFont(font?.label === f.label ? null : f)
                      }
                      className={chip(font?.label === f.label)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Corners */}
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-[#888]">
                  Corners
                </div>
                <div className="flex flex-wrap gap-2">
                  {CORNERS.map((c) => (
                    <button
                      key={c.label}
                      onClick={() =>
                        setCorners(corners?.label === c.label ? null : c)
                      }
                      className={chip(corners?.label === c.label)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Free text fallback */}
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-[#888]">
                  Anything else
                </div>
                <textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  rows={2}
                  placeholder="e.g. add more spacing between the cards"
                  className="w-full resize-none rounded-lg border border-[#E7E2DA] bg-white px-2.5 py-2 text-sm text-[#2A2622] outline-none placeholder:text-[#B5AFA4] focus:border-[#C9B58E]"
                />
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#A0894F]">
                These changes will apply
              </div>
              <ul className="space-y-1.5">
                {changeLines.map((l, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[13px] leading-snug text-[#4A4234]"
                  >
                    <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#B8995A]" />
                    {l}
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-[12px] leading-snug text-[#8A8378]">
                Only the look of this surface changes. Behavior stays the
                same.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#EFEAE2] px-5 py-3">
          {phase === "preview" ? (
            <>
              <button
                onClick={() => setPhase("edit")}
                className="rounded-lg px-3 py-1.5 text-sm text-[#777] transition-colors hover:bg-[#F0EBE2]"
              >
                Back
              </button>
              <button
                onClick={confirm}
                className="flex items-center gap-1.5 rounded-lg bg-[#A66B49] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#925d3f]"
              >
                <Check className="h-3.5 w-3.5" />
                Apply change
              </button>
            </>
          ) : (
            <button
              onClick={() => setPhase("preview")}
              disabled={!canApply}
              className="flex items-center gap-1.5 rounded-lg bg-[#2A2622] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#403a33] disabled:cursor-not-allowed disabled:bg-[#CFC8BC]"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              Preview change
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

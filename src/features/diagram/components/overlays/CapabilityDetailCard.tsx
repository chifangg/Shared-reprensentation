import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Loader2,
  Pencil,
  ArrowRight,
  Check,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  describeFunction,
  previewFunctionChange,
  type FunctionDetailFile,
} from "../../api/fetchFunctionDetail";

/**
 * Drill-in edit card for a single function bubble.
 *
 * Lifecycle:
 *   1. On open, read the function's real source (describe mode) and show
 *      a plain-language account of what it does. The description is
 *      editable: the user can rewrite it to express the behavior they
 *      want (the "pen").
 *   2. The user types a change and/or edits the description, then asks
 *      for a preview. Preview mode restates, in plain language, what the
 *      behavior will become. It never names files or identifiers: the
 *      confirmation is about the capability change, not the code.
 *   3. On confirm, we hand the composed change up to the parent, which
 *      routes it through the existing block-target visual-edit pipeline
 *      so code is written and the parent block glows.
 *
 * This component is read-only against the project: it never writes code
 * itself. All writes go through the parent's dispatch.
 */

type Phase = "loading" | "detail" | "previewing" | "preview" | "error";

const CARD_W = 340;

export function CapabilityDetailCard({
  functionName,
  displayLabel,
  blockLabel,
  files,
  anchor,
  onClose,
  onConfirm,
}: {
  functionName: string;
  displayLabel: string;
  blockLabel: string;
  files: FunctionDetailFile[];
  anchor: { x: number; y: number };
  onClose: () => void;
  onConfirm: (finalInstruction: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [description, setDescription] = useState("");
  const [originalDescription, setOriginalDescription] = useState("");
  const [behaviors, setBehaviors] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [previewSummary, setPreviewSummary] = useState("");
  const [error, setError] = useState("");
  // Behaviors are hidden by default: the canvas should stay light on
  // text. The user can expand them when they want more than the one-liner.
  const [showBehaviors, setShowBehaviors] = useState(false);

  // Fetch the description once per function. `files` is read through a
  // ref, NOT the dependency array: the parent recomputes the files array
  // on every render, so depending on its identity would re-fire describe
  // on every parent re-render and make the text flicker. The parent also
  // keys this card by block+function, so a fresh function remounts.
  const filesRef = useRef(files);
  filesRef.current = files;
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    setPhase("loading");
    describeFunction({ functionName, files: filesRef.current })
      .then((res) => {
        if (!aliveRef.current) return;
        setDescription(res.description);
        setOriginalDescription(res.description);
        setBehaviors(res.behaviors);
        setPhase("detail");
      })
      .catch((e) => {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : "Could not read this function.");
        setPhase("error");
      });
    return () => {
      aliveRef.current = false;
    };
  }, [functionName]);

  const descriptionEdited =
    description.trim() !== originalDescription.trim() && description.trim().length > 0;
  const canPreview = instruction.trim().length > 0 || descriptionEdited;

  // The plain-language change text, used both for the preview call and
  // (wrapped with function targeting) for the actual edit dispatch.
  const changeText = useMemo(() => {
    const parts: string[] = [];
    if (instruction.trim()) parts.push(instruction.trim());
    if (descriptionEdited) {
      parts.push(`It should now behave as follows: ${description.trim()}`);
    }
    return parts.join(" ");
  }, [instruction, descriptionEdited, description]);

  const runPreview = () => {
    if (!canPreview) return;
    setPhase("previewing");
    setError("");
    previewFunctionChange({ functionName, files, instruction: changeText })
      .then((res) => {
        if (!aliveRef.current) return;
        setPreviewSummary(res.summary);
        setPhase("preview");
      })
      .catch((e) => {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : "Could not preview the change.");
        setPhase("detail");
      });
  };

  const confirm = () => {
    const base = originalDescription.trim()
      ? ` (currently: ${originalDescription.trim()})`
      : "";
    const finalInstruction =
      `In the block "${blockLabel}", change the function \`${functionName}\`${base}. ` +
      changeText;
    onConfirm(finalInstruction);
  };

  // Anchor to the click, clamped into the viewport. The card height is
  // then capped to the space BELOW `top` so it never runs off the bottom
  // (the preview can grow the body well past its old fixed guess), which
  // is what hid the Apply button. The body scrolls; the footer stays put.
  const left = Math.max(
    16,
    Math.min(anchor.x + 16, window.innerWidth - CARD_W - 16),
  );
  const top = Math.max(16, Math.min(anchor.y - 24, window.innerHeight - 240));
  const maxHeight = window.innerHeight - top - 16;

  return (
    <>
      {/* Transparent dismiss layer. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex flex-col rounded-xl border border-[#E7E2DA] bg-[#FCFBF9] shadow-xl"
        style={{ left, top, width: CARD_W, maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-2 border-b border-[#EFEAE2] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] uppercase tracking-wide text-[#999]">
              {blockLabel}
            </div>
            <div className="truncate text-sm font-semibold text-[#2A2622]">
              {displayLabel}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {phase === "loading" && (
            <div className="flex items-center gap-2 py-6 text-sm text-[#777]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading this function...
            </div>
          )}

          {phase === "error" && (
            <div className="py-3 text-sm text-[#A66B49]">
              {error || "Could not read this function."}
            </div>
          )}

          {(phase === "detail" ||
            phase === "previewing" ||
            phase === "preview") && (
            <>
              {/* Plain-language description (editable = the pen). Kept to
                  one short line by default; the canvas stays light on text. */}
              <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[#888]">
                <Pencil className="h-3 w-3" />
                What this does
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-[#E7E2DA] bg-white px-2.5 py-2 text-sm leading-snug text-[#2A2622] outline-none focus:border-[#C9B58E]"
              />

              {behaviors.length > 0 && (
                <div className="mt-1.5">
                  <button
                    onClick={() => setShowBehaviors((v) => !v)}
                    className="flex items-center gap-1 text-[11px] text-[#999] transition-colors hover:text-[#666]"
                  >
                    {showBehaviors ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {showBehaviors ? "Hide details" : `Details (${behaviors.length})`}
                  </button>
                  {showBehaviors && (
                    <ul className="mt-1 space-y-1">
                      {behaviors.map((b, i) => (
                        <li
                          key={i}
                          className="flex gap-1.5 text-[12px] leading-snug text-[#666]"
                        >
                          <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-[#B8995A]" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Instruction box. */}
              <label className="mb-1 mt-4 block text-[11px] font-medium text-[#888]">
                What do you want to change?
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                placeholder="e.g. retry up to 3 times if it fails"
                className="w-full resize-none rounded-lg border border-[#E7E2DA] bg-white px-2.5 py-2 text-sm text-[#2A2622] outline-none placeholder:text-[#B5AFA4] focus:border-[#C9B58E]"
              />

              {error && phase !== "preview" && (
                <div className="mt-2 text-[12px] text-[#A66B49]">{error}</div>
              )}

              {/* Preview block. */}
              {phase === "preview" && (
                <div className="mt-3 rounded-lg border border-[#E3DCC9] bg-[#F7F2E6] px-3 py-2.5">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#A0894F]">
                    After this change
                  </div>
                  <div className="text-[13px] leading-snug text-[#4A4234]">
                    {previewSummary}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions. */}
        {(phase === "detail" ||
          phase === "previewing" ||
          phase === "preview" ||
          phase === "error") && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#EFEAE2] px-4 py-2.5">
            {phase === "preview" ? (
              <>
                <button
                  onClick={() => setPhase("detail")}
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
                onClick={runPreview}
                disabled={!canPreview || phase === "previewing"}
                className="flex items-center gap-1.5 rounded-lg bg-[#2A2622] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#403a33] disabled:cursor-not-allowed disabled:bg-[#CFC8BC]"
              >
                {phase === "previewing" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" />
                )}
                Preview change
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

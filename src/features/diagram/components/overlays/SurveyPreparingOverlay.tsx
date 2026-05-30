import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CapabilityScanState } from "../../types";
import { ElapsedClock } from "../nodes/ElapsedClock";

/**
 * Pre-survey intro overlay. The capability_scan typically takes ~15s,
 * so instead of a bare spinner we play a short staggered intro that
 * orients the user while the scan runs in the background.
 *
 * It calls onReady once its scripted timeline finishes (INTRO_MS). The
 * parent only swaps in the real survey once BOTH the intro is done AND
 * the scan resolved. If the scan is still running when the intro
 * ends, this overlay drops into a graceful "almost ready" tail (spinner
 * + elapsed clock) instead of snapping to an ugly loader.
 */

const INTRO_MS = 9800;

const LINES = [
  "This is the canvas where your project's architecture will take shape.",
  "Before you draw anything, we'd like to know what you came here to do.",
  "Reading through your files to surface what this project can do…",
];

export function SurveyPreparingOverlay({
  scanState,
  onReady,
}: {
  scanState: CapabilityScanState;
  onReady: () => void;
}) {
  const startedAt = useRef(Date.now()).current;
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setIntroDone(true);
      onReady();
    }, INTRO_MS);
    return () => clearTimeout(id);
  }, [onReady]);

  const stalled =
    introDone && scanState.kind !== "ready" && scanState.kind !== "error";

  return (
    <div className="survey-overlay-in pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-[#2A2622]/30 backdrop-blur-[3px]">
      <div className="survey-card-in w-[min(520px,calc(100%-48px))] overflow-hidden rounded-[22px] border border-[#E7E2DA] bg-[#FCFBF9] shadow-[0_24px_70px_-20px_rgba(60,53,47,0.45)]">
        <div className="bg-gradient-to-br from-[#F6F0E6] to-[#FCFBF9] px-7 pb-6 pt-7">
          {/* Warm typographic greeting instead of an icon badge. A
           *  lowercase serif italic "hi" in the clay accent reads as a
           *  human hello and stays in the muted palette, no sparkle-AI
           *  cliché. */}
          <span
            className="survey-rise inline-block font-serif text-[34px] italic leading-none tracking-tight text-[#A66B49]"
            style={{ animationDelay: "120ms" }}
          >
            hi!
          </span>
          <div className="mt-4 flex flex-col gap-3">
            {LINES.map((line, i) => (
              <p
                key={i}
                className="survey-rise text-[15px] font-medium leading-snug text-[#2A2622]"
                style={{ animationDelay: `${500 + i * 2400}ms` }}
              >
                {line}
              </p>
            ))}
          </div>
          <div
            className="survey-rise mt-5 flex items-center gap-2 text-[12.5px] text-[#8A8178]"
            style={{ animationDelay: "7400ms" }}
          >
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-[#A66B49]"
              strokeWidth={2}
            />
            <span>{stalled ? "Almost ready…" : "Preparing your options…"}</span>
            {stalled && <ElapsedClock startedAt={startedAt} />}
          </div>
        </div>
      </div>
    </div>
  );
}

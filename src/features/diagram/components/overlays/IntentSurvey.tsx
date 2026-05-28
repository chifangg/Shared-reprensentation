import { useState } from "react";
import type {
  CapabilityCandidate,
  CapabilityScanState,
  IntentRole,
  IntentVerb,
} from "../../types";
import {
  CapabilityStep,
  OtherStep,
  UnderstandStep,
  composeGoal,
} from "./IntentSurveySteps";

/**
 * Onboarding survey modal. Blocks the diagram structure fetch until the
 * user answers two questions:
 *
 *   1. Verb — Understand / Edit / Reference / Other
 *   2. Branched follow-up:
 *      - Understand → role multi-select + optional detail text
 *      - Edit / Reference → pick a capability candidate (from the
 *        parallel capability_scan) OR free text
 *      - Other → free text
 *
 * The composed goal string flows into buildProjectContext as `<user_goal>`,
 * shaping the capability-centric overview prompt.
 *
 * State is internal; parent only sees the final composed goal via
 * onComplete. Mounting/unmounting the survey resets its state.
 */

const VERBS: { value: IntentVerb; label: string; hint: string }[] = [
  {
    value: "understand",
    label: "Understand",
    hint: "Get oriented in this codebase",
  },
  {
    value: "edit",
    label: "Edit",
    hint: "Modify or extend something",
  },
  {
    value: "reference",
    label: "Reference",
    hint: "Borrow a pattern for my own project",
  },
  {
    value: "other",
    label: "Other",
    hint: "Tell me in your own words",
  },
];

export function IntentSurvey({
  scanState,
  onComplete,
}: {
  scanState: CapabilityScanState;
  onComplete: (goal: string) => void;
}) {
  const [verb, setVerb] = useState<IntentVerb | null>(null);
  const [roles, setRoles] = useState<IntentRole[]>([]);
  const [roleOtherText, setRoleOtherText] = useState("");
  const [understandText, setUnderstandText] = useState("");
  const [capability, setCapability] = useState<CapabilityCandidate | null>(
    null,
  );
  const [capFreeText, setCapFreeText] = useState("");
  const [otherText, setOtherText] = useState("");

  const toggleRole = (r: IntentRole) =>
    setRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );

  const canSubmit = (() => {
    if (verb === "understand")
      return roles.length > 0 || understandText.trim().length > 0;
    if (verb === "edit" || verb === "reference")
      return capability !== null || capFreeText.trim().length > 0;
    if (verb === "other") return otherText.trim().length > 0;
    return false;
  })();

  const handleSubmit = () => {
    if (!verb || !canSubmit) return;
    const goal = composeGoal({
      verb,
      roles,
      roleOtherText,
      understandText,
      capability,
      capFreeText,
      otherText,
    });
    if (!goal.trim()) return;
    onComplete(goal);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-[#0F172A]/30 backdrop-blur-[2px]">
      <div
        className="w-[min(560px,calc(100%-48px))] rounded-2xl border border-[#78716C]/30 bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-wider text-[#78716C]">
            {verb ? "Tell us a bit more" : "Before we draw your diagram"}
          </div>
          <div className="mt-0.5 text-[14px] text-[#222222]">
            {verb
              ? "Your answer shapes which capabilities get emphasized."
              : "What do you want to do with this codebase?"}
          </div>
        </div>

        {!verb && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {VERBS.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => setVerb(v.value)}
                className="flex flex-col items-start gap-1 rounded-lg border border-[#D4D4D4] bg-white px-3 py-2.5 text-left hover:border-[#78716C]/40 hover:bg-[#F5F5F4]"
              >
                <span className="text-sm font-semibold text-[#222222]">
                  {v.label}
                </span>
                <span className="text-xs text-[#666666]">{v.hint}</span>
              </button>
            ))}
          </div>
        )}

        {verb === "understand" && (
          <UnderstandStep
            roles={roles}
            toggleRole={toggleRole}
            roleOtherText={roleOtherText}
            setRoleOtherText={setRoleOtherText}
            understandText={understandText}
            setUnderstandText={setUnderstandText}
          />
        )}

        {(verb === "edit" || verb === "reference") && (
          <CapabilityStep
            scanState={scanState}
            capability={capability}
            setCapability={setCapability}
            freeText={capFreeText}
            setFreeText={setCapFreeText}
          />
        )}

        {verb === "other" && (
          <OtherStep text={otherText} setText={setOtherText} />
        )}

        {verb && (
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setVerb(null)}
              className="rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1 text-[12px] text-[#666666] hover:bg-[#FAFAFA]"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-md bg-[#78716C] px-3 py-1 text-[12px] font-medium text-white shadow-sm hover:bg-[#57534E] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
            >
              Generate diagram
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

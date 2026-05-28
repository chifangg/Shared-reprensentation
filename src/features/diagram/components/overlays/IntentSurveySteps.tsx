import type {
  CapabilityCandidate,
  CapabilityScanState,
  IntentRole,
  IntentVerb,
} from "../../types";

/**
 * Sub-step panels for the IntentSurvey state machine, plus the
 * goal-string composer. Kept together because all three steps + the
 * composer share the same ROLES const and survey-shape types — splitting
 * each into its own file would scatter the survey vocabulary.
 */

export const ROLES: { value: IntentRole; label: string }[] = [
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "fullstack", label: "Fullstack" },
  { value: "ml", label: "ML / Data" },
  { value: "security", label: "Security" },
  { value: "design", label: "Design" },
  { value: "other", label: "Other" },
];

export function composeGoal(params: {
  verb: IntentVerb;
  roles: IntentRole[];
  roleOtherText: string;
  understandText: string;
  capability: CapabilityCandidate | null;
  capFreeText: string;
  otherText: string;
}): string {
  const { verb } = params;
  if (verb === "understand") {
    const roleLabels = params.roles
      .map((r) =>
        r === "other"
          ? params.roleOtherText.trim() || null
          : ROLES.find((x) => x.value === r)?.label ?? null,
      )
      .filter((s): s is string => !!s);
    const rolePart = roleLabels.length
      ? `Role: ${roleLabels.join(", ")}.`
      : "";
    const detailPart = params.understandText.trim()
      ? `Want to understand: ${params.understandText.trim()}.`
      : `Want to understand the codebase.`;
    return [rolePart, detailPart].filter(Boolean).join(" ");
  }
  if (verb === "edit") {
    const target = params.capability
      ? params.capability.label
      : params.capFreeText.trim();
    return `Want to edit: ${target}.`;
  }
  if (verb === "reference") {
    const target = params.capability
      ? params.capability.label
      : params.capFreeText.trim();
    return `Looking for a reference of: ${target}.`;
  }
  return params.otherText.trim();
}

export function UnderstandStep({
  roles,
  toggleRole,
  roleOtherText,
  setRoleOtherText,
  understandText,
  setUnderstandText,
}: {
  roles: IntentRole[];
  toggleRole: (r: IntentRole) => void;
  roleOtherText: string;
  setRoleOtherText: (s: string) => void;
  understandText: string;
  setUnderstandText: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-[#222222]">
          Your background (pick any that apply)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map((r) => {
            const on = roles.includes(r.value);
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => toggleRole(r.value)}
                className={
                  on
                    ? "rounded-full border border-[#78716C] bg-[#78716C] px-2.5 py-1 text-[12px] font-medium text-white"
                    : "rounded-full border border-[#D4D4D4] bg-white px-2.5 py-1 text-[12px] text-[#222222] hover:border-[#78716C]/40 hover:bg-[#F5F5F4]"
                }
              >
                {r.label}
              </button>
            );
          })}
        </div>
        {roles.includes("other") && (
          <input
            value={roleOtherText}
            onChange={(e) => setRoleOtherText(e.target.value)}
            placeholder="Describe your role"
            className="mt-2 w-full rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1.5 text-[13px] text-[#222222] outline-none focus:border-[#78716C]"
          />
        )}
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-[#222222]">
          What do you want to understand? (optional)
        </div>
        <textarea
          value={understandText}
          onChange={(e) => setUnderstandText(e.target.value)}
          placeholder="e.g. how the data flow works end-to-end"
          rows={2}
          className="w-full resize-none rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1.5 text-[13px] text-[#222222] outline-none focus:border-[#78716C]"
        />
      </div>
    </div>
  );
}

export function CapabilityStep({
  scanState,
  capability,
  setCapability,
  freeText,
  setFreeText,
}: {
  scanState: CapabilityScanState;
  capability: CapabilityCandidate | null;
  setCapability: (c: CapabilityCandidate | null) => void;
  freeText: string;
  setFreeText: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-[#222222]">
          Pick a capability
        </div>
        {scanState.kind === "loading" && (
          <div className="rounded-md border border-dashed border-[#D4D4D4] bg-[#FAFAFA] px-3 py-2 text-[12px] text-[#666666]">
            Analyzing project…
          </div>
        )}
        {scanState.kind === "error" && (
          <div className="rounded-md border border-[#E48A8A] bg-[#FFF4F4] px-3 py-2 text-[12px] text-[#7A2424]">
            Couldn't scan: {scanState.message}. Type below instead.
          </div>
        )}
        {scanState.kind === "ready" && (
          <div className="flex max-h-[200px] flex-col gap-1.5 overflow-y-auto">
            {scanState.candidates.map((c) => {
              const on = capability?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCapability(on ? null : c);
                    if (!on) setFreeText("");
                  }}
                  className={
                    on
                      ? "flex flex-col items-start gap-0.5 rounded-md border border-[#78716C] bg-[#F5F5F4] px-2.5 py-1.5 text-left"
                      : "flex flex-col items-start gap-0.5 rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1.5 text-left hover:border-[#78716C]/40 hover:bg-[#F5F5F4]"
                  }
                >
                  <span className="text-[13px] font-semibold text-[#222222]">
                    {c.label}
                  </span>
                  <span className="text-[11px] text-[#666666]">{c.caption}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-[#222222]">
          Or describe in your own words
        </div>
        <input
          value={freeText}
          onChange={(e) => {
            setFreeText(e.target.value);
            if (e.target.value.trim()) setCapability(null);
          }}
          placeholder="e.g. add a new publication entry"
          className="w-full rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1.5 text-[13px] text-[#222222] outline-none focus:border-[#78716C]"
        />
      </div>
    </div>
  );
}

export function OtherStep({
  text,
  setText,
}: {
  text: string;
  setText: (s: string) => void;
}) {
  return (
    <textarea
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder="What do you want to do here? Be as specific as you like."
      rows={4}
      className="w-full resize-none rounded-md border border-[#D4D4D4] bg-white px-2.5 py-1.5 text-[13px] text-[#222222] outline-none focus:border-[#78716C]"
    />
  );
}

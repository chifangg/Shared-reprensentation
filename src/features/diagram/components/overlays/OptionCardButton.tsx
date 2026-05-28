import type { ConnectionOption } from "../../types";

/**
 * Single card button inside ConnectionOptionsOverlay. Renders the
 * option's kind chip (block_level / detail / no change), title, and
 * a one-line detail. Calls onClick when the user picks it.
 */
export function OptionCardButton({
  option,
  onClick,
}: {
  option: ConnectionOption;
  onClick: () => void;
}) {
  const kindStyles =
    option.kind === "block_level"
      ? "border-[#3B5BD9]/40 text-[#3B5BD9]"
      : option.kind === "detail"
        ? "border-[#A56C2E]/40 text-[#A56C2E]"
        : "border-[#666666]/40 text-[#666666]";
  const kindLabel =
    option.kind === "block_level"
      ? `link · ${option.label ?? "?"}`
      : option.kind === "detail"
        ? "detail"
        : "no change";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-lg border border-[#D4D4D4] bg-white px-3 py-2 text-left transition-colors hover:border-[#3B5BD9]/40 hover:bg-[#F4F7FF]"
    >
      <div className="flex w-full items-center gap-2">
        <span
          className={`shrink-0 rounded border px-1 py-px font-mono text-[9px] uppercase tracking-wider ${kindStyles}`}
        >
          {kindLabel}
        </span>
        <span className="text-sm font-medium text-[#222222]">
          {option.title}
        </span>
      </div>
      <div className="text-xs text-[#666666]">{option.detail}</div>
    </button>
  );
}

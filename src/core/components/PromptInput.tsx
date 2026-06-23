import { useState, type KeyboardEvent, type ReactNode } from "react";

export function PromptInput({
  onSubmit,
  onCancel,
  disabled,
  running,
  attachments,
}: {
  onSubmit: (prompt: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  running?: boolean;
  /** Optional row rendered above the textarea, inside the input box
   *  (e.g. attached context chips). */
  attachments?: ReactNode;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-[#E2DACB] bg-[#F0EADE] p-3">
      {attachments}
      <div className="flex items-end gap-2">
      <textarea
        className="flex-1 resize-none rounded-lg border border-[#E2DACB] bg-white px-3 py-2 text-[14px] text-[#2E2A25] placeholder:text-[#B3A998] outline-none focus:border-[#B7AE9C] disabled:opacity-60"
        placeholder={running ? "Streaming…" : "Type a message…"}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
      />
      {running && onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="rounded-lg border border-[#2E2A25] bg-[#2E2A25] px-4 py-2 text-xs font-medium text-[#EFE9DD] transition-colors hover:bg-[#46403A] disabled:opacity-40 disabled:hover:bg-[#2E2A25]"
        >
          Send
        </button>
      )}
      </div>
    </div>
  );
}

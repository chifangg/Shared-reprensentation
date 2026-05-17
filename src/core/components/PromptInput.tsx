import { useState, type KeyboardEvent } from "react";

export function PromptInput({
  onSubmit,
  onCancel,
  disabled,
  running,
}: {
  onSubmit: (prompt: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  running?: boolean;
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
    <div className="flex items-end gap-2 border-t border-[#2A2A2A] bg-[#141414] p-3">
      <textarea
        className="flex-1 resize-none rounded-md border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-sm text-[#E5E5E5] placeholder:text-[#555555] outline-none focus:border-[#3B5BD9]/50 disabled:opacity-60"
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
          className="rounded-md border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/25"
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="rounded-md border border-[#2A2A2A] bg-[#242424] px-4 py-2 text-xs font-medium text-[#E5E5E5] transition-colors hover:bg-[#2F2F2F] disabled:opacity-40 disabled:hover:bg-[#242424]"
        >
          Send
        </button>
      )}
    </div>
  );
}

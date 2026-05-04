import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

/**
 * Tiny prompt composer. Enter submits; Shift+Enter inserts a newline.
 * Deliberately bare — forks add slash-command pickers, file pickers, model
 * selectors, etc. by wrapping or replacing this component.
 */
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
    <div className="flex items-center gap-2 bg-[#D9D9D9] p-3">
      <textarea
        className="flex-1 resize-none rounded-full bg-[#EAEAEA] px-4 py-2 text-sm text-[#484848] placeholder:text-[#979595] outline-none border-0"
        placeholder={running ? "Streaming…" : "Type to ask…"}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
      />
      {running && onCancel ? (
        <Button
          variant="destructive"
          onClick={onCancel}
          className="rounded-full"
        >
          Cancel
        </Button>
      ) : (
        <Button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="rounded-full bg-[#212121]/75 text-white hover:bg-[#212121]/90"
        >
          Send
        </Button>
      )}
    </div>
  );
}

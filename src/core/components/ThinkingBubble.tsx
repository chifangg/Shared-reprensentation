/**
 * Animated placeholder shown while a turn is in flight and Claude hasn't
 * produced the first visible block yet. Three bouncing dots; styling
 * matches the assistant-bubble chrome so it reads as "Claude is
 * composing" rather than "something else happened."
 */
export function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div
        className="flex items-center gap-1 rounded-2xl border border-[#EDE6DA] bg-white px-4 py-3"
        aria-label="Claude is thinking"
        style={{ boxShadow: "0 1px 2px rgba(60,50,30,0.05)" }}
      >
        <Dot delayMs={0} />
        <Dot delayMs={150} />
        <Dot delayMs={300} />
      </div>
    </div>
  );
}

function Dot({ delayMs }: { delayMs: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#B3A998]"
      style={{ animationDelay: `${delayMs}ms` }}
    />
  );
}

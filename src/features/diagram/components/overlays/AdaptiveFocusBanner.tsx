/**
 * Top-center banner shown in focus mode before any user message lands.
 * Tells the user the panel will wake up once they start chatting.
 * Caller controls conditional rendering.
 */
export function AdaptiveFocusBanner() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-[#78716C]/30 bg-[#F5F5F4] px-3 py-1 text-[11px] font-medium text-[#78716C] shadow-sm">
      Adaptive focus mode · diagram will refocus when you chat
    </div>
  );
}

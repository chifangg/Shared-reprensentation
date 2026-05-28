import { useEffect, useState } from "react";

/**
 * Tiny "MM:SS / Ns" clock that updates every 500ms. Used by the
 * diagram loading card and the streaming chip to show how long the
 * current fetch has been running.
 */
export function ElapsedClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const sec = Math.floor((now - startedAt) / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const time = mm > 0 ? `${mm}:${String(ss).padStart(2, "0")}` : `${ss}s`;
  return <span className="tabular-nums text-[#484848]/70">{time}</span>;
}

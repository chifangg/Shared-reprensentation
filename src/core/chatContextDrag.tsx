import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChatContextChip } from "@/core/components/ChatContextChip";
import type { ChatContextItem } from "@/core/chatContext";

/**
 * Pointer-based drag for pulling a diagram element into the chat as
 * context.
 *
 * Native HTML5 drag-and-drop does NOT work inside React Flow: its
 * pointer/zoom handling swallows the gesture, so the drag never starts.
 * Instead we run our own drag off `window` pointer events, which React
 * Flow cannot intercept. A source calls `dragSourceProps(item)` to get an
 * `onPointerDown`; once the pointer moves past a small threshold we show
 * a floating ghost and, on release over a registered drop zone, hand the
 * item to that zone. Below the threshold nothing happens, so a plain
 * click still reaches the element (e.g. a bubble still opens its detail).
 */

const DRAG_THRESHOLD = 5;

type DropHandler = (item: ChatContextItem) => void;
type DropZone = { el: HTMLElement; onDrop: DropHandler };

type DragContext = {
  beginDrag: (item: ChatContextItem, startX: number, startY: number) => void;
  registerDropZone: (el: HTMLElement, onDrop: DropHandler) => () => void;
  /** True while a drag is past the threshold (for drop-zone highlight). */
  dragging: boolean;
};

const Ctx = createContext<DragContext | null>(null);

export function ChatContextDragProvider({ children }: { children: ReactNode }) {
  const dropZones = useRef<DropZone[]>([]);
  const [ghost, setGhost] = useState<{
    item: ChatContextItem;
    x: number;
    y: number;
  } | null>(null);

  const registerDropZone = useCallback(
    (el: HTMLElement, onDrop: DropHandler) => {
      const entry: DropZone = { el, onDrop };
      dropZones.current.push(entry);
      return () => {
        dropZones.current = dropZones.current.filter((z) => z !== entry);
      };
    },
    [],
  );

  const beginDrag = useCallback(
    (item: ChatContextItem, startX: number, startY: number) => {
      let started = false;
      // Kill text selection for the whole gesture. As the pointer sweeps
      // over the canvas / chat it would otherwise drag-select text (the
      // blue highlight), and that selection gesture also swallows the
      // drag. `user-select: none` alone is not enough (elements can opt
      // back in), so also preventDefault every `selectstart`. Restored on
      // release.
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const preventSelect = (ev: Event) => ev.preventDefault();
      document.addEventListener("selectstart", preventSelect);
      window.getSelection?.()?.removeAllRanges();
      const move = (ev: PointerEvent) => {
        if (!started) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD)
            return;
          started = true;
        }
        setGhost({ item, x: ev.clientX, y: ev.clientY });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = prevUserSelect;
        document.removeEventListener("selectstart", preventSelect);
        if (started) {
          const zone = dropZones.current.find((z) => {
            const r = z.el.getBoundingClientRect();
            return (
              ev.clientX >= r.left &&
              ev.clientX <= r.right &&
              ev.clientY >= r.top &&
              ev.clientY <= r.bottom
            );
          });
          if (zone) zone.onDrop(item);
          // Swallow the click the browser fires after the drag so it does
          // not also trigger the element's click action (e.g. open a
          // bubble's detail card). Self-removes after the click or a beat.
          const suppress = (ce: Event) => {
            ce.stopPropagation();
            (ce as MouseEvent).preventDefault?.();
            cleanup();
          };
          const cleanup = () => window.removeEventListener("click", suppress, true);
          window.addEventListener("click", suppress, true);
          window.setTimeout(cleanup, 350);
        }
        setGhost(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [],
  );

  return (
    <Ctx.Provider value={{ beginDrag, registerDropZone, dragging: ghost !== null }}>
      {children}
      {ghost &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999]"
            style={{
              left: ghost.x + 12,
              top: ghost.y + 12,
              opacity: 0.92,
              transform: "rotate(-1.5deg)",
            }}
          >
            <ChatContextChip
              kind={ghost.item.kind}
              label={ghost.item.label}
              sublabel={ghost.item.sublabel}
              accent={ghost.item.accent}
            />
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

/** Source helper: spread `dragSourceProps(item)` onto the draggable
 *  element. Returns an empty object when used outside the provider. */
export function useChatContextDrag(): {
  dragSourceProps: (item: ChatContextItem) => {
    onPointerDown: (e: ReactPointerEvent) => void;
  };
  dragging: boolean;
} {
  const ctx = useContext(Ctx);
  const dragSourceProps = useCallback(
    (item: ChatContextItem) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.button !== 0 || !ctx) return;
        // Keep React Flow from panning / node-dragging; the click is a
        // separate event and still reaches the element.
        e.stopPropagation();
        ctx.beginDrag(item, e.clientX, e.clientY);
      },
    }),
    [ctx],
  );
  return { dragSourceProps, dragging: ctx?.dragging ?? false };
}

/** Drop-zone helper: register an element as a place to drop context
 *  items. Returns the current `dragging` flag for highlight. */
export function useChatContextDropZone(
  onDrop: DropHandler,
): { ref: (el: HTMLElement | null) => void; dragging: boolean } {
  const ctx = useContext(Ctx);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const elRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      elRef.current = el;
      if (el && ctx) {
        cleanupRef.current = ctx.registerDropZone(el, (item) =>
          onDropRef.current(item),
        );
      }
    },
    [ctx],
  );

  useEffect(() => () => cleanupRef.current?.(), []);

  return { ref, dragging: ctx?.dragging ?? false };
}

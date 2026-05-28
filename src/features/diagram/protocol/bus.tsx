/**
 * Typed pub/sub bus for the chat ↔ diagram protocol.
 *
 * Exposed through React Context so the bus instance is naturally
 * scoped to the React tree — StrictMode double-mounting can't leak
 * subscribers across instances, and tests can wrap a subtree in their
 * own provider without touching `window`.
 *
 * Replaces the four `window.CustomEvent`-based events the diagram
 * historically used to coordinate with ChatView. Each emit / subscribe
 * call is a 1:1 mechanical replacement of the prior window pattern;
 * the typed `DiagramBusMessageMap` enforces payload shape at the
 * compile boundary.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type {
  DiagramBusMessageMap,
  DiagramBusTopic,
} from "./events";

type Handler<T> = (payload: T) => void;

export interface DiagramBus {
  emit<K extends DiagramBusTopic>(
    topic: K,
    payload: DiagramBusMessageMap[K],
  ): void;
  subscribe<K extends DiagramBusTopic>(
    topic: K,
    handler: Handler<DiagramBusMessageMap[K]>,
  ): () => void;
}

/** Create a fresh bus instance. Exposed for tests; production code
 *  uses the `DiagramBusProvider`. */
export function createDiagramBus(): DiagramBus {
  // Each topic owns its own Set of handlers. Iterating a copy in
  // `emit` so a handler that subscribes / unsubscribes during dispatch
  // doesn't mutate the set we're walking.
  const handlers = new Map<DiagramBusTopic, Set<Handler<unknown>>>();

  const emit: DiagramBus["emit"] = (topic, payload) => {
    const set = handlers.get(topic);
    if (!set || set.size === 0) return;
    for (const h of Array.from(set)) {
      (h as Handler<DiagramBusMessageMap[typeof topic]>)(payload);
    }
  };

  const subscribe: DiagramBus["subscribe"] = (topic, handler) => {
    let set = handlers.get(topic);
    if (!set) {
      set = new Set();
      handlers.set(topic, set);
    }
    set.add(handler as Handler<unknown>);
    return () => {
      const s = handlers.get(topic);
      if (!s) return;
      s.delete(handler as Handler<unknown>);
    };
  };

  return { emit, subscribe };
}

const DiagramBusContext = createContext<DiagramBus | null>(null);

export function DiagramBusProvider({ children }: { children: ReactNode }) {
  // One bus per provider tree; created lazily on first render.
  const busRef = useRef<DiagramBus | null>(null);
  if (!busRef.current) busRef.current = createDiagramBus();
  return (
    <DiagramBusContext.Provider value={busRef.current}>
      {children}
    </DiagramBusContext.Provider>
  );
}

/**
 * Access the bus instance from the surrounding `<DiagramBusProvider>`.
 * Throws if the caller is rendered outside the provider — that's a
 * setup error, surfacing it loudly beats subtle no-op emits.
 */
export function useDiagramBus(): DiagramBus {
  const bus = useContext(DiagramBusContext);
  if (!bus) {
    throw new Error(
      "useDiagramBus must be used inside <DiagramBusProvider>. Wrap your AppShell (or test subtree) in the provider.",
    );
  }
  return bus;
}

/**
 * Subscribe to a bus topic for the lifetime of the calling component.
 * The handler ref is kept fresh so closures inside the handler always
 * see the latest props/state — callers don't need to memoize.
 */
export function useDiagramBusSubscribe<K extends DiagramBusTopic>(
  topic: K,
  handler: Handler<DiagramBusMessageMap[K]>,
): void {
  const bus = useDiagramBus();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    return bus.subscribe(topic, (payload) => handlerRef.current(payload));
  }, [bus, topic]);
}

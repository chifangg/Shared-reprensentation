import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

/**
 * A small, feature-agnostic channel for dropping extra entries INTO the
 * chat transcript at a specific point. Core owns the slot and the
 * interleaving; a feature (e.g. the diagram) provides the rendered
 * content, so core never learns what a "diagram action" actually is.
 *
 * Used to surface what a code-editing turn did to the diagram (a feature
 * refreshed on a block, a connection drawn) right under the agent reply
 * that caused it, instead of leaving that story only on the canvas.
 */
export type ChatActivityEntry = {
  /** Stable de-dupe key so a re-render never double-inserts. */
  id: string;
  /** Render this entry after the chat turn whose message-sequence range
   *  contains this value (a `_seq` from the just-finished turn). */
  afterSeq: number;
  /** Feature-provided content. Core renders it verbatim. */
  node: ReactNode;
};

type ChatActivityValue = {
  entries: ChatActivityEntry[];
  pushEntry: (entry: ChatActivityEntry) => void;
  clear: () => void;
};

const ChatActivityContext = createContext<ChatActivityValue | null>(null);

export function ChatActivityProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ChatActivityEntry[]>([]);
  const pushEntry = useCallback((entry: ChatActivityEntry) => {
    setEntries((prev) =>
      prev.some((e) => e.id === entry.id) ? prev : [...prev, entry],
    );
  }, []);
  const clear = useCallback(() => setEntries([]), []);
  return (
    <ChatActivityContext.Provider value={{ entries, pushEntry, clear }}>
      {children}
    </ChatActivityContext.Provider>
  );
}

export function useChatActivity(): ChatActivityValue {
  const ctx = useContext(ChatActivityContext);
  if (!ctx) {
    throw new Error("useChatActivity must be used within ChatActivityProvider");
  }
  return ctx;
}

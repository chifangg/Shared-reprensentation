import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { FileEntry } from "@/core/project";
import type { ClaudeMessage } from "@/core/hooks/useClaudeSession";
import type {
  DiagramArrow,
  DiagramBlock,
  DiagramView,
  FetchState,
} from "../types";
import { buildProjectContext } from "../api/buildProjectContext";
import { buildChatContext } from "../api/buildChatContext";
import { fetchFocusStream } from "../api/fetchFocus";

export type FocusState = {
  ids: string[];
  blocks: DiagramBlock[];
  arrows: DiagramArrow[];
};

/**
 * Owns adaptive-focus polling.
 *
 * Watches the user-message count of the chat. When it ticks up while
 * the diagram is ready, in focus view, and a project is loaded, waits
 * 1.2s (debounce — so an active streaming turn doesn't fire on every
 * intermediate chunk) and then POSTs to `/api/diagram?view=focus`
 * with the current chat context + the base schema labels. Streaming
 * `focus` / `detail_block` / `detail_arrow` events accumulate into
 * `focused` so the side-panel mini-graph can render them live.
 *
 * The freshest chat history is captured via an internal ref so the
 * deferred fetch picks up tokens that landed during the debounce
 * window without retriggering the effect on every chunk.
 *
 * Resets `focused` + `regenerating` on USER-initiated project change
 * (projectKey).
 */
export function useAdaptiveFocus({
  view,
  state,
  files,
  chatMessages,
  projectKey,
}: {
  view: DiagramView;
  state: FetchState;
  files: FileEntry[];
  chatMessages: ClaudeMessage[];
  projectKey: number;
}): {
  focused: FocusState | null;
  setFocused: Dispatch<SetStateAction<FocusState | null>>;
  regenerating: boolean;
  setRegenerating: Dispatch<SetStateAction<boolean>>;
} {
  const [focused, setFocused] = useState<FocusState | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Capture the freshest chat messages without retriggering the
  // debounced fetch effect on every assistant chunk.
  const chatMessagesRef = useRef(chatMessages);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  // Reset on user-initiated project change.
  useEffect(() => {
    setFocused(null);
    setRegenerating(false);
  }, [projectKey]);

  // Count completed user turns. A turn increment signals "user just
  // sent a new message", which is the cue to refocus.
  const userMessageCount = chatMessages.reduce(
    (n, m) => n + ((m as { type?: string }).type === "user" ? 1 : 0),
    0,
  );
  const lastUserCountRef = useRef(0);
  useEffect(() => {
    if (view !== "focus") return;
    if (state.kind !== "ready") return;
    if (files.length === 0) return;
    if (userMessageCount === lastUserCountRef.current) return;
    lastUserCountRef.current = userMessageCount;
    if (userMessageCount === 0) return;

    const controller = new AbortController();
    const debounceTimer = window.setTimeout(() => {
      const projectContext = buildProjectContext(files, null);
      const chatContext = buildChatContext(chatMessagesRef.current, 3);
      const baseSchemaJson = JSON.stringify({
        blocks: state.schema.blocks.map((b) => ({
          id: b.id,
          label: b.label,
          caption: b.caption,
        })),
      });
      setRegenerating(true);

      const newDetailBlocks: DiagramBlock[] = [];
      const newDetailArrows: DiagramArrow[] = [];
      const newFocusedIds: string[] = [];

      (async () => {
        try {
          await fetchFocusStream({
            projectContext,
            chatContext,
            baseSchemaJson,
            signal: controller.signal,
            onEvent: (evt) => {
              if (evt.kind === "focus") {
                // Accumulate ids but DON'T replace `focused` yet — if
                // the previous turn had detail blocks visible, blowing
                // them away the moment a new focus arrives makes the
                // panel flash empty. Wait for the first detail_block
                // (or stream end) to commit the swap.
                newFocusedIds.push(...evt.ids);
              } else if (evt.kind === "detail_block") {
                newDetailBlocks.push(evt.data);
                setFocused({
                  ids: [...newFocusedIds],
                  blocks: [...newDetailBlocks],
                  arrows: [...newDetailArrows],
                });
                setRegenerating(false);
              } else if (evt.kind === "detail_arrow") {
                newDetailArrows.push(evt.data);
                setFocused({
                  ids: [...newFocusedIds],
                  blocks: [...newDetailBlocks],
                  arrows: [...newDetailArrows],
                });
              }
            },
          });
          if (controller.signal.aborted) return;
          // Edge: focus event arrived but no detail_block ever did.
          // Commit at least the new ids so the panel reflects the new
          // turn rather than appearing stuck on the previous topic.
          if (newDetailBlocks.length === 0 && newFocusedIds.length > 0) {
            setFocused({
              ids: [...newFocusedIds],
              blocks: [],
              arrows: [],
            });
          }
          setRegenerating(false);
        } catch {
          if (controller.signal.aborted) return;
          setRegenerating(false);
        }
      })();
    }, 1200);

    return () => {
      window.clearTimeout(debounceTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMessageCount, view, files.length]);

  return { focused, setFocused, regenerating, setRegenerating };
}

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Connection } from "@xyflow/react";
import type { FileEntry } from "@/core/project";
import {
  serializeTarget,
  type ConnectionOption,
  type DiagramArrow,
  type DiagramBlock,
  type EditTarget,
  type FetchState,
} from "../types";
import {
  composeExecuteDirectPrompt,
  composeExecuteOptionPrompt,
  composeRenamePrompt,
  composeSuggestionsRound1Prompt,
} from "../protocol/prompts";
import type { DiagramBus } from "../protocol/bus";
import { useDiagramBusSubscribe } from "../protocol/bus";
import type { ChosenOption } from "./useChatSettleEffect";
import { dlog, dwarn } from "../util/debug";

/**
 * Owns the whole visual-edit / connection flow that the diagram canvas
 * drives: dropping a new arrow, the "actions" affordance on a block,
 * the add-new-block placeholder, the two-stage intent gate (describe
 * yourself vs ask Claude for suggestions), the floating cards overlay,
 * and the round-2 execute dispatch. Everything here either emits a
 * `visual-edit` prompt to the bus or manipulates the pending-arrow /
 * placeholder-block visuals + the gate / cards overlay state.
 *
 * The three bus subscribers (`option-executed`, `options-ready`,
 * `arrows-added`) live here too because they read and write the same
 * `chosenOptionsRef` / `pendingOptions` state and the schema.
 *
 * `chosenOptionsRef` is returned so the canvas can hand it to
 * `useChatSettleEffect`, which consumes the chosen options when the
 * round-2 turn settles.
 */
export function useVisualEditHandlers({
  state,
  setState,
  files,
  bus,
  dismissRecentEdit,
  setSelectedId,
}: {
  state: FetchState;
  setState: Dispatch<SetStateAction<FetchState>>;
  files: FileEntry[];
  bus: DiagramBus;
  /** Clears the "just edited" highlight + toast. Called from every
   *  user-action handler so the highlight survives until they act. */
  dismissRecentEdit: () => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}) {
  // Round-1 options Claude returned for the most-recent edit target
  // (arrow, block, or new-block). Set by the "options-ready" subscriber
  // (fired from ChatView once it parses the JSON). Cleared when the user
  // picks a card or cancels. Drives the floating cards overlay.
  const [pendingOptions, setPendingOptions] = useState<{
    target: EditTarget;
    options: ConnectionOption[];
  } | null>(null);
  // First-stage gate for arrow / block / new-block flows: before
  // anything is sent to chat, ask the user whether they want to
  // describe the change themselves (skip suggestions round-trip) or
  // ask Claude for suggestions (current cards flow). The visual side
  // (pending arrow / placeholder block) is already on canvas by the
  // time this state is set.
  const [intentGate, setIntentGate] = useState<{
    target: EditTarget;
  } | null>(null);

  /**
   * User asked to add a new module (clicked "+" or double-clicked the
   * empty canvas). We:
   *   1. Add a dashed-border placeholder block to the schema RIGHT NOW
   *      so the user gets immediate visual feedback ("yes I heard you,
   *      something is happening"). The placeholder lives in schema with
   *      pending=true and a generated id; auto-regen after Claude
   *      finishes will wipe it and surface the real block(s) instead.
   *   2. Open the intent gate so they can pick describe vs ask.
   */
  const handleAddNewBlock = useCallback(() => {
    if (state.kind !== "ready") return;
    dismissRecentEdit();
    const placeholderId = `__pending_new_${Date.now()}`;
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const placeholder: DiagramBlock = {
        id: placeholderId,
        label: "New module…",
        caption: "Waiting for you to describe it or pick a suggestion.",
        parent: null,
        provenance: { files: [], functions: [] },
        pending: true,
      };
      return {
        kind: "ready",
        schema: {
          blocks: [...prev.schema.blocks, placeholder],
          arrows: prev.schema.arrows,
        },
      };
    });
    setIntentGate({ target: { kind: "new-block" } });
  }, [state, dismissRecentEdit, setState]);

  /**
   * Commit a visual rename: update the local diagram schema so the
   * label change shows up immediately, then fire a chat prompt so
   * Claude rewrites the corresponding identifier(s) in source. This
   * is the slow-path side of the bidirectional loop — visual edit
   * shows up in chat as a user turn, Claude responds with edits, the
   * diff card renders in chat, code panel reflects the change.
   *
   * No-op if there's no diagram yet (state isn't "ready"), or if the
   * label didn't actually change.
   */
  const handleRenameBlock = useCallback(
    (blockId: string, newLabel: string) => {
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        const block = prev.schema.blocks.find((b) => b.id === blockId);
        if (!block) return prev;
        const oldLabel = block.label;
        if (oldLabel === newLabel) return prev;

        bus.emit("visual-edit", {
          prompt: composeRenamePrompt(block, newLabel),
          kind: "rename",
        });

        return {
          kind: "ready",
          schema: {
            blocks: prev.schema.blocks.map((b) =>
              b.id === blockId ? { ...b, label: newLabel } : b,
            ),
            arrows: prev.schema.arrows,
          },
        };
      });
    },
    [setState, bus],
  );

  /**
   * "Ask Claude for suggestions" path (round-1). Dispatches a prompt
   * asking Claude to list ≤5 options as JSON. The chat-side cards
   * renderer will surface them as canvas cards via the "options-ready"
   * bus topic. No code change in this round.
   */
  const dispatchSuggestionsRound1 = useCallback(
    (target: EditTarget) => {
      if (state.kind !== "ready") return;
      bus.emit("visual-edit", {
        prompt: composeSuggestionsRound1Prompt(target, state.schema),
        kind: "suggestions-round1",
      });
    },
    [state, bus],
  );

  /**
   * "Describe yourself" path: skip round-1 and go straight to a
   * round-2 execute, packing the user's free-text description as the
   * intent. Also fires "option-executed" with a synthesized option
   * (kind=detail) so the chatRunning settle effect knows what to do
   * with any pending arrow / placeholder block (default: drop arrow,
   * let auto-regen pick up real outcomes).
   */
  const dispatchExecuteDirect = useCallback(
    (target: EditTarget, userText: string) => {
      if (state.kind !== "ready") return;
      const trimmed = userText.trim();
      const synthOption: ConnectionOption = {
        title: trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed,
        detail: "User-described change.",
        kind: "detail",
      };
      bus.emit("option-executed", { target, option: synthOption });
      bus.emit("visual-edit", {
        prompt: composeExecuteDirectPrompt(
          target,
          state.schema,
          files,
          trimmed,
          synthOption.title,
        ),
        kind: "execute-direct",
      });
    },
    [state, files, bus],
  );

  /**
   * User dropped a new arrow. Add it to the schema with pending="claude"
   * (marching-ants) AND open the intent gate so they can pick whether
   * to describe the change themselves or have Claude suggest options.
   * No chat dispatch until the gate closes.
   */
  const handleAddConnection = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target) return;
      if (source === target) return;
      dismissRecentEdit();
      let opened = false;
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        const fromBlock = prev.schema.blocks.find((b) => b.id === source);
        const toBlock = prev.schema.blocks.find((b) => b.id === target);
        if (!fromBlock || !toBlock) return prev;
        const duplicate = prev.schema.arrows.some(
          (a) => a.from === source && a.to === target,
        );
        if (duplicate) return prev;
        const newArrow: DiagramArrow = {
          from: source,
          to: target,
          label: "",
          // "intent", NOT "claude": this arrow is the user's, awaiting the
          // intent gate / suggestion pick. The settle effect's "settle
          // leftover claude arrows" branch (which fires when the round-1
          // suggestions turn ends, before the user has picked) only touches
          // "claude" arrows, so keeping this "intent" leaves it blue-dashed
          // THROUGH round-1 and the execute edit. It settles only when the
          // execute turn completes (the arrow branch matches it by key).
          pending: "intent",
        };
        opened = true;
        return {
          kind: "ready",
          schema: {
            blocks: prev.schema.blocks,
            arrows: [...prev.schema.arrows, newArrow],
          },
        };
      });
      if (opened) {
        setIntentGate({ target: { kind: "arrow", from: source, to: target } });
      }
    },
    [dismissRecentEdit, setState],
  );

  /**
   * Round 2: chat-side card click fires "option-executed". We store the
   * winning option keyed by target; once chatRunning transitions to
   * false (the execute turn finishes), useChatSettleEffect applies the
   * outcome — label the arrow or drop it.
   */
  const chosenOptionsRef = useRef(
    new Map<string, ChosenOption>(), // key = serializeTarget(target)
  );
  useDiagramBusSubscribe("option-executed", (detail) => {
    if (!detail) return;
    chosenOptionsRef.current.set(serializeTarget(detail.target), {
      target: detail.target,
      option: detail.option,
    });

    // For new-block: rename the next unclaimed placeholder eagerly so
    // any arrows-added Claude emits during this turn can resolve its
    // label. Without this, the placeholder stays "New module…" until
    // the chatRunning settle runs (after Claude is fully done), so any
    // mid-stream arrows-added → resolveId silently drops every arrow
    // pointing at the new block. We keep `pending: true` so the dashed
    // border still signals "Claude is implementing this".
    if (detail.target.kind === "new-block") {
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        let claimed = false;
        const nextBlocks = prev.schema.blocks.map((b) => {
          if (claimed) return b;
          if (!b.pending || !b.id.startsWith("__pending_new_")) return b;
          if (b.label !== "New module…") return b;
          claimed = true;
          return {
            ...b,
            label: detail.option.title.slice(0, 40),
            caption: detail.option.detail.slice(0, 200) || b.caption,
          };
        });
        if (!claimed) return prev;
        return {
          kind: "ready",
          schema: { blocks: nextBlocks, arrows: prev.schema.arrows },
        };
      });
    }
  });

  /**
   * Receive parsed round-1 options from ChatView and surface them as
   * a floating cards overlay on the canvas. Also clears any stale
   * chosen-option for the same target — this catches the case where
   * the user took the "Describe yourself" path with vague text and
   * Claude bailed out with options instead of executing (we'd have
   * pre-fired "option-executed" optimistically; cancel it).
   */
  useDiagramBusSubscribe("options-ready", (detail) => {
    if (!detail) return;
    chosenOptionsRef.current.delete(serializeTarget(detail.target));
    setPendingOptions({ target: detail.target, options: detail.options });
  });

  /**
   * ChatView dispatches this when Claude's response includes a trailing
   * `added_arrows` JSON block. We resolve block labels → ids against
   * the current schema and append arrows with pending="claude" so they
   * render with marching-ants until the chatRunning settle. Duplicates
   * (same from→to direction) and unresolved labels are silently
   * dropped — Claude sometimes hallucinates labels.
   */
  useDiagramBusSubscribe("arrows-added", (detail) => {
    if (!detail || detail.arrows.length === 0) return;
    dlog("recent-debug:arrows-added handler", {
      detailArrows: detail.arrows,
    });
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const resolveId = (label: string): string | null => {
        const lc = label.trim().toLowerCase();
        const exact = prev.schema.blocks.find(
          (b) => b.label.toLowerCase() === lc,
        );
        if (exact) return exact.id;
        // Fuzzy: substring match either way.
        const fuzzy = prev.schema.blocks.find(
          (b) =>
            b.label.toLowerCase().includes(lc) ||
            lc.includes(b.label.toLowerCase()),
        );
        if (!fuzzy) {
          // Surface mismatches in dev — silently dropping arrows
          // makes it impossible to tell whether Claude forgot to
          // emit them vs. emitted wrong labels.
          dwarn(
            "diagram",
            `added_arrows label "${label}" did not match any block. Existing labels:`,
            prev.schema.blocks.map((b) => b.label),
          );
        }
        return fuzzy?.id ?? null;
      };
      const toAdd: DiagramArrow[] = [];
      for (const a of detail.arrows) {
        const from = resolveId(a.from);
        const to = resolveId(a.to);
        if (!from || !to || from === to) continue;
        // Skip an arrow if ANY arrow already connects this pair, in
        // EITHER direction: a same-pair anti-parallel arrow (e.g. the
        // user drew A->B and Claude proposes B->A) renders as a confusing
        // "writes / writes" double line. One arrow per pair is enough.
        const exists = prev.schema.arrows.some(
          (x) =>
            (x.from === from && x.to === to) ||
            (x.from === to && x.to === from),
        );
        if (exists) continue;
        if (
          toAdd.some(
            (x) =>
              (x.from === from && x.to === to) ||
              (x.from === to && x.to === from),
          )
        )
          continue;
        toAdd.push({
          from,
          to,
          label: a.label?.trim() || "uses",
          pending: "claude",
        });
      }
      if (toAdd.length === 0) return prev;
      dlog("recent-debug:arrows-added applied", {
        toAdd: toAdd.map((a) => `${a.from}->${a.to}(${a.label})`),
      });
      return {
        kind: "ready",
        schema: {
          blocks: prev.schema.blocks,
          arrows: [...prev.schema.arrows, ...toAdd],
        },
      };
    });
  });

  /**
   * User picked a card (or submitted "Others"). Fire "option-executed"
   * so the diagram's own listener captures the chosen option keyed by
   * target; fire "visual-edit" to send the round-2 execute prompt;
   * clear the overlay.
   */
  const handlePickOption = useCallback(
    (option: ConnectionOption) => {
      if (!pendingOptions) return;
      if (state.kind !== "ready") return;
      const { target } = pendingOptions;

      bus.emit("option-executed", { target, option });
      bus.emit("visual-edit", {
        prompt: composeExecuteOptionPrompt(
          target,
          state.schema,
          files,
          option,
        ),
        kind: "execute-option",
      });
      setPendingOptions(null);
    },
    [pendingOptions, state, files, bus],
  );

  /** Strip any pending arrow / placeholder block tied to the target
   *  out of the schema. Shared by "cancel intent gate" and "cancel
   *  cards overlay" paths (both want the on-canvas placeholder gone). */
  const removeTargetVisual = useCallback(
    (target: EditTarget) => {
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        if (target.kind === "arrow") {
          const { from, to } = target;
          return {
            kind: "ready",
            schema: {
              blocks: prev.schema.blocks,
              arrows: prev.schema.arrows.filter(
                (a) => !(a.from === from && a.to === to && a.pending),
              ),
            },
          };
        }
        if (target.kind === "new-block") {
          return {
            kind: "ready",
            schema: {
              blocks: prev.schema.blocks.filter((b) => !b.pending),
              arrows: prev.schema.arrows,
            },
          };
        }
        return prev;
      });
    },
    [setState],
  );

  /** "Cancel" on the cards overlay: clear the cards + drop any
   *  on-canvas placeholder tied to the target. */
  const handleCancelOptions = useCallback(() => {
    if (!pendingOptions) return;
    removeTargetVisual(pendingOptions.target);
    setPendingOptions(null);
  }, [pendingOptions, removeTargetVisual]);

  /** Intent gate: user picked "Ask Claude for suggestions". Fire the
   *  round-1 prompt; the cards UI will land in pendingOptions when
   *  ChatView parses the response. */
  const handleIntentGateAskSuggestions = useCallback(() => {
    if (!intentGate) return;
    dispatchSuggestionsRound1(intentGate.target);
    setIntentGate(null);
  }, [intentGate, dispatchSuggestionsRound1]);

  /** Intent gate: user picked "Describe yourself" + submitted text.
   *  Skip round-1 and dispatch a self-contained execute prompt. */
  const handleIntentGateDescribe = useCallback(
    (text: string) => {
      if (!intentGate) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      dispatchExecuteDirect(intentGate.target, trimmed);
      setIntentGate(null);
    },
    [intentGate, dispatchExecuteDirect],
  );

  /** Intent gate cancel: drop any on-canvas placeholder. */
  const handleIntentGateCancel = useCallback(() => {
    if (!intentGate) return;
    removeTargetVisual(intentGate.target);
    setIntentGate(null);
  }, [intentGate, removeTargetVisual]);

  /**
   * User clicked the "⋯" affordance on a block. Select the block (so
   * the user gets visual feedback that "this is the block I'm acting
   * on") and open the intent gate so they can pick describe vs ask.
   */
  const handleBlockAction = useCallback(
    (blockId: string) => {
      if (state.kind !== "ready") return;
      if (!state.schema.blocks.some((b) => b.id === blockId)) return;
      dismissRecentEdit();
      setSelectedId(blockId);
      setIntentGate({ target: { kind: "block", id: blockId } });
    },
    [state, dismissRecentEdit, setSelectedId],
  );

  return {
    pendingOptions,
    intentGate,
    chosenOptionsRef,
    handleAddConnection,
    handlePickOption,
    handleCancelOptions,
    dispatchExecuteDirect,
    handleAddNewBlock,
    handleRenameBlock,
    handleBlockAction,
    handleIntentGateAskSuggestions,
    handleIntentGateDescribe,
    handleIntentGateCancel,
  };
}

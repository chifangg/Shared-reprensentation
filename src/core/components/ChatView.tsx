import { useEffect, useMemo, useRef } from "react";
import {
  useClaudeSession,
  type ClaudeMessage,
  type PendingToolCall,
} from "@/core/hooks/useClaudeSession";
import { PromptInput } from "@/core/components/PromptInput";
import { ThinkingBubble } from "@/core/components/ThinkingBubble";
import { Markdown } from "@/core/components/Markdown";
import {
  clientToolRegistry,
  toolResultRegistry,
} from "@/core/tools/registry";
import { Bot, User, Upload, Sparkles } from "lucide-react";
import { useProject, buildChatSystemPrompt } from "@/core/project";
import {
  ArrowsAddedSink,
  OptionsHandoff,
  parseOptionsBlock,
  parseTargetMetadata,
  parseVisualEditMessage,
  stripJsonCodeBlocks,
  useDiagramBusSubscribe,
  type EditTarget,
} from "@/features/diagram";

/**
 * Default customer-facing chat view. Renders turns as bubbles, collapses
 * thinking blocks, and inlines client-tool calls as live components —
 * paired with the originating `tool_use` block via (name, input) match
 * so the picker renders in conversation flow, not as a dock.
 *
 * This is the seam forks edit most. Swap bubble styling, add avatars,
 * add rich tool-result cards, etc. The logical core (message projection,
 * pending-call correlation, tool-call routing) stays here and in
 * `useClaudeSession`.
 */
export function ChatView({ model }: { model?: string }) {
  const session = useClaudeSession({ model });
  const { files, setChatMessages, setChatRunning } = useProject();
  const running = session.status === "running";

  const hasFiles = files.length > 0;

  // Publish chat history into ProjectContext so other panels (notably
  // the Diagram canvas in adaptive-focus mode) can react to it.
  useEffect(() => {
    setChatMessages(session.messages);
  }, [session.messages, setChatMessages]);

  // Publish "is Claude currently busy?" so sibling panels can react —
  // diagram uses this to clear the marching-ants "pending" style on
  // user-pulled arrows once Claude has finished reacting to them.
  useEffect(() => {
    setChatRunning(running);
  }, [running, setChatRunning]);

  const handleNewChat = () => {
    session.reset();
  };

  const handleSend = (prompt: string) => {
    const isFirstTurn = session.messages.length === 0;
    if (isFirstTurn && hasFiles) {
      const context = buildChatSystemPrompt(files, null);
      session.send(prompt, { append_system_prompt: context });
    } else {
      session.send(prompt);
    }
  };

  // Bridge: diagram-side visual edits (e.g. inline-rename a block)
  // emit a "visual-edit" bus message carrying a pre-formatted prompt;
  // we route it through the same `handleSend` path so the visual edit
  // shows up in conversation alongside typed messages.
  useDiagramBusSubscribe("visual-edit", (detail) => {
    if (!detail?.prompt) return;
    if (running) return; // ignore mid-turn; Claude is busy
    handleSend(detail.prompt);
  });

  const turns = useMemo(() => projectTurns(session.messages), [session.messages]);

  // `tool_use.id` → bare tool name. Used by `tool_result` bubbles to
  // look up a custom result renderer, since those blocks only carry
  // `tool_use_id`.
  const toolNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of turns) {
      if (t.role !== "assistant") continue;
      for (const b of t.blocks) {
        if (b.kind === "tool_use") m.set(b.id, stripMcpPrefix(b.name));
      }
    }
    return m;
  }, [turns]);

  // Set of `tool_use.id`s that already have a `tool_result`. Used to
  // stop rendering the live input component once Claude has received a
  // result for that call (either because the user resolved it or the
  // backend timed out).
  const resolvedToolUseIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of turns) {
      if (t.role !== "assistant") continue;
      for (const b of t.blocks) {
        if (b.kind === "tool_result") s.add(b.tool_use_id);
      }
    }
    return s;
  }, [turns]);

  // Correlate each pending client-tool call to a `tool_use` block by
  // matching tool name + JSON-equal input. FIFO on both sides, so two
  // pending calls of the same tool with the same input get paired in
  // insertion order (rare but defensive).
  //
  // The two IDs are unrelated on the wire — backend-generated
  // `tool_call_id` vs. Claude-generated `tool_use.id` — so we need this
  // matching pass to render the live component alongside the right
  // bubble. See docs/tools.md for the full id story.
  const pendingByToolUseId = useMemo(() => {
    const out = new Map<string, PendingToolCall>();
    const used = new Set<string>();
    for (const t of turns) {
      if (t.role !== "assistant") continue;
      for (const b of t.blocks) {
        if (b.kind !== "tool_use") continue;
        if (resolvedToolUseIds.has(b.id)) continue;
        const name = stripMcpPrefix(b.name);
        const match = session.pendingToolCalls.find(
          (p) =>
            !used.has(p.tool_call_id) &&
            p.name === name &&
            stableStringify(p.input) === stableStringify(b.input),
        );
        if (match) {
          used.add(match.tool_call_id);
          out.set(b.id, match);
        }
      }
    }
    return out;
  }, [turns, session.pendingToolCalls, resolvedToolUseIds]);

  // Safety net: if a `tool_result` arrived for a pending call (e.g. the
  // backend timed out and Claude got an error result), the live
  // component would otherwise sit forever. Drop the pending entry.
  useEffect(() => {
    const toRemove: string[] = [];
    for (const p of session.pendingToolCalls) {
      const pairedToolUseId = [...pendingByToolUseId.entries()].find(
        ([, pp]) => pp.tool_call_id === p.tool_call_id,
      )?.[0];
      if (pairedToolUseId && resolvedToolUseIds.has(pairedToolUseId)) {
        toRemove.push(p.tool_call_id);
      }
    }
    for (const id of toRemove) session.removePendingToolCall(id);
    // `session.removePendingToolCall` is stable (useCallback).
  }, [
    pendingByToolUseId,
    resolvedToolUseIds,
    session.pendingToolCalls,
    session.removePendingToolCall,
  ]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, session.pendingToolCalls.length, running]);

  return (
    <div className="flex h-full w-full flex-col bg-[#0F0F0F] text-[#E5E5E5]">
      <header className="flex h-11 items-center justify-between border-b border-[#2A2A2A] bg-[#1A1A1A] px-4">
        <div className="text-sm font-medium text-[#E5E5E5]">Chat</div>
        <button
          onClick={handleNewChat}
          className="rounded-md border border-[#2A2A2A] bg-[#242424] px-2.5 py-1 text-xs text-[#AAAAAA] transition-colors hover:bg-[#2F2F2F] hover:text-[#E5E5E5]"
        >
          New chat
        </button>
      </header>
      <div className="flex items-center gap-2 border-b border-[#1F1F1F] bg-[#141414] px-4 py-2 font-mono text-[11px] text-[#666666]">
        <span className="shrink-0">session {session.sessionId.slice(0, 8)}</span>
        <span className="text-[#333333]">·</span>
        <span className="shrink-0">
          {hasFiles ? `${files.length} files loaded` : "no project"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {turns.length === 0 && !hasFiles && <NoProjectPrompt />}
        {turns.length === 0 && hasFiles && <ReadyPrompt />}
        {turns.map((t, idx) => {
          // For assistant turns: look back to the immediately preceding
          // user turn and parse out the diagram-edit target sentinel,
          // if any. Cards rendered inside this turn need the target to
          // fire OPTION_EXECUTED_EVENT correctly when the user clicks
          // one (so the diagram knows what to do with the chosen kind).
          let editTarget: EditTarget | null = null;
          if (t.role === "assistant") {
            for (let j = idx - 1; j >= 0; j--) {
              const prev = turns[j];
              if (prev.role !== "user") continue;
              editTarget = parseTargetMetadata(prev.text);
              break;
            }
          }
          return (
            <TurnBubble
              key={t.key}
              turn={t}
              editTarget={editTarget}
              pendingByToolUseId={pendingByToolUseId}
              resolvedToolUseIds={resolvedToolUseIds}
              toolNameById={toolNameById}
              onResolve={session.resolveToolCall}
            />
          );
        })}
        {running && turns[turns.length - 1]?.role === "user" && (
          <ThinkingBubble />
        )}
        <div ref={endRef} />
      </div>

      {session.error && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-[#2A2A2A] bg-red-950/30 p-2 font-mono text-xs text-red-300">
          {session.error}
        </pre>
      )}

      <PromptInput
        onSubmit={handleSend}
        onCancel={session.cancel}
        disabled={running || !hasFiles}
        running={running}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message → turn projection.
// Stream-json arrives as a flat sequence of {type: "user"|"assistant"|...}.
// For display we group contiguous entries into "turns" and extract the
// rendering-relevant bits.
// ---------------------------------------------------------------------------

type Turn =
  | {
      role: "user";
      key: number;
      text: string;
    }
  | {
      role: "assistant";
      key: number;
      blocks: AssistantBlock[];
    };

type AssistantBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; tool_use_id: string; content: unknown };

function projectTurns(messages: ClaudeMessage[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    const type = m["type"] as string | undefined;
    const inner = (m["message"] as any)?.content;
    if (type === "user") {
      if (typeof inner === "string") {
        out.push({ role: "user", key: m._seq, text: inner });
      } else if (Array.isArray(inner)) {
        const last = out[out.length - 1];
        if (last && last.role === "assistant") {
          for (const b of inner) {
            if (b?.type === "tool_result") {
              last.blocks.push({
                kind: "tool_result",
                tool_use_id: b.tool_use_id,
                content: b.content,
              });
            }
          }
        }
      }
    } else if (type === "assistant" && Array.isArray(inner)) {
      const blocks: AssistantBlock[] = [];
      for (const b of inner) {
        if (b?.type === "text") blocks.push({ kind: "text", text: b.text });
        else if (b?.type === "thinking")
          blocks.push({ kind: "thinking", text: b.thinking ?? "" });
        else if (b?.type === "tool_use") {
          blocks.push({ kind: "tool_use", id: b.id, name: b.name, input: b.input });
        }
      }
      const last = out[out.length - 1];
      if (last && last.role === "assistant") {
        last.blocks.push(...blocks);
      } else {
        out.push({ role: "assistant", key: m._seq, blocks });
      }
    }
  }
  return out;
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#2A2A2A] bg-[#242424] text-[#888888]">
        <User size={12} />
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#3B5BD9]/30 bg-[#3B5BD9]/15 text-[#7B96E8]">
      <Bot size={12} />
    </div>
  );
}

function TurnBubble({
  turn,
  editTarget,
  pendingByToolUseId,
  resolvedToolUseIds,
  toolNameById,
  onResolve,
}: {
  turn: Turn;
  /** Set when this turn (assistant) is replying about a freshly-drawn
   *  arrow, a clicked block, or a new-block request — gives downstream
   *  cards the target context to fire back when the user picks one. */
  editTarget: EditTarget | null;
  pendingByToolUseId: Map<string, PendingToolCall>;
  resolvedToolUseIds: Set<string>;
  toolNameById: Map<string, string>;
  onResolve: (id: string, content: unknown) => void;
}) {
  if (turn.role === "user") {
    const visualEdit = parseVisualEditMessage(turn.text);
    if (visualEdit) {
      return (
        <div className="rounded-lg border border-[#3B5BD9]/30 bg-[#1A1A20] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-[#7B96E8]" />
            <span className="text-xs text-[#7B96E8]/80">diagram edit</span>
            <span className="text-sm font-medium text-[#E5E5E5]">
              {visualEdit.summary}
            </span>
            {visualEdit.body && (
              <details className="ml-auto text-xs text-[#888888]">
                <summary className="cursor-pointer select-none hover:text-[#AAAAAA]">
                  see prompt
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-[#999999]">
                  {visualEdit.body}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Avatar role="user" />
          <span className="text-xs text-[#888888]">You</span>
        </div>
        <div className="whitespace-pre-wrap text-sm text-[#E5E5E5]">
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Avatar role="assistant" />
        <span className="text-xs text-[#888888]">Assistant</span>
      </div>
      <div className="space-y-2 text-sm text-[#E5E5E5]">
        {turn.blocks.map((b, i) => (
          <AssistantBlockView
            key={i}
            block={b}
            editTarget={editTarget}
            pendingByToolUseId={pendingByToolUseId}
            resolvedToolUseIds={resolvedToolUseIds}
            toolNameById={toolNameById}
            onResolve={onResolve}
          />
        ))}
      </div>
    </div>
  );
}

function AssistantBlockView({
  block,
  editTarget,
  pendingByToolUseId,
  resolvedToolUseIds,
  toolNameById,
  onResolve,
}: {
  block: AssistantBlock;
  editTarget: EditTarget | null;
  pendingByToolUseId: Map<string, PendingToolCall>;
  resolvedToolUseIds: Set<string>;
  toolNameById: Map<string, string>;
  onResolve: (id: string, content: unknown) => void;
}) {
  if (block.kind === "text") {
    // Round-1 of an arrow / block / new-block flow: Claude returned a
    // JSON options block. The cards UI itself lives on the canvas, so
    // here we just (a) push the parsed options + target across to the
    // diagram via OPTIONS_READY_EVENT and (b) render a minimal prompt
    // pointing the user at the canvas. Falls back to plain markdown
    // if parsing fails (Claude went off-format).
    const parsed = editTarget ? parseOptionsBlock(block.text) : null;
    if (parsed && editTarget) {
      return (
        <OptionsHandoff options={parsed.options} target={editTarget} />
      );
    }
    // Round-2 may include an added_arrows JSON tail describing real
    // dependencies just wired in code. Push those to the diagram and
    // continue to render the human-readable summary text as markdown.
    return (
      <>
        <ArrowsAddedSink text={block.text} />
        <Markdown>{stripJsonCodeBlocks(block.text)}</Markdown>
      </>
    );
  }
  if (block.kind === "thinking") {
    return (
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">thinking…</summary>
        <Markdown className="pt-1 prose-xs">{block.text}</Markdown>
      </details>
    );
  }
  if (block.kind === "tool_use") {
    const name = stripMcpPrefix(block.name);
    const pending = pendingByToolUseId.get(block.id);
    const isResolved = resolvedToolUseIds.has(block.id);
    const Component = pending ? clientToolRegistry[pending.name] : undefined;

    if (!isResolved && pending && Component) {
      return (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Claude is asking: <code className="font-mono">{pending.name}</code>
          </div>
          <Component
            input={pending.input}
            resolve={(content) => onResolve(pending.tool_call_id, content)}
          />
        </div>
      );
    }
    return (
      <div className="rounded bg-background/50 p-2 text-xs">
        <span className="font-mono">tool</span> · {name}
      </div>
    );
  }
  if (block.kind === "tool_result") {
    const toolName = toolNameById.get(block.tool_use_id);
    const ResultComponent = toolName
      ? toolResultRegistry[toolName]
      : undefined;
    const parsed = parseToolResultContent(block.content);

    if (ResultComponent) {
      return (
        <ResultComponent
          content={parsed.value}
          toolUseId={block.tool_use_id}
        />
      );
    }
    return (
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">tool result</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-background/50 p-2">
          {parsed.preview}
        </pre>
      </details>
    );
  }
  return null;
}

/** Strip the MCP server prefix (`mcp__template-tools__`) off a tool name. */
function stripMcpPrefix(name: string): string {
  return name.replace(/^mcp__[^_]+(?:__)?/, "");
}

/**
 * Order-stable JSON stringify used to compare tool inputs across
 * Claude's stream-json and the backend's `tool_call_for_ui` payload.
 * Object key order isn't guaranteed to match across the two paths, so
 * sort before stringifying.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, sortedReplacer);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * The wire shape of `tool_result.content` is either a plain string or
 * an array of content blocks like `[{type:"text", text:"<json>"}]`
 * (the bridge currently always emits the array form). Flatten to a
 * single text preview, then try to parse as JSON so custom renderers
 * get a structured value.
 */
function parseToolResultContent(raw: unknown): {
  value: unknown;
  preview: string;
} {
  const preview =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw
            .map((c: any) => (c?.type === "text" ? c.text : JSON.stringify(c)))
            .join("\n")
        : JSON.stringify(raw);
  try {
    return { value: JSON.parse(preview), preview };
  } catch {
    return { value: preview, preview };
  }
}

/**
 * Step 1 of the chat onboarding flow: shown when no project has been
 * uploaded yet. The chat is effectively gated until files arrive.
 */
function NoProjectPrompt() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-[#888888]">
      <Upload size={28} className="opacity-40" />
      <p>Upload a project in the Files panel to begin.</p>
    </div>
  );
}

function ReadyPrompt() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-[#666666]">
      <p>Project loaded. Type a message below to start.</p>
    </div>
  );
}

/**
 * Try to find a JSON code block of shape `{ "options": [...] }` in an
 * assistant text response. Returns the validated option list, or null
 * if the body doesn't fit the schema (parse error, missing fields,
 * unknown kind). Lenient on surrounding prose, strict on shape.
 */
// Diagram-protocol parsers + sink components (parseOptionsBlock,
// parseAddedArrowsBlock, allJsonBlocks, stripJsonCodeBlocks,
// ArrowsAddedSink, OptionsHandoff) moved to
// @/features/diagram/protocol/{parsers,ChatBridge}. ChatView imports
// them as small JSX building blocks and stays unaware of the JSON
// shapes / bus topics underneath.


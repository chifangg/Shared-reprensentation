import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { Button } from "@/components/ui/button";
import { Bot, User, Upload } from "lucide-react";
import { useProject, buildProjectContext, type FileEntry } from "@/core/project";

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
  const { files, goal, setGoal, chatTheme, setChatTheme } = useProject();
  const running = session.status === "running";

  const hasFiles = files.length > 0;
  const hasGoal = goal != null && goal.trim() !== "";

  // "New chat" should reset the conversation AND the goal — different
  // chats may pursue different goals on the same project.
  const handleNewChat = () => {
    session.reset();
    setGoal(null);
  };

  // Wrap session.send so the first turn carries the project context as
  // a system prompt — Claude reads it but it doesn't appear in the
  // chat bubble. Subsequent turns rely on Claude's session memory for
  // the same session-id; resending the full project on every turn
  // would burn tokens with no benefit.
  const handleSend = (prompt: string) => {
    const isFirstTurn = session.messages.length === 0;
    if (isFirstTurn && hasFiles && hasGoal) {
      const context = buildProjectContext(files, goal);
      session.send(prompt, { append_system_prompt: context });
    } else {
      session.send(prompt);
    }
  };

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
    <div className="flex h-full w-full flex-col bg-[#B7B0A7]/90 text-[#484848]">
      <header className="flex h-11 items-center justify-between border-b border-[#484848]/30 bg-[#DFDEDE]/90 px-4">
        <div className="text-sm font-medium text-[#484848]">
          Chat Block
        </div>
        <button
          onClick={handleNewChat}
          className="rounded-full bg-[#888787]/75 px-3 py-1 text-xs text-white hover:bg-[#888787]/90"
        >
          New chat
        </button>
      </header>
      <div className="flex items-center px-4 py-2 text-xs text-[#484848]/70">
        <span className="shrink-0">Session No. {session.sessionId.slice(0, 8)}</span>
        <span className="mx-2 shrink-0">|</span>
        <span className="shrink-0">Chat Theme:</span>
        <span className="ml-1 truncate" title={goal ?? undefined}>
          {chatTheme ?? (goal ? summarizeGoal(goal) : "—")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {turns.length === 0 && !hasFiles && <NoProjectPrompt />}
        {turns.length === 0 && hasFiles && !hasGoal && (
          <GoalInput onSubmit={(text) => setGoal(text)} />
        )}
        {turns.length === 0 && hasFiles && hasGoal && (
          <GoalSuggestions
            goal={goal}
            files={files}
            onPick={handleSend}
            onTitle={setChatTheme}
          />
        )}
        {turns.map((t) => (
          <TurnBubble
            key={t.key}
            turn={t}
            pendingByToolUseId={pendingByToolUseId}
            resolvedToolUseIds={resolvedToolUseIds}
            toolNameById={toolNameById}
            onResolve={session.resolveToolCall}
          />
        ))}
        {/* Show the thinking animation while a prompt is in flight and
            no assistant turn has started yet (i.e., Claude hasn't
            produced a text/tool_use block for this turn). */}
        {running && turns[turns.length - 1]?.role === "user" && (
          <ThinkingBubble />
        )}
        <div ref={endRef} />
      </div>

      {session.error && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t bg-destructive/10 p-2 font-mono text-xs text-destructive">
          {session.error}
        </pre>
      )}

      <PromptInput
        onSubmit={handleSend}
        onCancel={session.cancel}
        disabled={running || !hasGoal}
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
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#484848] text-white">
        <User size={14} />
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EAEAEA] text-[#484848]">
      <Bot size={14} />
    </div>
  );
}

function TurnBubble({
  turn,
  pendingByToolUseId,
  resolvedToolUseIds,
  toolNameById,
  onResolve,
}: {
  turn: Turn;
  pendingByToolUseId: Map<string, PendingToolCall>;
  resolvedToolUseIds: Set<string>;
  toolNameById: Map<string, string>;
  onResolve: (id: string, content: unknown) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[80%] rounded-3xl bg-[#484848] px-4 py-2 text-sm text-white">
          {turn.text}
        </div>
        <Avatar role="user" />
      </div>
    );
  }
  return (
    <div className="flex items-start justify-start gap-2">
      <Avatar role="assistant" />
      <div className="w-full max-w-[85%] space-y-2 rounded-2xl bg-[#EAEAEA] px-4 py-3 text-sm text-[#484848]">
        {turn.blocks.map((b, i) => (
          <AssistantBlockView
            key={i}
            block={b}
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
  pendingByToolUseId,
  resolvedToolUseIds,
  toolNameById,
  onResolve,
}: {
  block: AssistantBlock;
  pendingByToolUseId: Map<string, PendingToolCall>;
  resolvedToolUseIds: Set<string>;
  toolNameById: Map<string, string>;
  onResolve: (id: string, content: unknown) => void;
}) {
  if (block.kind === "text") {
    return <Markdown>{block.text}</Markdown>;
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
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-[#484848]/70">
      <Upload size={28} className="opacity-50" />
      <p>Upload a project in the Files panel to begin.</p>
    </div>
  );
}

/**
 * Step 2: a project is loaded but the user hasn't told us what they're
 * trying to do. Capture a one-sentence goal — that becomes the chat
 * theme and seeds personalized starter prompts.
 */
function GoalInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) onSubmit(trimmed);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div className="flex h-full items-center justify-center pb-16">
      <div className="w-full max-w-md rounded-2xl bg-white/40 p-5">
        <h3 className="mb-1 text-sm font-medium text-[#484848]">
          What's your primary goal?
        </h3>
        <p className="mb-4 text-xs text-[#484848]/70">
          One sentence is enough! We'll use it to tailor the conversation and the starter prompts below.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. add a dark mode toggle to the settings page"
          rows={3}
          className="mb-3 w-full resize-none rounded-lg border border-[#484848]/15 bg-white/80 p-2 text-sm text-[#484848] placeholder:text-[#484848]/40 outline-none"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="w-full rounded-full bg-[#3d3a35] px-4 py-2 text-xs text-white hover:bg-[#2a2724] disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

/**
 * Step 3: goal captured, no conversation yet. Render a few starter
 * prompts that incorporate the user's goal verbatim. Phase 1 uses
 * static templates; Phase 2 will replace this with Claude-generated
 * suggestions seeded by goal + project tree.
 */
type SuggestionsState =
  | { kind: "loading" }
  | { kind: "ready"; suggestions: string[] }
  | { kind: "error"; message: string };

function GoalSuggestions({
  goal,
  files,
  onPick,
  onTitle,
}: {
  goal: string;
  files: FileEntry[];
  onPick: (prompt: string) => void;
  onTitle: (title: string) => void;
}) {
  const [state, setState] = useState<SuggestionsState>({ kind: "loading" });

  // Mount-only: fire one request to /api/suggestions with the project
  // context + goal. Returns both a chat-theme title and 3 starter
  // suggestions in one round-trip — the title is reported up to the
  // ProjectContext via onTitle.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    const projectContext = buildProjectContext(files, goal);

    fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_context: projectContext }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (
          res.success &&
          res.data &&
          Array.isArray(res.data.suggestions) &&
          res.data.suggestions.length > 0
        ) {
          if (typeof res.data.title === "string" && res.data.title) {
            onTitle(res.data.title);
          }
          setState({ kind: "ready", suggestions: res.data.suggestions });
        } else {
          setState({
            kind: "error",
            message: res.error || "No suggestions returned",
          });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ kind: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
    };
    // We snapshot files+goal at mount; refiring on every keystroke would
    // be wasteful and disorienting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full items-center justify-center pb-16">
      <div className="flex w-full max-w-md flex-col gap-2 rounded-2xl bg-white/40 p-5">
        <p className="mb-1 text-xs text-[#484848]/70">
          {state.kind === "loading"
            ? "Generating suggestions based on your project…"
            : state.kind === "error"
              ? "Couldn't generate suggestions"
              : "Suggested starting prompts:"}
        </p>
        {state.kind === "loading" && <SuggestionSkeleton />}
        {state.kind === "ready" &&
          state.suggestions.map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              className="h-auto justify-start whitespace-normal py-2 text-left"
              onClick={() => onPick(s)}
            >
              {s}
            </Button>
          ))}
        {state.kind === "error" && (
          <p className="text-xs text-red-700/80">{state.message}</p>
        )}
      </div>
    </div>
  );
}

function SuggestionSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-9 w-full animate-pulse rounded-md bg-[#484848]/10" />
      <div className="h-9 w-full animate-pulse rounded-md bg-[#484848]/10" />
      <div className="h-9 w-full animate-pulse rounded-md bg-[#484848]/10" />
    </div>
  );
}

/**
 * Compress a goal sentence into a chat-theme label that fits in the
 * header strip. First ~5 words capped at ~35 chars; the full goal is
 * available on hover via the `title` attribute.
 */
function summarizeGoal(goal: string): string {
  const trimmed = goal.trim();
  const words = trimmed.split(/\s+/);
  let acc = "";
  for (let i = 0; i < Math.min(words.length, 5); i++) {
    const next = acc ? `${acc} ${words[i]}` : words[i];
    if (next.length > 35) break;
    acc = next;
  }
  return acc.length < trimmed.length ? `${acc}…` : acc;
}


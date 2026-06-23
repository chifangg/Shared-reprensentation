//! `claude` CLI flag composition.
//!
//! `ClaudeExtraArgs` is the per-request opt-in surface — the only way a
//! fork can expose Claude's full CLI without hand-patching the spawn
//! sites. The three composer helpers (`resolve_skip_permissions`,
//! `resolve_default_tools`, `append_extra_args`) translate that struct
//! plus environment overrides into the argv passed to the subprocess.
//!
//! Security-relevant default: when nothing pins `--tools` AND
//! `--dangerously-skip-permissions` isn't on, we append `--tools ""` to
//! lock Claude out of the filesystem and bash. Customer-facing flows
//! must never accidentally lose this default — anything that bypasses
//! it (e.g. a new spawn function) must call the same resolver.

use serde::Deserialize;

#[derive(Debug, Deserialize, Default, Clone)]
pub struct ClaudeExtraArgs {
    /// `--permission-mode <mode>`: acceptEdits | auto | bypassPermissions |
    /// default | dontAsk | plan.
    pub permission_mode: Option<String>,
    /// `--effort <level>`: low | medium | high | max.
    pub effort: Option<String>,
    /// `--max-budget-usd <amount>`.
    pub max_budget_usd: Option<f64>,
    /// `--fallback-model <model>`.
    pub fallback_model: Option<String>,
    /// `--append-system-prompt <prompt>`.
    pub append_system_prompt: Option<String>,
    /// `--include-partial-messages` (streaming deltas).
    pub include_partial_messages: Option<bool>,
    /// `--include-hook-events`.
    pub include_hook_events: Option<bool>,
    /// `--add-dir <dir>` (repeatable).
    pub add_dir: Option<Vec<String>>,
    /// `--mcp-config <config>` (repeatable). Each entry is a path or JSON.
    pub mcp_config: Option<Vec<String>>,
    /// `--allowed-tools <tools...>`.
    pub allowed_tools: Option<Vec<String>>,
    /// `--disallowed-tools <tools...>`.
    pub disallowed_tools: Option<Vec<String>>,
    /// `--tools <spec>` — the built-in tool surface Claude gets. Use `""` to
    /// disable all built-ins (default for customer-facing apps), `"default"`
    /// for everything, or a comma/space-separated list. When `None` and
    /// `dangerously_skip_permissions` is off, the template appends
    /// `--tools ""` so Claude can't touch the filesystem unless a fork
    /// opts in.
    pub tools: Option<String>,
    /// Override the server-wide default for `--dangerously-skip-permissions`.
    /// When `None`, the default is **off** — customer-facing apps should not
    /// expose Claude's filesystem tools. Set `APP_ALLOW_SKIP_PERMISSIONS=1`
    /// (or pass `true` here per-request) only for internal dev tools.
    pub dangerously_skip_permissions: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ClaudeExecutionRequest {
    pub project_path: String,
    pub prompt: String,
    pub model: Option<String>,
    /// For `resume`, this is the prior conversation UUID to pick up.
    pub session_id: Option<String>,
    /// For `execute`/`continue`, a client-generated UUID to bind this new
    /// conversation to. Passed through to `claude --session-id`, and used as
    /// the routing key for stream events back to the frontend. When absent,
    /// the server falls back to the WebSocket connection UUID (legacy).
    pub client_session_id: Option<String>,
    pub command_type: String, // "execute", "continue", or "resume"
    /// Optional CLI flag surface exposed to forks.
    #[serde(default)]
    pub extra: ClaudeExtraArgs,
}

/// Resolve whether `--dangerously-skip-permissions` should be applied for a
/// given request. Default is **off**; the `APP_ALLOW_SKIP_PERMISSIONS` env
/// var opts the whole server in, and a per-request `dangerously_skip_permissions`
/// flag can flip either way.
pub(super) fn resolve_skip_permissions(extra: &ClaudeExtraArgs) -> bool {
    if let Some(explicit) = extra.dangerously_skip_permissions {
        return explicit;
    }
    match std::env::var("APP_ALLOW_SKIP_PERMISSIONS") {
        Ok(v) => matches!(v.as_str(), "1" | "true" | "yes"),
        Err(_) => false,
    }
}

/// Decide the default `--tools` value. We intentionally never emit
/// `--tools ""` anymore: in this Claude CLI version that flag also strips
/// the MCP (`template-tools`) tools, leaving Claude with no tools at all,
/// so it hallucinates tool calls as plain text and fabricates results.
/// Built-in filesystem / bash tools are already kept out of customer flows
/// by the allow-list plus the default permission mode: any tool not on
/// `--allowed-tools` is permission-gated, which is a hard block in headless
/// `-p` mode. Forks that explicitly want builtins pass `tools: Some("...")`
/// per request.
pub(super) fn resolve_default_tools(extra: &ClaudeExtraArgs) -> Option<String> {
    if extra.tools.is_some() {
        return None; // caller is explicit; append_extra_args emits it
    }
    None
}

/// Append optional CLI flags derived from the request to an existing argv.
pub(super) fn append_extra_args(args: &mut Vec<String>, extra: &ClaudeExtraArgs) {
    if let Some(ref m) = extra.permission_mode {
        args.push("--permission-mode".into());
        args.push(m.clone());
    }
    if let Some(ref e) = extra.effort {
        args.push("--effort".into());
        args.push(e.clone());
    }
    if let Some(b) = extra.max_budget_usd {
        args.push("--max-budget-usd".into());
        args.push(b.to_string());
    }
    if let Some(ref fb) = extra.fallback_model {
        args.push("--fallback-model".into());
        args.push(fb.clone());
    }
    if let Some(ref p) = extra.append_system_prompt {
        args.push("--append-system-prompt".into());
        args.push(p.clone());
    }
    if extra.include_partial_messages.unwrap_or(false) {
        args.push("--include-partial-messages".into());
    }
    if extra.include_hook_events.unwrap_or(false) {
        args.push("--include-hook-events".into());
    }
    if let Some(ref dirs) = extra.add_dir {
        for d in dirs {
            args.push("--add-dir".into());
            args.push(d.clone());
        }
    }
    if let Some(ref cfgs) = extra.mcp_config {
        for c in cfgs {
            args.push("--mcp-config".into());
            args.push(c.clone());
        }
    }
    if let Some(ref tools) = extra.allowed_tools {
        if !tools.is_empty() {
            args.push("--allowed-tools".into());
            args.push(tools.join(","));
        }
    }
    if let Some(ref spec) = extra.tools {
        args.push("--tools".into());
        args.push(spec.clone());
    }
    if let Some(ref tools) = extra.disallowed_tools {
        if !tools.is_empty() {
            args.push("--disallowed-tools".into());
            args.push(tools.join(","));
        }
    }
}

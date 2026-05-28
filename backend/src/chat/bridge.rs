//! Per-spawn `tool-bridge` subprocess wiring.
//!
//! For every Claude subprocess we spin up, we hand it an MCP config
//! pointing at a sibling `tool-bridge` binary plus a fresh shared
//! secret. The bridge POSTs back to `/__tools/dispatch` on loopback,
//! presenting the secret in `X-Tool-Bridge-Secret`; the dispatch
//! handler uses the secret to authorize and to find the WebSocket
//! session that should receive any client-tool round-trips.
//!
//! [`ToolBridgeHandle`] is the RAII guard: keep it alive for the
//! lifetime of the Claude subprocess, drop it after the child exits.

use crate::web_server::AppState;

/// A guard returned by [`prepare_tool_bridge`]. Holds the temp files that
/// back `--mcp-config` + the bridge's own config, and the active-secret
/// registration. Dropping it unregisters the secret and removes the temp
/// files. Keep one live for the entire Claude subprocess lifetime.
pub(super) struct ToolBridgeHandle {
    /// Path passed to `claude --mcp-config`.
    pub(super) mcp_config_path: std::path::PathBuf,
    /// Tool names to put on `--allowed-tools`.
    pub(super) allowed_tools: Vec<String>,
    /// Keeps the tempfile alive.
    _bridge_config_file: tempfile::NamedTempFile,
    _mcp_config_file: tempfile::NamedTempFile,
    secret: String,
    state: AppState,
}

impl Drop for ToolBridgeHandle {
    fn drop(&mut self) {
        // Fire-and-forget: we don't have an async context in Drop, so
        // use try_lock — if the mutex is contended we leak the entry
        // until the next server restart. Acceptable for the template.
        if let Ok(mut guard) = self.state.active_bridge_secrets.try_lock() {
            guard.remove(&self.secret);
        }
    }
}

/// Locate the `tool-bridge` binary. By convention Cargo puts sibling bins
/// in the same target directory, so we look next to the current exe
/// first. If not found there (e.g. running `cargo run` for the main
/// binary but only the release bridge has been built, or vice versa) we
/// also check the sibling profile directory under `target/`. Forks
/// running the bridge from a custom path can set `APP_TOOL_BRIDGE_PATH`.
fn resolve_tool_bridge_path() -> Result<std::path::PathBuf, String> {
    if let Ok(explicit) = std::env::var("APP_TOOL_BRIDGE_PATH") {
        return Ok(std::path::PathBuf::from(explicit));
    }
    #[cfg(windows)]
    let bin_name = "tool-bridge.exe";
    #[cfg(not(windows))]
    let bin_name = "tool-bridge";

    let exe = std::env::current_exe()
        .map_err(|e| format!("resolving current exe for tool-bridge: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "current exe has no parent dir".to_string())?;

    let primary = dir.join(bin_name);
    if primary.exists() {
        return Ok(primary);
    }

    // Fallback: if we're in `target/<profile>/`, try the sibling profile.
    // Lets `cargo run --bin claude-ui-app` (debug) pick up a release
    // tool-bridge that the user already built, and vice versa.
    if let (Some(profile), Some(target_dir)) =
        (dir.file_name().and_then(|n| n.to_str()), dir.parent())
    {
        for sibling in ["release", "debug"] {
            if sibling == profile {
                continue;
            }
            let candidate = target_dir.join(sibling).join(bin_name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(format!(
        "tool-bridge binary not found at {}. Build it with `cargo build --bin tool-bridge` (or `--release --bin tool-bridge`), or set APP_TOOL_BRIDGE_PATH.",
        primary.display()
    ))
}

/// Write the bridge config + MCP config temp files and register the
/// per-spawn secret against `session_id` so client-tool calls can be
/// routed back to the right WebSocket. If the registry is empty, returns
/// `Ok(None)` — forks with zero tools shouldn't get `--mcp-config`
/// appended at all.
pub(super) async fn prepare_tool_bridge(
    state: &AppState,
    session_id: &str,
) -> Result<Option<ToolBridgeHandle>, String> {
    let specs = state.tools.specs();
    if specs.is_empty() {
        return Ok(None);
    }

    let bridge_path = resolve_tool_bridge_path()?;
    let secret = uuid::Uuid::new_v4().simple().to_string();

    // Bridge config: upstream URL + secret + tool manifest.
    let bridge_cfg = serde_json::json!({
        "upstream_url": state.self_url,
        "secret": secret,
        "tools": specs.iter().map(|s| serde_json::json!({
            "name": s.name,
            "description": s.description,
            "input_schema": s.input_schema,
        })).collect::<Vec<_>>(),
    });
    let mut bridge_file = tempfile::NamedTempFile::new()
        .map_err(|e| format!("creating bridge config tempfile: {e}"))?;
    std::io::Write::write_all(
        &mut bridge_file,
        serde_json::to_vec_pretty(&bridge_cfg).unwrap().as_slice(),
    )
    .map_err(|e| format!("writing bridge config: {e}"))?;

    // MCP config: tells Claude to spawn our bridge bin with the above
    // config path passed via env var.
    let mcp_cfg = serde_json::json!({
        "mcpServers": {
            crate::core::tools::MCP_SERVER_NAME: {
                "command": bridge_path.to_string_lossy(),
                "args": [],
                "env": {
                    "APP_TOOL_BRIDGE_CONFIG": bridge_file.path().to_string_lossy(),
                }
            }
        }
    });
    let mut mcp_file = tempfile::NamedTempFile::new()
        .map_err(|e| format!("creating mcp config tempfile: {e}"))?;
    std::io::Write::write_all(
        &mut mcp_file,
        serde_json::to_vec_pretty(&mcp_cfg).unwrap().as_slice(),
    )
    .map_err(|e| format!("writing mcp config: {e}"))?;

    // Register the secret so /__tools/dispatch will accept it and knows
    // which WebSocket to route client-tool calls back through.
    state
        .active_bridge_secrets
        .lock()
        .await
        .insert(secret.clone(), session_id.to_string());

    Ok(Some(ToolBridgeHandle {
        mcp_config_path: mcp_file.path().to_path_buf(),
        allowed_tools: state.tools.allowed_tool_names(),
        _bridge_config_file: bridge_file,
        _mcp_config_file: mcp_file,
        secret,
        state: state.clone(),
    }))
}

//! `/__tools/dispatch` — loopback-only endpoint called by the
//! `tool-bridge` subprocess. The bridge authenticates with a per-spawn
//! shared secret (passed to it via its config file at spawn time); the
//! secret must match a currently active spawn in
//! `AppState::active_bridge_secrets` or the request is rejected.
//! Separate from the guest-cookie middleware: bridges aren't browsers
//! and can't carry cookies.

use axum::extract::State as AxumState;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::chat::send_to_session;
use crate::web_server::{ApiResponse, AppState};

#[derive(Debug, Deserialize)]
pub struct ToolDispatchBody {
    name: String,
    #[serde(default)]
    input: serde_json::Value,
}

pub async fn tools_dispatch(
    AxumState(state): AxumState<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<ToolDispatchBody>,
) -> Json<ApiResponse<serde_json::Value>> {
    let presented = match headers
        .get("x-tool-bridge-secret")
        .and_then(|v| v.to_str().ok())
    {
        Some(s) => s.to_string(),
        None => return Json(ApiResponse::error("missing X-Tool-Bridge-Secret".into())),
    };

    // Authorize + resolve the owning WebSocket session. We need the
    // session ID for client-tool calls so we can route the UI request
    // back over the right socket.
    let session_id = {
        let secrets = state.active_bridge_secrets.lock().await;
        match secrets.get(&presented) {
            Some(sid) => sid.clone(),
            None => return Json(ApiResponse::error("unknown bridge secret".into())),
        }
    };

    // Server tool → run the Rust handler inline.
    // Client tool → round-trip through the WebSocket.
    let runtime = state
        .tools
        .specs()
        .iter()
        .find(|s| s.name == body.name)
        .map(|s| s.runtime);
    match runtime {
        Some(crate::core::tools::ToolRuntime::Server) => {
            match state.tools.dispatch(&body.name, body.input).await {
                Ok(v) => Json(ApiResponse::success(v)),
                Err(e) => Json(ApiResponse::error(e.to_string())),
            }
        }
        Some(crate::core::tools::ToolRuntime::Client) => {
            match dispatch_client_tool(&state, &session_id, &body.name, body.input).await {
                Ok(v) => Json(ApiResponse::success(v)),
                Err(e) => Json(ApiResponse::error(e.to_string())),
            }
        }
        None => Json(ApiResponse::error(format!("unknown tool: {}", body.name))),
    }
}

/// Push a `tool_call_for_ui` message to the session's WebSocket, then
/// await the matching `tool_result_from_ui` (delivered via oneshot) with
/// a timeout. Returns the user-supplied result as the tool output.
async fn dispatch_client_tool(
    state: &AppState,
    session_id: &str,
    name: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let tool_call_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel::<serde_json::Value>();
    state
        .pending_client_tools
        .lock()
        .await
        .insert(tool_call_id.clone(), tx);

    send_to_session(
        state,
        session_id,
        json!({
            "type": "tool_call_for_ui",
            "tool_call_id": tool_call_id,
            "name": name,
            "input": input,
            "session_id": session_id,
        })
        .to_string(),
    )
    .await;

    let timeout = std::time::Duration::from_secs(
        std::env::var("APP_CLIENT_TOOL_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(120),
    );
    let outcome = tokio::time::timeout(timeout, rx).await;
    // Always try to clear the pending entry on exit.
    state
        .pending_client_tools
        .lock()
        .await
        .remove(&tool_call_id);

    match outcome {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err("frontend dropped the tool call before responding".into()),
        Err(_) => Err(format!(
            "timed out after {}s waiting for UI to respond to '{}'",
            timeout.as_secs(),
            name
        )),
    }
}

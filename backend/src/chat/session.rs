//! WebSocket session lookup + the `/api/sessions/:id/cancel` route.
//!
//! `send_to_session` is the one place the chat code writes back to the
//! browser: it persists the outbound JSON as a stream event (so reloads
//! can replay) and then forwards via the per-session mpsc the WebSocket
//! handler set up.

use axum::extract::{Path, State as AxumState};
use axum::Json;

use crate::web_server::{ApiResponse, AppState};

/// Empty, non-git directory used as the cwd for spawned Claude Code
/// chat subprocesses when no explicit `project_path` is supplied.
///
/// Without this, the subprocess inherits the backend's cwd (usually
/// `backend/` inside the harness repo). Claude Code then auto-injects
/// the parent repo's gitStatus + file listing into the inner Claude's
/// system context, which leaks harness internals into the user-facing
/// chat (e.g. the model starts guessing at `../src/styles.css`).
/// Pointing cwd at an empty, non-git dir blocks that auto-introspection.
///
/// Idempotent: `create_dir_all` is a no-op if it already exists.
pub(super) fn chat_sandbox_dir() -> std::path::PathBuf {
    let base = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join(".claude-ui-app").join("chat-sandbox");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub async fn send_to_session(state: &AppState, session_id: &str, message: String) {
    // Persist the outbound message as a stream event so reloads can replay
    // the conversation. Best-effort: failures log but don't block delivery.
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&message) {
        if let Err(e) = state
            .store
            .append_message(session_id, "stream", &v)
            .await
        {
            log::warn!("failed to persist stream event for {session_id}: {e}");
        }
    }

    let sessions = state.active_sessions.lock().await;
    if let Some(sender) = sessions.get(session_id) {
        if let Err(e) = sender.send(message).await {
            println!("[TRACE] Failed to send message: {}", e);
        }
    } else {
        println!("[TRACE] Session {} not found in active sessions", session_id);
    }
}

/// Cancel a running Claude subprocess by session ID. Looks up the mpsc
/// cancel channel registered by the spawn function and sends on it; the
/// spawn task picks the signal up via `tokio::select!`, calls `start_kill()`
/// on the child, and emits a `cancelled` event to the WebSocket.
pub async fn cancel_claude_execution(
    Path(session_id): Path<String>,
    AxumState(state): AxumState<AppState>,
) -> Json<ApiResponse<()>> {
    let tx_opt = state
        .cancel_channels
        .lock()
        .await
        .get(&session_id)
        .cloned();
    match tx_opt {
        Some(tx) => {
            // `send` returns Err only if the receiver is gone, which means
            // the process already exited — treat as success either way.
            let _ = tx.send(()).await;
            Json(ApiResponse::success(()))
        }
        None => Json(ApiResponse::error(format!(
            "No active session to cancel: {}",
            session_id
        ))),
    }
}


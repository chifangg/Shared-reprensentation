//! `/ws/claude` upgrade + the main per-connection message loop. Two
//! inbound message shapes:
//!
//!   - `ClaudeExecutionRequest` — user prompting Claude. Dispatched to
//!     execute / continuation / resume based on `command_type`.
//!   - `tool_result_from_ui` — browser responding to a client tool the
//!     backend is currently awaiting. Routed via the oneshot the bridge
//!     dispatch registered in `state.pending_client_tools`.

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State as AxumState, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;

use crate::web_server::AppState;

use super::args::ClaudeExecutionRequest;
use super::continuation::continue_claude_command;
use super::execute::execute_claude_command;
use super::resume::resume_claude_command;
use super::session::send_to_session;

/// WebSocket handler for Claude execution with streaming output
pub async fn claude_websocket(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<AppState>,
    axum::Extension(guest): axum::Extension<crate::core::cookies::GuestSession>,
) -> Response {
    let cookie_id = guest.id;
    ws.on_upgrade(move |socket| claude_websocket_handler(socket, state, cookie_id))
}

async fn claude_websocket_handler(socket: WebSocket, state: AppState, cookie_id: String) {
    let (mut sender, mut receiver) = socket.split();
    let session_id = uuid::Uuid::new_v4().to_string();

    println!(
        "[TRACE] WebSocket handler started - session_id: {}",
        session_id
    );

    // Channel for sending output to WebSocket
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);

    // Store session in state
    {
        let mut sessions = state.active_sessions.lock().await;
        sessions.insert(session_id.clone(), tx);
        println!(
            "[TRACE] Session stored in state - active sessions count: {}",
            sessions.len()
        );
    }

    // Task to forward channel messages to WebSocket
    let session_id_for_forward = session_id.clone();
    let forward_task = tokio::spawn(async move {
        println!(
            "[TRACE] Forward task started for session {}",
            session_id_for_forward
        );
        while let Some(message) = rx.recv().await {
            println!("[TRACE] Forwarding message to WebSocket: {}", message);
            if sender.send(Message::Text(message.into())).await.is_err() {
                println!("[TRACE] Failed to send message to WebSocket - connection closed");
                break;
            }
        }
        println!(
            "[TRACE] Forward task ended for session {}",
            session_id_for_forward
        );
    });

    // Handle incoming messages from WebSocket
    println!("[TRACE] Starting to listen for WebSocket messages");
    while let Some(msg) = receiver.next().await {
        println!("[TRACE] Received WebSocket message: {:?}", msg);
        if let Ok(msg) = msg {
            if let Message::Text(text) = msg {
                // Inbound messages are one of two shapes:
                //  - ClaudeExecutionRequest: user prompting Claude.
                //  - tool_result_from_ui: browser responding to a client
                //    tool that the backend is currently awaiting.
                // We peek at the `type` field first to decide.
                if let Ok(generic) = serde_json::from_str::<serde_json::Value>(&text) {
                    if generic.get("type").and_then(|v| v.as_str())
                        == Some("tool_result_from_ui")
                    {
                        let id = generic
                            .get("tool_call_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let content = generic.get("content").cloned().unwrap_or(json!(null));
                        let tx_opt = state
                            .pending_client_tools
                            .lock()
                            .await
                            .remove(&id);
                        match tx_opt {
                            Some(tx) => {
                                let _ = tx.send(content);
                            }
                            None => println!(
                                "[TRACE] tool_result_from_ui for unknown id {}",
                                id
                            ),
                        }
                        continue;
                    }
                }

                println!(
                    "[TRACE] WebSocket text message received - length: {} chars",
                    text.len()
                );
                println!("[TRACE] WebSocket message content: {}", text);
                match serde_json::from_str::<ClaudeExecutionRequest>(&text) {
                    Ok(request) => {
                        println!("[TRACE] Successfully parsed request: {:?}", request);
                        println!("[TRACE] Command type: {}", request.command_type);
                        println!("[TRACE] Project path: {}", request.project_path);
                        println!("[TRACE] Prompt length: {} chars", request.prompt.len());

                        // Prefer the client-supplied session ID so that the
                        // Claude subprocess and the frontend agree on the
                        // conversation UUID (and therefore on the JSONL file
                        // it writes). Fall back to the per-connection UUID
                        // for legacy clients.
                        let session_id_clone = request
                            .client_session_id
                            .clone()
                            .unwrap_or_else(|| session_id.clone());
                        let client_session_id = request.client_session_id.clone();
                        let state_clone = state.clone();

                        // Mirror the WebSocket's mpsc sender under the
                        // client-supplied session key so `send_to_session`
                        // can route events when the executor uses that ID.
                        if let Some(ref cid) = client_session_id {
                            if cid != &session_id {
                                let tx_opt = state_clone
                                    .active_sessions
                                    .lock()
                                    .await
                                    .get(&session_id)
                                    .cloned();
                                if let Some(tx) = tx_opt {
                                    state_clone
                                        .active_sessions
                                        .lock()
                                        .await
                                        .insert(cid.clone(), tx);
                                }
                            }
                        }

                        // Rate limits: per-cookie message budget first, then
                        // concurrent-conversation slot. Failures become
                        // `rate_limited` WebSocket events; the spawn is
                        // skipped and the guest is told to back off.
                        if let Err(e) =
                            state_clone.rate_limiter.try_record_message(&cookie_id).await
                        {
                            send_to_session(
                                &state_clone,
                                &session_id_clone,
                                json!({
                                    "type": "rate_limited",
                                    "message": e,
                                    "session_id": session_id_clone,
                                })
                                .to_string(),
                            )
                            .await;
                            continue;
                        }
                        if let Err(e) = state_clone
                            .rate_limiter
                            .try_claim_conversation(&cookie_id)
                            .await
                        {
                            send_to_session(
                                &state_clone,
                                &session_id_clone,
                                json!({
                                    "type": "rate_limited",
                                    "message": e,
                                    "session_id": session_id_clone,
                                })
                                .to_string(),
                            )
                            .await;
                            continue;
                        }

                        // Persist: associate this conversation with the
                        // guest cookie (creates the row if new, rejects it
                        // if it belongs to a different cookie), then log
                        // the user prompt. On ownership conflict or DB
                        // error we abort the spawn rather than silently
                        // running for the wrong identity.
                        if let Err(e) = state_clone
                            .store
                            .ensure_conversation(&session_id_clone, &cookie_id)
                            .await
                        {
                            state_clone
                                .rate_limiter
                                .release_conversation(&cookie_id)
                                .await;
                            let err = format!(
                                "conversation {} not available: {}",
                                session_id_clone, e
                            );
                            send_to_session(
                                &state_clone,
                                &session_id_clone,
                                json!({
                                    "type": "error",
                                    "message": err,
                                    "session_id": session_id_clone,
                                })
                                .to_string(),
                            )
                            .await;
                            continue;
                        }
                        let _ = state_clone
                            .store
                            .append_message(
                                &session_id_clone,
                                "user",
                                &json!({
                                    "command_type": request.command_type,
                                    "prompt": request.prompt,
                                    "model": request.model,
                                }),
                            )
                            .await;

                        println!(
                            "[TRACE] Spawning task to execute command: {}",
                            request.command_type
                        );
                        // Clone the cookie for the spawn so it can release
                        // the concurrent-conversation slot when done.
                        let cookie_for_release = cookie_id.clone();
                        tokio::spawn(async move {
                            println!("[TRACE] Task started for command execution");
                            let result = match request.command_type.as_str() {
                                "execute" => {
                                    execute_claude_command(
                                        request.project_path,
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        client_session_id.clone(),
                                        request.extra.clone(),
                                        state_clone.clone(),
                                    )
                                    .await
                                }
                                "continue" => {
                                    continue_claude_command(
                                        request.project_path,
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        client_session_id.clone(),
                                        request.extra.clone(),
                                        state_clone.clone(),
                                    )
                                    .await
                                }
                                "resume" => {
                                    resume_claude_command(
                                        request.project_path,
                                        request.session_id.unwrap_or_default(),
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        request.extra.clone(),
                                        state_clone.clone(),
                                    )
                                    .await
                                }
                                _ => {
                                    println!(
                                        "[TRACE] Unknown command type: {}",
                                        request.command_type
                                    );
                                    Err("Unknown command type".to_string())
                                }
                            };

                            println!(
                                "[TRACE] Command execution finished with result: {:?}",
                                result
                            );

                            // Send completion message
                            if let Some(sender) = state_clone
                                .active_sessions
                                .lock()
                                .await
                                .get(&session_id_clone)
                            {
                                let completion_msg = match result {
                                    Ok(_) => json!({
                                        "type": "completion",
                                        "status": "success",
                                        "session_id": session_id_clone,
                                    }),
                                    Err(e) => json!({
                                        "type": "completion",
                                        "status": "error",
                                        "error": e,
                                        "session_id": session_id_clone,
                                    }),
                                };
                                println!("[TRACE] Sending completion message: {}", completion_msg);
                                let _ = sender.send(completion_msg.to_string()).await;
                            } else {
                                println!("[TRACE] Session not found in active sessions when sending completion");
                            }

                            // Always release the per-cookie concurrent
                            // conversation slot, regardless of whether the
                            // Claude run succeeded.
                            state_clone
                                .rate_limiter
                                .release_conversation(&cookie_for_release)
                                .await;
                        });
                    }
                    Err(e) => {
                        println!("[TRACE] Failed to parse WebSocket request: {}", e);
                        println!("[TRACE] Raw message that failed to parse: {}", text);

                        // Send error back to client
                        let error_msg = json!({
                            "type": "error",
                            "message": format!("Failed to parse request: {}", e)
                        });
                        if let Some(sender_tx) = state.active_sessions.lock().await.get(&session_id)
                        {
                            let _ = sender_tx.send(error_msg.to_string()).await;
                        }
                    }
                }
            } else if let Message::Close(_) = msg {
                println!("[TRACE] WebSocket close message received");
                break;
            } else {
                println!("[TRACE] Non-text WebSocket message received: {:?}", msg);
            }
        } else {
            println!("[TRACE] Error receiving WebSocket message");
        }
    }

    println!("[TRACE] WebSocket message loop ended");

    // Clean up session
    {
        let mut sessions = state.active_sessions.lock().await;
        sessions.remove(&session_id);
        println!(
            "[TRACE] Session {} removed from state - remaining sessions: {}",
            session_id,
            sessions.len()
        );
    }

    forward_task.abort();
    println!("[TRACE] WebSocket handler ended for session {}", session_id);
}

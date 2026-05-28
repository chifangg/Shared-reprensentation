//! Read-only endpoints for the per-cookie conversation history. The
//! actual storage lives in `core::conversations::ConversationStore`;
//! this module just owns the HTTP shape and the guest-cookie ownership
//! check.

use axum::extract::{Path, State as AxumState};
use axum::Json;

use crate::web_server::{ApiResponse, AppState};

/// List conversations owned by the requesting guest cookie (newest first).
pub async fn list_conversations(
    AxumState(state): AxumState<AppState>,
    axum::Extension(guest): axum::Extension<crate::core::cookies::GuestSession>,
) -> Json<ApiResponse<Vec<crate::core::conversations::ConversationRow>>> {
    match state.store.list_for_cookie(&guest.id).await {
        Ok(rows) => Json(ApiResponse::success(rows)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// Replay stored messages for `:conversation_id` if the guest cookie owns
/// it. Returns an empty list (not an error) if ownership doesn't match, so
/// we don't leak existence across cookies.
pub async fn load_conversation_messages(
    AxumState(state): AxumState<AppState>,
    axum::Extension(guest): axum::Extension<crate::core::cookies::GuestSession>,
    Path(conversation_id): Path<String>,
) -> Json<ApiResponse<Vec<crate::core::conversations::MessageRow>>> {
    match state.store.load_messages(&conversation_id, &guest.id).await {
        Ok(rows) => Json(ApiResponse::success(rows)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

//! Claude-execution surface. Spawns `claude` subprocesses, streams their
//! output back to the browser over WebSocket, and brokers tool calls
//! through the per-spawn MCP tool-bridge subprocess.
//!
//! Sub-modules:
//!   - `binary`        — locate the `claude` executable.
//!   - `args`          — `ClaudeExtraArgs` + CLI-flag composers.
//!   - `bridge`        — tool-bridge subprocess lifecycle.
//!   - `session`       — WebSocket session lookup + the cancel endpoint.
//!   - `execute`       — `execute` command path (new conversation).
//!   - `continuation`  — `continue` command path (resume the latest run).
//!   - `resume`        — `resume <session-id>` path.
//!   - `websocket`     — `/ws/claude` upgrade + main message loop.

mod binary;
mod bridge;
mod continuation;
mod execute;
mod resume;
mod session;
mod websocket;

pub mod args;

pub use binary::find_claude_binary_web;
pub use session::{cancel_claude_execution, send_to_session};
pub use websocket::claude_websocket;

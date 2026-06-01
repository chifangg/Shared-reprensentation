//! `/api/diagram` — capability-centric overview, adaptive focus deltas,
//! and the onboarding capability scan. All Anthropic-call orchestration
//! lives here; web_server just registers the route.
//!
//! Sub-modules:
//!   - `prompts`  — the three view-specific system prompts.
//!   - `tools`    — tool-input JSON schemas + tool_use → NDJSON line
//!                  translation. The Anthropic tool-use protocol shim.
//!   - `handler`  — the `generate_diagram` HTTP handler itself plus the
//!                  body/builder helpers it dispatches into.

mod function_detail;
mod handler;
mod prompts;
mod tools;

pub use function_detail::function_detail;
pub use handler::generate_diagram;

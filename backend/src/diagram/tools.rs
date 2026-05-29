//! Tool-input JSON schemas + tool builders for the three diagram views,
//! plus the `tool_use → NDJSON line` translation the handler streams
//! back to the frontend.
//!
//! Each view exposes a different tool set:
//!   - structure: `block`, `arrow`, `done`
//!   - focus: `focus`, `detail_block`, `detail_arrow`, `done`
//!   - capability_scan: `capability`, `done`
//!
//! Common atoms (`block_input_schema`, `arrow_input_schema`,
//! `empty_input_schema`) are re-used across views — keep them module-
//! private so the seams between views stay legible.

use serde_json::json;

fn block_input_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "id": { "type": "string", "minLength": 1, "description": "Stable readable id derived from the label, e.g. \"backend_api\"." },
            "label": { "type": "string", "minLength": 1, "description": "Short display name." },
            "caption": { "type": "string", "description": "One-sentence description of what the block does." },
            "parent": { "type": ["string", "null"], "description": "Parent block id, or null for top-level blocks." },
            "provenance": {
                "type": "object",
                "properties": {
                    "files": { "type": "array", "items": { "type": "string" } },
                    "functions": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["files", "functions"]
            }
        },
        "required": ["id", "label", "caption", "provenance"]
    })
}

fn arrow_input_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "from": { "type": "string", "minLength": 1, "description": "Source block id." },
            "to": { "type": "string", "minLength": 1, "description": "Destination block id." },
            "label": { "type": "string", "minLength": 1, "description": "1–2 word verb describing the actual relationship (e.g. \"imports\", \"calls\", \"renders\")." }
        },
        "required": ["from", "to", "label"]
    })
}

fn empty_input_schema() -> serde_json::Value {
    json!({ "type": "object", "properties": {} })
}

fn capability_input_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "id": { "type": "string", "minLength": 1, "description": "Stable readable id derived from the label, e.g. \"content_sections\"." },
            "label": { "type": "string", "minLength": 1, "description": "Short user-facing capability name." },
            "caption": { "type": "string", "description": "One-sentence description of what this capability does for the user." },
            "icon": {
                "type": "string",
                "enum": ["structure", "dataflow", "ui", "logic", "integration", "config", "data", "content", "conversation", "compare", "view", "people", "browse", "annotation", "other"],
                "description": "One keyword from the list whose meaning best matches this capability. Pick distinct icons across capabilities so the picklist looks varied. Use \"other\" only if none genuinely fit."
            }
        },
        "required": ["id", "label", "caption", "icon"]
    })
}

pub(super) fn structure_tools() -> Vec<serde_json::Value> {
    vec![
        json!({
            "name": "block",
            "description": "Emit one architecture block in the diagram.",
            "input_schema": block_input_schema(),
        }),
        json!({
            "name": "arrow",
            "description": "Emit one arrow between two blocks.",
            "input_schema": arrow_input_schema(),
        }),
        json!({
            "name": "done",
            "description": "Signal that all blocks and arrows have been emitted.",
            "input_schema": empty_input_schema(),
        }),
    ]
}

pub(super) fn focus_tools() -> Vec<serde_json::Value> {
    vec![
        json!({
            "name": "focus",
            "description": "Identify which existing overview block ids the conversation is about.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "ids": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["ids"]
            },
        }),
        json!({
            "name": "detail_block",
            "description": "Emit one detail sub-block under an existing overview block.",
            "input_schema": block_input_schema(),
        }),
        json!({
            "name": "detail_arrow",
            "description": "Emit one arrow between two detail blocks.",
            "input_schema": arrow_input_schema(),
        }),
        json!({
            "name": "done",
            "description": "Signal that focus, detail_block, and detail_arrow tool calls are complete.",
            "input_schema": empty_input_schema(),
        }),
    ]
}

pub(super) fn capability_scan_tools() -> Vec<serde_json::Value> {
    vec![
        json!({
            "name": "capability",
            "description": "Emit one capability candidate (label + caption only, no provenance).",
            "input_schema": capability_input_schema(),
        }),
        json!({
            "name": "done",
            "description": "Signal that all capabilities have been emitted.",
            "input_schema": empty_input_schema(),
        }),
    ]
}

/// Translate a streamed tool_use call into the NDJSON line shape the
/// frontend already consumes (`{kind, data}` for most tools, `{kind:
/// "focus", ids: [...]}` for the focus tool, and `{kind: "done"}` for
/// the terminator).
pub(super) fn tool_use_to_ndjson(
    name: &str,
    input: serde_json::Value,
) -> serde_json::Value {
    match name {
        "focus" => json!({
            "kind": "focus",
            "ids": input.get("ids").cloned().unwrap_or_else(|| json!([]))
        }),
        "done" => json!({ "kind": "done" }),
        other => json!({ "kind": other, "data": input }),
    }
}

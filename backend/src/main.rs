use clap::Parser;
use serde_json::json;

mod core;
mod examples;
mod web_server;

#[derive(Parser)]
#[command(name = "claude-ui-app")]
#[command(
    about = "Web server exposing Claude Code as a customer-facing browser UI. \
             Ships with guest-cookie sessions, per-cookie rate limits, and a \
             tool-bridge so Claude can call fork-registered domain tools."
)]
struct Args {
    /// Port to listen on.
    #[arg(short, long, default_value = "8080")]
    port: u16,

    /// Host to bind to. Use 0.0.0.0 to expose on the LAN (remember to set
    /// a strong APP_SESSION_KEY in that case).
    #[arg(short = 'H', long, default_value = "127.0.0.1")]
    host: String,
}

#[tokio::main]
async fn main() {
    // Load .env (e.g. ANTHROPIC_API_KEY) before anything reads env. Tries
    // `./.env` (cargo run from backend/) first, then `./backend/.env`
    // (cargo run from repo root). Silent if absent — production can rely
    // on shell env.
    let _ = dotenvy::from_filename(".env")
        .or_else(|_| dotenvy::from_filename("backend/.env"));

    env_logger::init();

    let args = Args::parse();

    let host: std::net::IpAddr = match args.host.parse() {
        Ok(ip) => ip,
        Err(e) => {
            eprintln!("❌ Invalid --host '{}': {}", args.host, e);
            std::process::exit(2);
        }
    };

    println!("🚀 Starting {}", env!("CARGO_PKG_NAME"));

    // Build the tool registry. This is the seam every fork edits to wire
    // its own domain tools. The defaults below (`get_weather` server
    // tool + `show_choice` client tool) are references — real forks
    // replace them with `search_flights`, `reserve_seat`, etc.
    let tools = build_tool_registry();

    if let Err(e) = web_server::start_web_mode(host, args.port, tools).await {
        eprintln!("❌ Failed to start web server: {}", e);
        std::process::exit(1);
    }
}

/// Tool registry for the project-explorer prototype. The chat surface
/// hands Claude one client-side tool: `read_project_file`. The browser
/// owns the user's uploaded project (in the React `ProjectContext`) so
/// the file contents never leave the client — the tool-bridge round-trip
/// reaches into the browser, looks up the file, and returns its body to
/// Claude as the tool result.
fn build_tool_registry() -> core::tools::ToolRegistry {
    let mut b = core::tools::ToolRegistry::builder();

    b.client_tool(
        "read_project_file",
        "Read the full contents of a file from the user's uploaded \
         project. The system prompt includes a tree of every available \
         path; pass one of those paths exactly to fetch its body. Use \
         this whenever you need to look at code the user is asking \
         about — do not try to guess from the path alone.",
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Project-relative path exactly as it \
                        appears in the <tree> block of the system \
                        prompt (e.g. 'transcript_annotation_BU/app.py')."
                }
            },
            "required": ["path"],
            "additionalProperties": false
        }),
    );

    b.client_tool(
        "edit_project_file",
        "Make a small in-place edit to a file by replacing one substring \
         with another. PREFER this over `write_project_file` for any \
         edit that touches less than roughly half the file — it is \
         dramatically faster because you do not have to re-emit the \
         entire body (a one-line change in a 30KB file is ~1s vs \
         ~15s with write_project_file). Always call `read_project_file` \
         first so you know the exact text and surrounding context. \
         `old_string` must appear EXACTLY ONCE in the file — include a \
         few surrounding lines if needed to disambiguate — unless you \
         set `replace_all` to true. Preserve indentation and whitespace \
         exactly as they appear in the file.",
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Project-relative path exactly as it \
                        appears in the <tree> block of the system prompt."
                },
                "old_string": {
                    "type": "string",
                    "description": "The exact substring to replace. Must \
                        be unique in the file unless replace_all is true. \
                        Preserve indentation and whitespace verbatim."
                },
                "new_string": {
                    "type": "string",
                    "description": "The text to substitute for old_string."
                },
                "replace_all": {
                    "type": "boolean",
                    "description": "If true, replace every occurrence of \
                        old_string. Defaults to false."
                }
            },
            "required": ["path", "old_string", "new_string"],
            "additionalProperties": false
        }),
    );

    b.client_tool(
        "write_project_file",
        "Overwrite the full contents of a file in the user's uploaded \
         project, or create a new file if the path doesn't exist yet. \
         The browser will atomically replace the file body. Use this \
         only after the user has clearly asked for a change — never \
         edit speculatively. Always read the file with \
         `read_project_file` first when modifying existing code so you \
         don't blow away unrelated content. Returns the new size on \
         success.",
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Project-relative path. For existing \
                        files use the path exactly as it appears in the \
                        <tree>. For new files use a sensible path \
                        relative to the project root."
                },
                "content": {
                    "type": "string",
                    "description": "The complete new file body. This \
                        REPLACES whatever was there — partial edits are \
                        not supported."
                }
            },
            "required": ["path", "content"],
            "additionalProperties": false
        }),
    );

    b.build()
}

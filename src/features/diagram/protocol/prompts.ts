/**
 * Prompt fragments appended to round-2 (execute) visual-edit prompts.
 *
 * These tell Claude (a) it must end its response with an `added_arrows`
 * JSON tail so the diagram knows what new dependencies appeared, and
 * (b) exactly which file paths are reachable so it doesn't hallucinate
 * "src/types/..." when the project root is "mcp_excalidraw/".
 *
 * Pure functions, no React, no runtime side effects. The dispatch
 * sites that assemble round-1 / round-2 prompts pull in these
 * fragments via array concatenation.
 */

/**
 * Trailing instruction appended to round-2 execute prompts. Asks
 * Claude to emit ONE more fenced JSON code block AFTER its text
 * summary, listing arrows that should now be drawn between blocks
 * (because the code change actually introduced a dependency). Diagram
 * side parses + draws those arrows with a glow animation so the user
 * sees how the new module hooks into the rest of the system without
 * a full regen.
 *
 * `newBlockLabel` is the label of any just-created block (the option
 * title); empty for non-new-block flows.
 */
export function buildArrowJsonSuffix(
  newBlockLabel: string,
  existingBlockLabels: string[] = [],
): string[] {
  const labelsLine =
    existingBlockLabels.length > 0
      ? `Existing block labels (use these EXACTLY, including capitalization): ${existingBlockLabels.map((l) => `"${l}"`).join(", ")}.`
      : "";
  return [
    "",
    `MANDATORY: end your response with a fenced JSON code block listing arrows that should now appear on the diagram. This is how the canvas learns about new dependencies your edit just created. Format:`,
    "",
    "```json",
    `{`,
    `  "added_arrows": [`,
    `    { "from": "<source block label>", "to": "<target block label>", "label": "<short verb>" }`,
    `  ]`,
    `}`,
    "```",
    "",
    `Example — if you added \`import { foo } from '../canvas/server'\` in App.tsx:`,
    "```json",
    `{ "added_arrows": [ { "from": "Frontend App", "to": "Canvas Server", "label": "imports" } ] }`,
    "```",
    "",
    labelsLine,
    newBlockLabel
      ? `Plus your new block appears on the diagram with the label "${newBlockLabel}" — use that exact string in "from" or "to".`
      : "",
    "",
    `If your edit truly created no new block-to-block dependency, still emit the block with an empty list: \`{ "added_arrows": [] }\`. Never skip the block.`,
  ].filter((l) => l !== "" || true); // keep blank lines for readability
}

/**
 * Compact file-tree block injected into round-2 execute prompts so
 * Claude doesn't invent plausible-but-wrong paths (e.g. "src/types/..."
 * when the project root is "mcp_excalidraw/"). The system prompt
 * already lists every path, but by round-2 enough tokens have flowed
 * past that the model often forgets and guesses — the inline
 * reminder right next to the read/edit instruction fixes that.
 *
 * Capped at ~80 paths to keep prompt size sane; for larger uploads we
 * surface the count + the first 80 sorted paths. Even huge repos
 * usually have their top-level shape captured in the first dozen.
 */
export function buildFileTreeBlock(paths: string[]): string[] {
  const MAX = 80;
  const sorted = [...paths].sort();
  const shown = sorted.slice(0, MAX);
  const lines = [
    "",
    `<project_files count="${paths.length}">`,
    ...shown,
    paths.length > MAX
      ? `... (${paths.length - MAX} more files — read_project_file with one of the listed paths)`
      : "",
    "</project_files>",
    `Every \`read_project_file\` / \`edit_project_file\` / \`write_project_file\` path MUST be one of the entries above, character-for-character. Do NOT invent paths like "src/..." if no such prefix appears in the tree — the project root may be nested (e.g. "mcp_excalidraw/src/...").`,
  ];
  return lines.filter((l) => l !== "");
}

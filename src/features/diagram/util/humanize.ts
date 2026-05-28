/**
 * Convert an identifier (function/method name) into a label readable by
 * a non-coder. Used by FunctionBubble so the floating bubbles read as
 * "Download image" rather than `download_image`.
 *
 * Intentionally minimal:
 *   - `snake_case` + `kebab-case` → space-separated
 *   - `camelCase` and `PascalCase` → space-separated
 *   - `ABCDef` (acronym + Pascal) → `AB Cdef`
 *   - lowercase the whole thing, capitalize the first letter
 *
 * Does NOT try to add context that isn't in the name (e.g. won't turn
 * `download_image` into "Download conversation image" — that requires
 * LLM-generated labels and lives on the schema, not here).
 */
export function humanizeFunctionName(raw: string): string {
  if (!raw) return raw;
  const spaced = raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return spaced.length === 0 ? raw : spaced[0].toUpperCase() + spaced.slice(1);
}

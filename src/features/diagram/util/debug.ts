/**
 * Tiny dev-only debug logger for the diagram feature.
 *
 * Production builds drop these calls entirely — Vite tree-shakes any
 * branch guarded by `import.meta.env.DEV`. Dev builds default to quiet:
 * set the `VITE_DIAGRAM_DEBUG` env var to a comma-separated list of
 * scopes (e.g. `recent-debug,diagram/focus`) to opt in, or set it to
 * `*` to enable all scopes.
 *
 * Scopes currently in use:
 *  - `recent-debug` — the recent-changes glow + settle-effect machinery
 *  - `diagram/structure` — NDJSON stream of view=structure events
 *  - `diagram/focus` — NDJSON stream of view=focus events
 *
 * `dwarn` is always enabled in dev for real diagnostics that should
 * always surface to the console (e.g. unresolved arrow labels).
 */

const RAW = (import.meta.env.VITE_DIAGRAM_DEBUG ?? "") as string;
const ENABLED_SCOPES = new Set(RAW.split(",").filter(Boolean));
const ENABLE_ALL = ENABLED_SCOPES.has("*");

/**
 * Match by prefix so `VITE_DIAGRAM_DEBUG=recent-debug` enables both
 * the bare `recent-debug` scope and labelled variants like
 * `recent-debug:settle entry — schema snapshot`.
 */
function scopeMatches(scope: string): boolean {
  if (ENABLE_ALL) return true;
  for (const enabled of ENABLED_SCOPES) {
    if (scope === enabled) return true;
    if (scope.startsWith(`${enabled}:`)) return true;
  }
  return false;
}

export function dlog(scope: string, payload?: unknown): void {
  if (!import.meta.env.DEV) return;
  if (!scopeMatches(scope)) return;
  // eslint-disable-next-line no-console
  console.log(`[${scope}]`, payload);
}

export function dwarn(scope: string, ...args: unknown[]): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.warn(`[${scope}]`, ...args);
}

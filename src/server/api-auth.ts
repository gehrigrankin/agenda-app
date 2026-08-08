import "server-only";

/**
 * Authentication for the machine-facing HTTP API (the MCP server and the
 * legacy `POST /api/tasks` route). Distinct from Clerk, which authenticates
 * *people* in the browser: these callers are scripts and assistants holding a
 * shared secret.
 *
 * Two env vars, both required, and it FAILS CLOSED on either.
 *
 * The failing-closed part is the whole point. The previous version of this
 * logic resolved the owner by falling back to "the first row in user_settings,
 * else the first row in tasks, else the first row in notes" when
 * `TASKS_API_OWNER_ID` was unset. For one endpoint that creates a task, that
 * was untidy. For an API that can read and rewrite every note in the database,
 * guessing whose data to operate on is not a behavior worth having at any
 * scale — so an unset owner is a 503, not a lookup.
 */

/** Env var holding the shared bearer token. `TASKS_API_TOKEN` is the legacy name. */
const TOKEN_VARS = ["NOTARIUM_API_TOKEN", "TASKS_API_TOKEN"] as const;
/** Env var pinning the owner every API call acts as. */
const OWNER_VARS = ["NOTARIUM_API_OWNER_ID", "TASKS_API_OWNER_ID"] as const;

export type ApiAuthResult =
  | { ok: true; ownerId: string }
  | { ok: false; status: 401 | 503; error: string };

function firstSet(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * Constant-time-ish comparison. Not a defense against a determined attacker
 * over a network with jitter, but it costs nothing and removes the trivial
 * early-exit signal from `!==`.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Check the `Authorization: Bearer …` header and resolve the owner all API
 * work runs as. Callers must handle every branch — there is no throw.
 */
export function authenticateApiRequest(req: Request): ApiAuthResult {
  const token = firstSet(TOKEN_VARS);
  if (!token) {
    return {
      ok: false,
      status: 503,
      error: "NOTARIUM_API_TOKEN is not set — the API is disabled.",
    };
  }
  const ownerId = firstSet(OWNER_VARS);
  if (!ownerId) {
    // Deliberately a 503 and not a guess: see the header comment.
    return {
      ok: false,
      status: 503,
      error:
        "NOTARIUM_API_OWNER_ID is not set — refusing to guess which account to act as.",
    };
  }

  const provided = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!provided || !tokensMatch(provided, token)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true, ownerId };
}

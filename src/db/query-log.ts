/**
 * Wall-clock timing for every database query.
 *
 * WHY a fetch wrapper instead of Drizzle's `logger` option: Drizzle's logger
 * fires *before* the statement is dispatched, so it can report the SQL but can
 * never report how long the statement took — by the time it runs, nothing has
 * happened yet. The `neon-http` driver sends each query as a single HTTPS POST
 * whose JSON body already contains the SQL text and its params, so wrapping the
 * fetch function measures the true round trip AND carries the SQL with it, with
 * no cross-call correlation to get wrong when several queries are in flight at
 * once (which is the normal case in a React Server Component render).
 *
 * Log lines are single-line and greppable — filter with `grep '\[db\]'` and
 * `grep SLOW`:
 *
 *   [db] 412.3ms SLOW params=2 sql="select "notes"."id", … limit $2"
 *   [db] 12.0ms ERROR err="fetch failed" params=1 sql="insert into "tasks" …"
 *
 * PRIVACY: param *values* are note bodies, task titles and owner ids, so they
 * are never logged by default — only the count. Set DB_LOG_PARAMS=1 to include
 * values (local debugging only; never in a deployed environment).
 */

/** How much to log. `slow` only emits statements over the threshold. */
export type DbLogMode = "off" | "slow" | "all";

/** Max characters of SQL kept on a log line, so one query stays one line. */
const SQL_MAX_CHARS = 300;

/** Max characters of the stringified params when DB_LOG_PARAMS is on. */
const PARAMS_MAX_CHARS = 300;

function parseMode(raw: string | undefined, fallback: DbLogMode): DbLogMode {
  switch (raw?.trim().toLowerCase()) {
    case "off":
    case "false":
    case "0":
      return "off";
    case "slow":
      return "slow";
    case "all":
    case "true":
    case "1":
      return "all";
    default:
      return fallback;
  }
}

/**
 * Resolved logging config. Read once at import: these are plain env reads that
 * cannot throw, so a missing DATABASE_URL (or a missing DB_LOG) is a no-op.
 * Default is on in development, off everywhere else — production logs should
 * not carry a line per query unless someone opts in.
 */
export const dbLogMode: DbLogMode = parseMode(
  process.env.DB_LOG,
  process.env.NODE_ENV === "development" ? "all" : "off",
);

/** Statements at or above this many ms are marked SLOW. */
export const dbLogSlowMs: number = (() => {
  const parsed = Number(process.env.DB_LOG_SLOW_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
})();

const logParamValues =
  process.env.DB_LOG_PARAMS === "1" || process.env.DB_LOG_PARAMS === "true";

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Collapse whitespace so a multi-line statement stays on one log line. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

type QueryShape = { query?: unknown; params?: unknown };

/**
 * Pull the SQL text and param count out of a neon-http request body. The body
 * is `{ query, params }` for a single statement and `{ queries: [...] }` for a
 * batch; anything unrecognised degrades to a placeholder rather than throwing,
 * because a broken log line must never break a query.
 */
function describeBody(body: unknown): { sql: string; params: unknown[] } {
  if (typeof body !== "string") return { sql: "<non-json body>", params: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { sql: "<unparsed body>", params: [] };
  }

  const statements: QueryShape[] = Array.isArray(
    (parsed as { queries?: unknown })?.queries,
  )
    ? ((parsed as { queries: QueryShape[] }).queries ?? [])
    : [parsed as QueryShape];

  const sql = statements
    .map((s) => (typeof s?.query === "string" ? oneLine(s.query) : "<no sql>"))
    .join("; ");
  const params = statements.flatMap((s) =>
    Array.isArray(s?.params) ? s.params : [],
  );

  return { sql, params };
}

function formatParams(params: unknown[]): string {
  if (!logParamValues) return `params=${params.length}`;
  let rendered: string;
  try {
    rendered = JSON.stringify(params) ?? String(params);
  } catch {
    rendered = "<unserializable>";
  }
  return `params=${params.length} values=${truncate(rendered, PARAMS_MAX_CHARS)}`;
}

function emit(
  durationMs: number,
  body: unknown,
  extra: string,
  isError: boolean,
) {
  const slow = durationMs >= dbLogSlowMs;
  if (dbLogMode === "slow" && !slow && !isError) return;

  const { sql, params } = describeBody(body);
  const line = [
    "[db]",
    `${durationMs.toFixed(1)}ms`,
    slow ? "SLOW" : null,
    extra,
    formatParams(params),
    `sql="${truncate(sql, SQL_MAX_CHARS)}"`,
  ]
    .filter(Boolean)
    .join(" ");

  if (isError) console.error(line);
  else if (slow) console.warn(line);
  else console.log(line);
}

/** Marks a wrapped fetch so a re-import never wraps it twice. */
const INSTRUMENTED = Symbol.for("agenda-app.db.instrumentedFetch");

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Wrap a fetch implementation so every neon-http round trip is timed. Returns
 * the original function untouched when logging is off, so the instrumented and
 * production paths are literally the same code.
 */
export function withQueryLogging(baseFetch: FetchFn = fetch): FetchFn {
  if (dbLogMode === "off") return baseFetch;
  // Dev hot-reload can re-evaluate this module; wrapping an already-wrapped
  // fetch would double every log line.
  if (INSTRUMENTED in baseFetch) return baseFetch;

  const loggedFetch: FetchFn = async function loggedFetch(input, init) {
    const startedAt = performance.now();
    try {
      const response = await baseFetch(input, init);
      const durationMs = performance.now() - startedAt;
      emit(
        durationMs,
        init?.body,
        response.ok ? "" : `HTTP_${response.status}`,
        !response.ok,
      );
      return response;
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      emit(durationMs, init?.body, `ERROR err="${oneLine(message)}"`, true);
      throw error;
    }
  };

  return Object.defineProperty(loggedFetch, INSTRUMENTED, { value: true });
}

import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { dbLogMode, dbLogSlowMs, withQueryLogging } from "./query-log";
import * as schema from "./schema";

/**
 * Whether a database connection is configured. When false, the app still loads
 * (read paths degrade to empty) so a missing DATABASE_URL never takes the whole
 * UI down — it just means nothing persists until it's set.
 */
export const isDbConfigured = Boolean(process.env.DATABASE_URL);

if (!isDbConfigured) {
  console.warn(
    "[db] DATABASE_URL is not set — notes will not persist. Set it in your environment (e.g. Vercel project settings).",
  );
}

// Time every statement by wrapping the driver's fetch (see ./query-log for the
// full rationale): Drizzle's own `logger` hook runs *before* a statement is
// dispatched, so it can print the SQL but never a duration — and duration is
// the whole point when hunting slow queries. The neon-http driver reads
// `fetchFunction` off the global `neonConfig` (a per-call option is ignored),
// so this also covers the migration runner's own neon() client — which is what
// we want. When DB_LOG is off, `withQueryLogging` hands back plain `fetch` and
// we leave neonConfig untouched, so production runs uninstrumented code.
if (dbLogMode !== "off") {
  neonConfig.fetchFunction = withQueryLogging(
    (neonConfig.fetchFunction as typeof fetch | undefined) ?? fetch,
  );
  console.log(
    `[db] query logging enabled (DB_LOG=${dbLogMode}, slow threshold ${dbLogSlowMs}ms). Param values are redacted unless DB_LOG_PARAMS=1.`,
  );
}

// neon-http is great for serverless request/response work. Note: it does NOT
// support interactive transactions. If/when we need multi-statement
// transactions, swap to the `drizzle-orm/neon-serverless` Pool driver — the
// schema and query code stay the same.
//
// We pass a harmless placeholder when unset so importing this module never
// throws; actual queries fail at call time and are handled by callers.
const sql = neon(
  process.env.DATABASE_URL ?? "postgresql://unset:unset@localhost/unset",
);

export const db = drizzle(sql, { schema });

export { schema };

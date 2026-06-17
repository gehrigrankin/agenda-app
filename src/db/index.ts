import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

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

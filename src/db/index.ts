import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
}

// neon-http is great for serverless request/response work. Note: it does NOT
// support interactive transactions. If/when we need multi-statement
// transactions (e.g. reconciling note content + task rows atomically), swap to
// the `drizzle-orm/neon-serverless` Pool driver — the schema and query code
// stay the same.
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export { schema };

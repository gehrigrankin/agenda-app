/**
 * Manually apply Drizzle migrations (run from a machine that can reach the DB).
 *
 * Run: `npm run db:migrate`  (reads DATABASE_URL from .env.local)
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { runMigrations } from "../src/db/run-migrations";

console.log("Applying migrations from ./drizzle …");
runMigrations()
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

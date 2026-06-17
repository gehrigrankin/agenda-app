/**
 * Runs DB migrations during the Vercel build (where egress to Neon is allowed)
 * and is a no-op everywhere else, so local `npm run build` never needs the DB.
 * Wired into the "build" script: `predeploy-migrate && next build`.
 */
import { runMigrations } from "../src/db/run-migrations";

async function main() {
  if (!process.env.VERCEL) {
    console.log("[predeploy-migrate] not on Vercel — skipping migrations.");
    return;
  }
  console.log("[predeploy-migrate] applying migrations …");
  await runMigrations();
  console.log("[predeploy-migrate] done.");
}

main().catch((err) => {
  console.error("[predeploy-migrate] failed:", err);
  process.exit(1);
});

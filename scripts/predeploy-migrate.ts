/**
 * Best-effort DB migration during the Vercel build (where egress to Neon is
 * allowed); a no-op everywhere else, so local `npm run build` never needs the
 * DB.
 *
 * IMPORTANT: this never fails the build. A migration problem must not take the
 * whole deploy down — the app degrades gracefully without a DB, and a failure
 * here is logged loudly for follow-up rather than blocking the release.
 */
import { runMigrations } from "../src/db/run-migrations";

async function main() {
  if (!process.env.VERCEL) {
    console.log("[predeploy-migrate] not on Vercel — skipping migrations.");
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.warn("[predeploy-migrate] DATABASE_URL not set — skipping.");
    return;
  }
  try {
    console.log("[predeploy-migrate] applying migrations …");
    await runMigrations();
    console.log("[predeploy-migrate] done.");
  } catch (err) {
    console.error(
      "[predeploy-migrate] migration FAILED (continuing build anyway):",
      err,
    );
  }
}

main();

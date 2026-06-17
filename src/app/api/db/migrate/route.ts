import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { runMigrations } from "@/db/run-migrations";

// On-demand migration runner. Requires a signed-in user (so it isn't open to
// the world); migrations are idempotent, so re-hitting it is safe. Returns the
// outcome as JSON — including the error — so it can be diagnosed from a browser
// without server-log access.
//
// `?reset=1` drops and recreates the `public` schema before migrating, for
// recovering from a corrupted/half-migrated database. DESTRUCTIVE — wipes all
// data. Only safe because there is no real data yet.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Sign in first, then reload this URL." },
      { status: 401 },
    );
  }

  const reset = new URL(req.url).searchParams.get("reset") === "1";

  try {
    if (reset) {
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(process.env.DATABASE_URL);
      await sql`DROP SCHEMA IF EXISTS public CASCADE`;
      await sql`CREATE SCHEMA public`;
    }

    await runMigrations();

    return NextResponse.json({
      ok: true,
      message: reset
        ? "Schema reset and migrations applied ✅"
        : "Migrations applied ✅",
    });
  } catch (err) {
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}

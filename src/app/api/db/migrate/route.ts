import { timingSafeEqual } from "node:crypto";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { runMigrations } from "@/db/run-migrations";

// On-demand migration runner, gated behind MIGRATE_SECRET. The route 404s when
// the secret isn't configured, and every request must present the secret via
// the `x-migrate-key` header or `?key=` param (plus be signed in). Migrations
// are idempotent, so re-hitting it is safe. Returns the outcome as JSON —
// including the error — so it can be diagnosed from a browser without
// server-log access.
//
// `?reset=1` drops and recreates the `public` schema before migrating, for
// recovering from a corrupted/half-migrated database. DESTRUCTIVE — wipes all
// data — which is why the whole route requires the shared secret.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const secret = process.env.MIGRATE_SECRET;
  if (!secret) {
    // Route is disabled unless explicitly opted in via env.
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(req.url);
  const provided = req.headers.get("x-migrate-key") ?? url.searchParams.get("key");
  if (!secretMatches(provided, secret)) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid migrate key." },
      { status: 403 },
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Sign in first, then reload this URL." },
      { status: 401 },
    );
  }

  const reset = url.searchParams.get("reset") === "1";

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

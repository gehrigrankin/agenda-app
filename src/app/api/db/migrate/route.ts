import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { runMigrations } from "@/db/run-migrations";

// On-demand migration runner. Requires a signed-in user (so it isn't open to
// the world); migrations are idempotent, so re-hitting it is safe. Returns the
// outcome as JSON — including the error — so it can be diagnosed from a browser
// without server-log access.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Sign in first, then reload this URL." },
      { status: 401 },
    );
  }

  try {
    await runMigrations();
    return NextResponse.json({ ok: true, message: "Migrations applied ✅" });
  } catch (err) {
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}

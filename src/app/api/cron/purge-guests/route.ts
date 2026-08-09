import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import {
  GUEST_RETENTION_DAYS,
  listPurgeableGuests,
  purgeGuestWorkspace,
} from "@/server/guest";

/**
 * Sweeps abandoned guest workspaces, hit by Vercel cron daily (see
 * vercel.json). Two kinds go: guests untouched for GUEST_RETENTION_DAYS (their
 * cookie has expired, so nobody can reach those rows again) and guests already
 * folded into a real account (their rows moved; only the marker is left).
 *
 * Batched and idempotent — with no transactions available, a run that dies
 * partway just leaves work for tomorrow. Raise the batch only if the backlog
 * outpaces a daily run.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron requests.
 * Local/manual trigger (cron never runs in dev): the same GET also accepts
 * the secret as a query param —
 *   curl "http://localhost:3000/api/cron/purge-guests?secret=$CRON_SECRET"
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 200;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured) {
    return NextResponse.json({ skipped: "db not configured" });
  }

  const guests = await listPurgeableGuests(BATCH);

  let purged = 0;
  let failed = 0;
  for (const ownerId of guests) {
    try {
      await purgeGuestWorkspace(ownerId);
      purged += 1;
    } catch (err) {
      // Its guest_sessions row survives, so tomorrow's run retries it.
      failed += 1;
      console.error("[guest] purge failed for one workspace:", err);
    }
  }

  return NextResponse.json({
    retentionDays: GUEST_RETENTION_DAYS,
    candidates: guests.length,
    purged,
    failed,
    more: guests.length === BATCH,
  });
}

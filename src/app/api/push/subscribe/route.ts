import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnerId } from "@/app/app/owner";
import { isDbConfigured } from "@/db";
import { deleteSubscription, saveSubscription } from "@/server/push";

/**
 * Authed endpoint the Settings "Reminders" row talks to:
 *   POST   { endpoint, keys: { p256dh, auth } }  — save/refresh a subscription
 *   DELETE { endpoint }                          — remove this browser's row
 *
 * The body of POST is PushSubscription.toJSON() straight from the browser.
 * Owner scoping comes from the resolved owner, never the payload.
 */

export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const parsed = subscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await saveSubscription(ownerId, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const parsed = unsubscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await deleteSubscription(ownerId, parsed.data.endpoint);
  return NextResponse.json({ ok: true });
}

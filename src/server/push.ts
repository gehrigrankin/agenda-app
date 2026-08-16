import "server-only";

import { and, eq } from "drizzle-orm";
import webpush from "web-push";

import { db } from "@/db";
import { pushSubscriptions, type PushSubscriptionRow } from "@/db/schema";

/**
 * Data-access + delivery layer for Web Push subscriptions.
 *
 * Delivery contract: payloads are JSON `{ title, body, url, tag? }` — exactly
 * what public/sw.js's `push` handler expects. Keep the two in sync.
 *
 * Mirrors the isDbConfigured degradation pattern: when the VAPID env vars are
 * missing, `isPushConfigured` is false and `sendToOwner` is a silent no-op —
 * nothing throws at import time or call time for an unconfigured deploy.
 */

export const isPushConfigured = Boolean(
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT,
);

if (isPushConfigured) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
} else {
  console.warn(
    "[push] VAPID env vars not set — web-push notifications are disabled.",
  );
}

/** Payload shape the service worker's `push` handler expects. */
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  /** Notification tag — same tag replaces rather than stacks. */
  tag?: string;
  /** Enables the service worker's task-specific Snooze action. */
  taskId?: string;
};

/**
 * Upsert a browser's subscription. The push endpoint URL is globally unique,
 * so it is the conflict key; a re-subscribe from the same browser refreshes
 * keys + lastSeenAt (and re-owns the row, should the endpoint ever be handed
 * to a different signed-in user on a shared device).
 */
export async function saveSubscription(
  ownerId: string,
  sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
): Promise<PushSubscriptionRow> {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      ownerId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent: sub.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        ownerId,
        p256dh: sub.p256dh,
        auth: sub.auth,
        userAgent: sub.userAgent ?? null,
        lastSeenAt: new Date(),
      },
    })
    .returning();
  return row;
}

/** Delete a subscription by endpoint, owner-scoped. */
export async function deleteSubscription(
  ownerId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.ownerId, ownerId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
}

export async function listSubscriptionsForOwner(
  ownerId: string,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.ownerId, ownerId));
}

/** Distinct owners that have at least one subscription (cron fan-out). */
export async function listOwnersWithSubscriptions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ ownerId: pushSubscriptions.ownerId })
    .from(pushSubscriptions);
  return rows.map((r) => r.ownerId);
}

/**
 * Send one push to every subscription the owner has. Subscriptions the push
 * service reports as gone (404 / 410) are pruned; other per-subscription
 * failures are logged and swallowed — one dead device must not block the
 * rest. Returns the number of successful sends (0 when push is unconfigured).
 */
export async function sendToOwner(
  ownerId: string,
  payload: PushPayload,
): Promise<number> {
  if (!isPushConfigured) return 0;
  const subs = await listSubscriptionsForOwner(ownerId);
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription expired or was revoked — prune it.
        await deleteSubscription(sub.ownerId, sub.endpoint);
      } else {
        console.error(
          `[push] send failed (status ${statusCode ?? "?"}) for ${sub.endpoint.slice(0, 48)}…:`,
          err,
        );
      }
    }
  }
  return sent;
}

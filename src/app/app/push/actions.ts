"use server";

import { getSettings, updateSettings } from "@/server/settings";
import { isPushConfigured, sendToOwner } from "@/server/push";
import { isDbConfigured } from "@/db";

import { requireOwnerId } from "../owner";

/**
 * Server actions for the web-push reminder feature (Settings → Reminders
 * row). Same contract as ../actions.ts: Clerk auth via requireOwnerId,
 * owner-scoped repo calls, plain serializable return shapes. The
 * subscription save/delete itself goes through POST/DELETE
 * /api/push/subscribe (the browser posts its raw PushSubscription there).
 */

/** Loose IANA zone check ("America/Chicago", "UTC", "Etc/GMT+2"). */
function isValidTimezone(tz: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist the browser's IANA timezone when it differs from what's stored.
 * Called on every Settings-row mount, so travel (or a first visit) keeps the
 * reminder cron firing at the right wall-clock instants.
 */
export async function syncTimezoneAction(timezone: string): Promise<void> {
  const ownerId = await requireOwnerId();
  if (!isDbConfigured || !isValidTimezone(timezone)) return;
  const settings = await getSettings(ownerId);
  if (settings.timezone === timezone) return;
  await updateSettings(ownerId, { timezone });
}

export interface TestNotificationResult {
  configured: boolean;
  sent: number;
}

/**
 * Fire an immediate push to every device the user has enabled — the
 * end-to-end check after installing the PWA. Returns how many devices were
 * reached (0 with configured=false when VAPID env is missing).
 */
export async function sendTestNotificationAction(): Promise<TestNotificationResult> {
  const ownerId = await requireOwnerId();
  if (!isPushConfigured || !isDbConfigured) {
    return { configured: isPushConfigured, sent: 0 };
  }
  const sent = await sendToOwner(ownerId, {
    title: "Reminders are working",
    body: "This is a test notification from Settings.",
    url: "/app",
    tag: "test-notification",
  });
  return { configured: true, sent };
}

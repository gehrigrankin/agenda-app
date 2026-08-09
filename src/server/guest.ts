import "server-only";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  attachments,
  automationRuns,
  automations,
  bubbles,
  calendarEvents,
  captureInbox,
  gardenerSuggestions,
  guestSessions,
  meetingDeclines,
  noteLogs,
  notes,
  people,
  personCommitments,
  personMentions,
  pushSubscriptions,
  recurringTasks,
  taskBlocks,
  tasks,
  tags,
  threadMentions,
  threads,
  uploadBlobs,
  userSettings,
  voiceMemos,
  weekReviews,
} from "@/db/schema";

/**
 * Guest workspaces: registering them, folding one into a real account on
 * sign-up, and sweeping the abandoned ones.
 *
 * Everything here is owner-scoped by an opaque string like the rest of
 * `src/server/*` — the caller decides who the owner is (see
 * `src/app/app/owner.ts`); this module only takes ids.
 *
 * No transactions: the neon-http driver has none, so both the claim and the
 * purge are sequences of independent statements. Each is written to be
 * re-runnable — a claim that dies halfway leaves the cookie in place and
 * finishes on the next request, and a purge that dies halfway resumes on the
 * next cron. That is why the `guest_sessions` row is retired LAST in both.
 */

/** Guests untouched for this long are swept; matches `GUEST_COOKIE_MAX_AGE`. */
export const GUEST_RETENTION_DAYS = 30;

/** Registers a guest workspace, or refreshes its last-seen stamp. */
export async function touchGuestSession(ownerId: string): Promise<void> {
  // Once-a-day granularity is all the purge needs, and the WHERE keeps this a
  // no-op write on all but the first request of a guest's day.
  await db
    .insert(guestSessions)
    .values({ ownerId })
    .onConflictDoUpdate({
      target: guestSessions.ownerId,
      set: { lastSeenAt: sql`now()` },
      where: lt(guestSessions.lastSeenAt, sql`now() - interval '1 day'`),
    });
}

export type ClaimResult =
  | { status: "claimed"; rows: number }
  | { status: "nothing-to-claim" }
  | { status: "already-claimed" }
  | { status: "target-not-empty" };

/**
 * Re-owns every row belonging to `guestOwnerId` to `userOwnerId` — how a guest
 * keeps their work when they sign up.
 *
 * Deliberately refuses to merge into an account that already has data. Nine
 * owner-scoped unique indexes would have to be reconciled row by row
 * (`bubbles_owner_root_uq` alone guarantees a collision, since both sides have
 * a root bubble), and there is no transaction to roll back a half-merge that
 * hits one. Refusing keeps the guest's rows intact and untouched rather than
 * risking both workspaces; the case that actually matters — try the app, then
 * sign up — always lands on an empty account.
 */
export async function claimGuestWorkspace(
  guestOwnerId: string,
  userOwnerId: string,
): Promise<ClaimResult> {
  const [session] = await db
    .select()
    .from(guestSessions)
    .where(eq(guestSessions.ownerId, guestOwnerId))
    .limit(1);

  if (!session) return { status: "nothing-to-claim" };
  if (session.claimedByOwnerId) {
    return session.claimedByOwnerId === userOwnerId
      ? { status: "already-claimed" }
      : // Someone else's cookie. Never move rows on a second claim.
        { status: "target-not-empty" };
  }

  if (!(await isWorkspaceEmpty(userOwnerId))) {
    return { status: "target-not-empty" };
  }

  // Ordering is irrelevant to correctness here — an ownerId rewrite touches no
  // foreign key — so this is just the delete order read backwards, keeping the
  // parent tables adjacent to their children for readability.
  const owned = [
    notes,
    tags,
    recurringTasks,
    tasks,
    noteLogs,
    attachments,
    uploadBlobs,
    bubbles,
    userSettings,
    threads,
    threadMentions,
    automations,
    automationRuns,
    voiceMemos,
    meetingDeclines,
    weekReviews,
    people,
    personMentions,
    personCommitments,
    gardenerSuggestions,
    taskBlocks,
    calendarEvents,
    captureInbox,
    pushSubscriptions,
  ];

  let rows = 0;
  for (const table of owned) {
    const result = await db
      .update(table)
      .set({ ownerId: userOwnerId })
      .where(eq(table.ownerId, guestOwnerId));
    rows += result.rowCount ?? 0;
  }

  // Last, so an interrupted claim re-runs instead of reporting success.
  await db
    .update(guestSessions)
    .set({ claimedByOwnerId: userOwnerId, claimedAt: sql`now()` })
    .where(eq(guestSessions.ownerId, guestOwnerId));

  return { status: "claimed", rows };
}

/**
 * Whether an owner has nothing worth protecting. Checks the tables a real
 * workspace cannot avoid touching — everything else in the schema is derived
 * from a note, a task, or an explicit settings write.
 */
async function isWorkspaceEmpty(ownerId: string): Promise<boolean> {
  const probes = [notes, tasks, bubbles, tags, people, userSettings] as const;
  for (const table of probes) {
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(table)
      .where(eq(table.ownerId, ownerId))
      .limit(1);
    if (row) return false;
  }
  return true;
}

/**
 * Guest owner ids that have gone `GUEST_RETENTION_DAYS` without a visit, plus
 * any already folded into a real account (their rows moved; the marker is all
 * that is left).
 */
export async function listPurgeableGuests(limit = 200): Promise<string[]> {
  const rows = await db
    .select({ ownerId: guestSessions.ownerId })
    .from(guestSessions)
    .where(
      or(
        sql`${guestSessions.claimedByOwnerId} is not null`,
        and(
          isNull(guestSessions.claimedByOwnerId),
          lt(
            guestSessions.lastSeenAt,
            sql`now() - make_interval(days => ${GUEST_RETENTION_DAYS})`,
          ),
        ),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.ownerId);
}

/**
 * Deletes everything a guest owns. Children first so each statement stands on
 * its own; the join tables (`note_tags`, `note_tasks`, `task_tags`,
 * `note_links`) have no `ownerId` and are removed by cascade from their
 * parents.
 */
export async function purgeGuestWorkspace(guestOwnerId: string): Promise<void> {
  const owned = [
    taskBlocks,
    threadMentions,
    threads,
    personCommitments,
    personMentions,
    people,
    automationRuns,
    automations,
    noteLogs,
    voiceMemos,
    weekReviews,
    captureInbox,
    attachments,
    gardenerSuggestions,
    tasks,
    recurringTasks,
    notes,
    bubbles,
    tags,
    uploadBlobs,
    calendarEvents,
    meetingDeclines,
    pushSubscriptions,
    userSettings,
  ];

  for (const table of owned) {
    await db.delete(table).where(eq(table.ownerId, guestOwnerId));
  }

  // Last again: while this row survives, the sweep knows there is work left.
  await db.delete(guestSessions).where(eq(guestSessions.ownerId, guestOwnerId));
}

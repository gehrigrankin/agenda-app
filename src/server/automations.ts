import "server-only";

import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";

import { db } from "@/db";
import { automationRuns, automations } from "@/db/schema";

/**
 * Data-access layer for plain-language automations (`automations`) and their
 * audit trail (`automation_runs`). Every action an automation takes is
 * recorded as a run carrying enough `undoData` to revert it.
 */

/**
 * All automations, newest first, each with its most recent run (or null).
 * `canUndo` = the run recorded undo data and hasn't been undone yet.
 */
export async function listAutomations(ownerId: string) {
  const rows = await db
    .select()
    .from(automations)
    .where(eq(automations.ownerId, ownerId))
    .orderBy(desc(automations.createdAt));
  if (rows.length === 0) return [];

  const runs = await db
    .select({
      id: automationRuns.id,
      automationId: automationRuns.automationId,
      summary: automationRuns.summary,
      undoData: automationRuns.undoData,
      undoneAt: automationRuns.undoneAt,
      createdAt: automationRuns.createdAt,
    })
    .from(automationRuns)
    .where(
      inArray(
        automationRuns.automationId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(desc(automationRuns.createdAt));

  // Runs arrive newest-first, so the first one seen per automation is latest.
  const latestByAutomation = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latestByAutomation.has(run.automationId)) {
      latestByAutomation.set(run.automationId, run);
    }
  }

  return rows.map((automation) => {
    const run = latestByAutomation.get(automation.id);
    return {
      ...automation,
      lastRun: run
        ? {
            id: run.id,
            summary: run.summary,
            createdAt: run.createdAt,
            undoneAt: run.undoneAt,
            canUndo: run.undoData != null && run.undoneAt === null,
          }
        : null,
    };
  });
}

export async function createAutomation(ownerId: string, rule: string) {
  const [automation] = await db
    .insert(automations)
    .values({ ownerId, rule })
    .returning();
  return automation;
}

export async function setAutomationEnabled(
  ownerId: string,
  id: string,
  enabled: boolean,
) {
  const [automation] = await db
    .update(automations)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(automations.id, id), eq(automations.ownerId, ownerId)))
    .returning();
  return automation ?? null;
}

/** Delete a rule; its runs cascade with it. */
export async function deleteAutomation(ownerId: string, id: string) {
  await db
    .delete(automations)
    .where(and(eq(automations.id, id), eq(automations.ownerId, ownerId)));
}

export async function listEnabledAutomations(ownerId: string) {
  return db
    .select()
    .from(automations)
    .where(and(eq(automations.ownerId, ownerId), eq(automations.enabled, true)));
}

export async function recordRun(
  ownerId: string,
  automationId: string,
  noteId: string | null,
  summary: string,
  undoData: unknown | null,
) {
  const [run] = await db
    .insert(automationRuns)
    .values({ ownerId, automationId, noteId, summary, undoData })
    .returning();
  return run;
}

export async function getRun(ownerId: string, runId: string) {
  const [run] = await db
    .select()
    .from(automationRuns)
    .where(
      and(eq(automationRuns.id, runId), eq(automationRuns.ownerId, ownerId)),
    )
    .limit(1);
  return run ?? null;
}

/**
 * Mark a run undone. The `undoneAt IS NULL` guard in the WHERE makes this a
 * one-shot claim (no transactions on Neon HTTP): a concurrent second undo
 * matches zero rows and returns null instead of reverting twice.
 */
export async function markRunUndone(ownerId: string, runId: string) {
  const [run] = await db
    .update(automationRuns)
    .set({ undoneAt: new Date() })
    .where(
      and(
        eq(automationRuns.id, runId),
        eq(automationRuns.ownerId, ownerId),
        isNull(automationRuns.undoneAt),
      ),
    )
    .returning();
  return run ?? null;
}

/**
 * When any automation last ran against a note — the save path uses this to
 * throttle re-running automations on every keystroke's autosave.
 */
export async function lastRunAtForNote(
  ownerId: string,
  noteId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ lastAt: max(automationRuns.createdAt) })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.ownerId, ownerId),
        eq(automationRuns.noteId, noteId),
      ),
    );
  return row?.lastAt ?? null;
}

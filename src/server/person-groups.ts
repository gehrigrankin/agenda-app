import "server-only";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { people, personGroupMembers, personGroups } from "@/db/schema";

/**
 * Data-access layer for People groups (`person_groups` + `person_group_members`,
 * Notes Sidebars design §5e). "Everyone" and "Close" (favorites) are virtual —
 * only user-made groups (Work, Music, …) live here. A person can sit in any
 * number of groups. Every function is owner-scoped; a membership is only
 * written after BOTH the group and the person are verified to be the owner's,
 * since ids arrive from the client.
 */

const NAME_MAX = 60;

export interface PersonGroupRow {
  id: string;
  name: string;
  sortOrder: number;
  memberCount: number;
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
}

/** The owner's groups in display order, each with its member count. */
export async function listGroups(ownerId: string): Promise<PersonGroupRow[]> {
  const groups = await db
    .select({
      id: personGroups.id,
      name: personGroups.name,
      sortOrder: personGroups.sortOrder,
    })
    .from(personGroups)
    .where(eq(personGroups.ownerId, ownerId))
    .orderBy(asc(personGroups.sortOrder), asc(personGroups.createdAt));
  if (groups.length === 0) return [];

  const counts = await db
    .select({ groupId: personGroupMembers.groupId, n: count() })
    .from(personGroupMembers)
    .where(
      inArray(
        personGroupMembers.groupId,
        groups.map((g) => g.id),
      ),
    )
    .groupBy(personGroupMembers.groupId);
  const byGroup = new Map(counts.map((c) => [c.groupId, c.n]));
  return groups.map((g) => ({ ...g, memberCount: byGroup.get(g.id) ?? 0 }));
}

/** Every (group, person) pair for the owner's groups — the client filters on it. */
export async function listMemberships(
  ownerId: string,
): Promise<Array<{ groupId: string; personId: string }>> {
  return db
    .select({
      groupId: personGroupMembers.groupId,
      personId: personGroupMembers.personId,
    })
    .from(personGroupMembers)
    .innerJoin(personGroups, eq(personGroupMembers.groupId, personGroups.id))
    .where(eq(personGroups.ownerId, ownerId));
}

/** Ids of the groups one person belongs to (owner-scoped through the group). */
export async function listGroupIdsForPerson(
  ownerId: string,
  personId: string,
): Promise<string[]> {
  const rows = await db
    .select({ groupId: personGroupMembers.groupId })
    .from(personGroupMembers)
    .innerJoin(personGroups, eq(personGroupMembers.groupId, personGroups.id))
    .where(
      and(
        eq(personGroupMembers.personId, personId),
        eq(personGroups.ownerId, ownerId),
      ),
    );
  return rows.map((r) => r.groupId);
}

/** Create a group (appended after the existing ones). Null for a blank name. */
export async function createGroup(
  ownerId: string,
  name: string,
): Promise<{ id: string; name: string; sortOrder: number } | null> {
  const clean = cleanName(name);
  if (!clean) return null;
  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${personGroups.sortOrder}), 0) + 1`.mapWith(
        Number,
      ),
    })
    .from(personGroups)
    .where(eq(personGroups.ownerId, ownerId));
  const [row] = await db
    .insert(personGroups)
    .values({ ownerId, name: clean, sortOrder: next })
    .returning({
      id: personGroups.id,
      name: personGroups.name,
      sortOrder: personGroups.sortOrder,
    });
  return row ?? null;
}

export async function renameGroup(
  ownerId: string,
  groupId: string,
  name: string,
): Promise<boolean> {
  const clean = cleanName(name);
  if (!clean) return false;
  const rows = await db
    .update(personGroups)
    .set({ name: clean })
    .where(and(eq(personGroups.id, groupId), eq(personGroups.ownerId, ownerId)))
    .returning({ id: personGroups.id });
  return rows.length > 0;
}

/** Delete a group (memberships cascade; the people stay). */
export async function deleteGroup(
  ownerId: string,
  groupId: string,
): Promise<void> {
  await db
    .delete(personGroups)
    .where(
      and(eq(personGroups.id, groupId), eq(personGroups.ownerId, ownerId)),
    );
}

async function ownsGroup(ownerId: string, groupId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: personGroups.id })
    .from(personGroups)
    .where(and(eq(personGroups.id, groupId), eq(personGroups.ownerId, ownerId)))
    .limit(1);
  return Boolean(row);
}

async function ownsPerson(ownerId: string, personId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.ownerId, ownerId)))
    .limit(1);
  return Boolean(row);
}

/** Put a person in a group. Both must be the owner's; idempotent. */
export async function addMember(
  ownerId: string,
  groupId: string,
  personId: string,
): Promise<boolean> {
  const [g, p] = await Promise.all([
    ownsGroup(ownerId, groupId),
    ownsPerson(ownerId, personId),
  ]);
  if (!g || !p) return false;
  await db
    .insert(personGroupMembers)
    .values({ groupId, personId })
    .onConflictDoNothing();
  return true;
}

export async function removeMember(
  ownerId: string,
  groupId: string,
  personId: string,
): Promise<boolean> {
  if (!(await ownsGroup(ownerId, groupId))) return false;
  await db
    .delete(personGroupMembers)
    .where(
      and(
        eq(personGroupMembers.groupId, groupId),
        eq(personGroupMembers.personId, personId),
      ),
    );
  return true;
}

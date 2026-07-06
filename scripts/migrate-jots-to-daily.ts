/**
 * One-time migration: fold every jot into its day's DAILY NOTE as a
 * timestamped block ("timed-paragraph" — see TimedParagraphNode), in
 * createdAt order. The redesign retires the jots feed; the daily note IS the
 * day's timeline now.
 *
 *   npx tsx scripts/migrate-jots-to-daily.ts            # dry run (default)
 *   npx tsx scripts/migrate-jots-to-daily.ts --apply    # write changes
 *   npx tsx scripts/migrate-jots-to-daily.ts --apply --owner user_xxx
 *
 * Safety properties (Neon HTTP has no transactions):
 * - IDEMPOTENT: each migrated block records its source jot id (`srcJotId`);
 *   re-runs skip jots whose id already appears in the day's content.
 * - CRASH-SAFE: exactly ONE content write per (owner, day) — a crash between
 *   days just means the next run picks up where it left off.
 * - NON-DESTRUCTIVE: jot rows are NOT deleted (drop the table in a later
 *   migration once this has been verified everywhere).
 *
 * NOTE: deliberately does not import src/server/* ("server-only" throws under
 * tsx); the daily-note get-or-create is replicated inline, race-safe via the
 * partial unique index on (owner_id, daily_date).
 */
import { config } from "dotenv";

config({ path: ".env.local" });

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run in production.");
}

const APPLY = process.argv.includes("--apply");
const ownerFlagIdx = process.argv.indexOf("--owner");
const OWNER_FILTER =
  ownerFlagIdx !== -1 ? (process.argv[ownerFlagIdx + 1] ?? null) : null;

/** "Sat, Jul 5" — copied from src/server/notes.ts (explicit locale + UTC). */
function dailyTitleFromString(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A "timed-paragraph" block (TimedParagraphNode's serialized shape). */
function jotBlock(jot: { id: string; text: string; createdAt: Date }) {
  return {
    type: "timed-paragraph",
    version: 1,
    timestamp: jot.createdAt.toISOString(),
    srcJotId: jot.id,
    children: [
      {
        detail: 0,
        format: 0,
        mode: "normal",
        style: "",
        text: jot.text,
        type: "text",
        version: 1,
      },
    ],
    direction: "ltr",
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
  };
}

const EMPTY_ROOT = () => ({
  root: {
    children: [] as unknown[],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
});

async function main() {
  // Imported after env is loaded so db/index.ts sees DATABASE_URL.
  const { db } = await import("../src/db");
  const { jots, notes } = await import("../src/db/schema");
  const { and, asc, eq, isNull } = await import("drizzle-orm");

  const allJots = await db
    .select()
    .from(jots)
    .orderBy(asc(jots.ownerId), asc(jots.jotDate), asc(jots.createdAt));

  const filtered = OWNER_FILTER
    ? allJots.filter((j) => j.ownerId === OWNER_FILTER)
    : allJots;

  // Group by (owner, local calendar day). jotDate is stored midnight UTC of
  // the user's local day, so the UTC date slice IS the calendar day.
  const groups = new Map<string, typeof filtered>();
  for (const jot of filtered) {
    const dateStr = jot.jotDate.toISOString().slice(0, 10);
    const key = `${jot.ownerId}|${dateStr}`;
    const group = groups.get(key) ?? [];
    group.push(jot);
    groups.set(key, group);
  }

  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — ${filtered.length} jots across ${groups.size} owner-days` +
      (OWNER_FILTER ? ` (owner ${OWNER_FILTER})` : ""),
  );

  let migrated = 0;
  let skipped = 0;

  for (const [key, group] of groups) {
    const [ownerId, dateStr] = key.split("|");
    const dailyDate = new Date(`${dateStr}T00:00:00.000Z`);

    // Live daily note for the day (get) …
    const selectExisting = async () => {
      const [existing] = await db
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.ownerId, ownerId),
            eq(notes.dailyDate, dailyDate),
            isNull(notes.deletedAt),
          ),
        )
        .limit(1);
      return existing ?? null;
    };

    let note = await selectExisting();

    // … or create it (race-safe: unique partial index is the backstop).
    if (!note && APPLY) {
      try {
        const [created] = await db
          .insert(notes)
          .values({ ownerId, title: dailyTitleFromString(dateStr), dailyDate })
          .returning();
        note = created;
      } catch (err) {
        note = await selectExisting();
        if (!note) throw err;
      }
    }

    const contentStr = note?.content ? JSON.stringify(note.content) : "";
    const pending = group.filter((j) => !contentStr.includes(j.id));
    skipped += group.length - pending.length;

    if (pending.length === 0) {
      console.log(`  ${key}: all ${group.length} jots already migrated`);
      continue;
    }

    if (!APPLY) {
      console.log(
        `  ${key}: would append ${pending.length} block(s)` +
          (note ? " to existing daily note" : " to a NEW daily note"),
      );
      for (const j of pending) {
        console.log(`      · [${j.createdAt.toISOString()}] ${j.text.slice(0, 60)}`);
      }
      migrated += pending.length;
      continue;
    }

    if (!note) throw new Error(`Daily note missing for ${key} in apply mode`);

    // Append blocks and write ONCE for the whole day.
    const content = (note.content ?? EMPTY_ROOT()) as {
      root: { children: unknown[] };
    };
    if (!content.root || !Array.isArray(content.root.children)) {
      console.warn(`  ${key}: malformed content — skipping day`);
      continue;
    }
    content.root.children.push(...pending.map(jotBlock));

    await db
      .update(notes)
      .set({ content, updatedAt: new Date() })
      .where(eq(notes.id, note.id));

    migrated += pending.length;
    console.log(`  ${key}: appended ${pending.length} block(s)`);
  }

  console.log(
    `\n${APPLY ? "Migrated" : "Would migrate"} ${migrated} jot(s); ${skipped} already done. Jot rows left in place.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

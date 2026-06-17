/**
 * Small DEV-ONLY seed. Creates a couple of tags, a note, and a task for a
 * placeholder owner so the app has something to render in local dev.
 *
 * Run: `npm run db:seed`
 * Requires DATABASE_URL in .env.local. Refuses to run in production.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed in production.");
}

async function main() {
  // Imported after env is loaded so db/index.ts sees DATABASE_URL.
  const { db } = await import("../src/db");
  const { tags, notes, tasks, noteTasks } = await import("../src/db/schema");

  // Placeholder Clerk-style user id. Replace with a real id to see seed data
  // while signed in as that user.
  const ownerId = process.env.SEED_OWNER_ID ?? "user_dev_seed";

  console.log(`Seeding for owner: ${ownerId}`);

  const [work] = await db
    .insert(tags)
    .values({ ownerId, name: "Work", isPinned: true })
    .returning();

  await db
    .insert(tags)
    .values({ ownerId, name: "Projects", parentId: work.id });

  const [note] = await db
    .insert(notes)
    .values({ ownerId, title: "Welcome to Agenda" })
    .returning();

  const [task] = await db
    .insert(tasks)
    .values({
      ownerId,
      title: "Try the foundation",
      priority: "medium",
      dueAt: new Date(),
    })
    .returning();

  await db.insert(noteTasks).values({ noteId: note.id, taskId: task.id });

  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * Rich DEV-ONLY seed that fills a single account with realistic dummy data so
 * every surface of the app has something to show: standalone notes with real
 * rich-text content, first-class tasks (embedded + standalone, overdue / due
 * today / upcoming / completed), the bubble map (nested tree with folders and
 * bubble-scoped notes), daily jot notes, trashed notes, and a
 * few tags.
 *
 * Run:  SEED_OWNER_ID=<clerk user id> npx tsx scripts/seed-dummy.ts
 * (defaults to the current test account's id if SEED_OWNER_ID is unset).
 *
 * It first WIPES all rows for that owner so re-running gives a clean set.
 * Refuses to run in production. Requires DATABASE_URL in .env.local.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed in production.");
}

// "Today" the app is designed around. Kept explicit so due/overdue buckets line
// up with the fixtures regardless of when this runs.
const TODAY = "2026-07-05";

// ---------------------------------------------------------------------------
// Lexical serialized-state builders. These emit the exact node shapes the
// editor's importJSON expects (see src/components/editor). Task nodes carry a
// cached copy of the DB task row; everything else is standard rich text.
// ---------------------------------------------------------------------------
type Run = string | { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; underline?: boolean };

function textNode(run: Run) {
  const r = typeof run === "string" ? { text: run } : run;
  let format = 0;
  if ("bold" in r && r.bold) format |= 1;
  if ("italic" in r && r.italic) format |= 2;
  if ("strike" in r && r.strike) format |= 4;
  if ("underline" in r && r.underline) format |= 8;
  if ("code" in r && r.code) format |= 16;
  return { detail: 0, format, mode: "normal", style: "", text: r.text, type: "text", version: 1 };
}

const runs = (rs: Run[]) => rs.map(textNode);
const el = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  children,
  direction: "ltr",
  format: "",
  indent: 0,
  type,
  version: 1,
  ...extra,
});

const P = (...rs: Run[]) => el("paragraph", runs(rs), { textFormat: 0, textStyle: "" });
const H1 = (t: string) => el("heading", runs([t]), { tag: "h1" });
const H2 = (t: string) => el("heading", runs([t]), { tag: "h2" });
const H3 = (t: string) => el("heading", runs([t]), { tag: "h3" });
const QUOTE = (...rs: Run[]) => el("quote", runs(rs));
const CODE = (code: string, language = "javascript") =>
  el("code", runs([code]), { language });
const HR = () => ({ type: "horizontalrule", version: 1 });

const listItem = (rs: Run[], extra: Record<string, unknown> = {}) =>
  el("listitem", runs(rs), { value: 1, ...extra });
const BULLETS = (items: Run[][]) =>
  el("list", items.map((it) => listItem(it)), { listType: "bullet", start: 1, tag: "ul" });
const NUMBERS = (items: Run[][]) =>
  el("list", items.map((it, i) => listItem(it, { value: i + 1 })), {
    listType: "number",
    start: 1,
    tag: "ol",
  });
const CHECKS = (items: { text: Run; checked: boolean }[]) =>
  el(
    "list",
    items.map((it) => listItem([it.text], { checked: it.checked })),
    { listType: "check", start: 1, tag: "ul" },
  );

// A task block: a marker the note builder replaces with a real DB task row + node.
type TaskSpec = {
  title: string;
  completed?: boolean;
  due?: string; // YYYY-MM-DD
  priority?: "none" | "low" | "medium" | "high";
  description?: string;
};
const TASK = (spec: TaskSpec) => ({ __task: spec });

function taskNode(taskId: string, spec: TaskSpec) {
  return {
    type: "task",
    version: 1,
    taskId,
    title: spec.title,
    completed: Boolean(spec.completed),
    dueAt: spec.due ? `${spec.due}T00:00:00.000Z` : null,
  };
}

const rootDoc = (children: unknown[]) => ({
  root: el("root", children, {}),
});

// ---------------------------------------------------------------------------
async function main() {
  const { db } = await import("../src/db");
  const {
    notes,
    tasks,
    noteTasks,
    noteLinks,
    tags,
    noteTags,
    bubbles,
    attachments,
  } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const ownerId =
    process.env.SEED_OWNER_ID ?? "user_3G6XlNsafcrl2kZCkdAV8OiyhZF";

  console.log(`Seeding dummy data for owner: ${ownerId}`);

  // --- Wipe existing data for this owner (clean reseed) ---------------------
  console.log("Wiping existing rows for owner…");
  await db.delete(tasks).where(eq(tasks.ownerId, ownerId)); // cascades note_tasks
  await db.delete(notes).where(eq(notes.ownerId, ownerId)); // cascades note_tags/links, nulls attachments
  await db.delete(attachments).where(eq(attachments.ownerId, ownerId));
  await db.delete(bubbles).where(eq(bubbles.ownerId, ownerId)); // self-ref cascade
  await db.delete(tags).where(eq(tags.ownerId, ownerId));

  const at = (iso: string) => new Date(iso);
  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

  // -------------------------------------------------------------------------
  // Note builder: inserts task rows for any TASK() blocks, embeds their nodes,
  // inserts the note, then wires up note_tasks links.
  // -------------------------------------------------------------------------
  async function makeNote(opts: {
    title: string;
    blocks: unknown[];
    bubbleId?: string;
    dailyDate?: Date;
    deletedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    const links: string[] = [];
    const resolved: unknown[] = [];
    for (const block of opts.blocks) {
      if (block && typeof block === "object" && "__task" in block) {
        const spec = (block as { __task: TaskSpec }).__task;
        const [task] = await db
          .insert(tasks)
          .values({
            ownerId,
            title: spec.title,
            description: spec.description ?? null,
            priority: spec.priority ?? "none",
            dueAt: spec.due ? day(spec.due) : null,
            completedAt: spec.completed ? at(`${TODAY}T17:30:00.000Z`) : null,
          })
          .returning();
        links.push(task.id);
        resolved.push(taskNode(task.id, spec));
      } else {
        resolved.push(block);
      }
    }

    const [note] = await db
      .insert(notes)
      .values({
        ownerId,
        title: opts.title,
        content: rootDoc(resolved),
        bubbleId: opts.bubbleId ?? null,
        dailyDate: opts.dailyDate ?? null,
        deletedAt: opts.deletedAt ?? null,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
      })
      .returning();

    for (const taskId of links) {
      await db.insert(noteTasks).values({ noteId: note.id, taskId }).onConflictDoNothing();
    }
    return note;
  }

  // -------------------------------------------------------------------------
  // Bubble map: root -> folders/bubbles -> nested children.
  // -------------------------------------------------------------------------
  async function makeBubble(opts: {
    parentId: string | null;
    title: string;
    notes?: string;
    emoji?: string;
    color?: string;
    isFolder?: boolean;
    sortOrder?: number;
  }) {
    const [b] = await db
      .insert(bubbles)
      .values({
        ownerId,
        parentId: opts.parentId,
        title: opts.title,
        notes: opts.notes ?? "",
        emoji: opts.emoji ?? null,
        color: opts.color ?? null,
        isFolder: opts.isFolder ?? false,
        sortOrder: opts.sortOrder ?? 0,
      })
      .returning();
    return b;
  }

  console.log("Building bubble map…");
  const root = await makeBubble({ parentId: null, title: "My Map" });

  const work = await makeBubble({
    parentId: root.id,
    title: "Work",
    emoji: "💼",
    color: "#3b82f6",
    isFolder: true,
    notes: "Everything for the day job. Q3 is the big one.",
    sortOrder: 0,
  });
  const learning = await makeBubble({
    parentId: root.id,
    title: "Learning",
    emoji: "📚",
    color: "#8b5cf6",
    isFolder: true,
    notes: "Skills I'm picking up this year.",
    sortOrder: 1,
  });
  const home = await makeBubble({
    parentId: root.id,
    title: "Home",
    emoji: "🏡",
    color: "#22c55e",
    notes: "House, garden, kitchen.",
    sortOrder: 2,
  });
  const travel = await makeBubble({
    parentId: root.id,
    title: "Travel",
    emoji: "✈️",
    color: "#f59e0b",
    notes: "Trips planned and dreamed.",
    sortOrder: 3,
  });
  await makeBubble({
    parentId: root.id,
    title: "Ideas",
    emoji: "💡",
    color: "#ec4899",
    notes: "Random sparks. Nothing structured yet.",
    sortOrder: 4,
  });

  // Nested children
  const q3 = await makeBubble({ parentId: work.id, title: "Q3 Planning", emoji: "🎯", sortOrder: 0 });
  const designSys = await makeBubble({ parentId: work.id, title: "Design System", emoji: "🎨", sortOrder: 1 });
  await makeBubble({ parentId: work.id, title: "1:1 Notes", emoji: "🗣️", sortOrder: 2 });

  const spanish = await makeBubble({ parentId: learning.id, title: "Spanish", emoji: "🇪🇸", sortOrder: 0 });
  await makeBubble({ parentId: learning.id, title: "Guitar", emoji: "🎸", sortOrder: 1 });

  const recipes = await makeBubble({ parentId: home.id, title: "Recipes", emoji: "🍳", sortOrder: 0 });
  await makeBubble({ parentId: home.id, title: "Garden", emoji: "🌱", sortOrder: 1 });

  const japan = await makeBubble({ parentId: travel.id, title: "Japan 2026", emoji: "🗾", sortOrder: 0 });

  // -------------------------------------------------------------------------
  // Bubble-scoped notes (live inside bubbles on the canvas).
  // -------------------------------------------------------------------------
  console.log("Adding bubble notes…");
  await makeNote({
    title: "Q3 Objectives",
    bubbleId: q3.id,
    createdAt: at("2026-06-20T09:00:00Z"),
    updatedAt: at("2026-07-01T14:00:00Z"),
    blocks: [
      H2("Q3 Objectives"),
      P("Three things that actually matter this quarter:"),
      NUMBERS([
        [{ text: "Ship the new onboarding flow", bold: true }],
        ["Cut p95 latency on the dashboard below 400ms"],
        ["Get the design system to 1.0"],
      ]),
      QUOTE("If everything is a priority, nothing is."),
    ],
  });
  await makeNote({
    title: "Sprint 14 tasks",
    bubbleId: q3.id,
    createdAt: at("2026-06-28T09:00:00Z"),
    updatedAt: at("2026-07-04T11:00:00Z"),
    blocks: [
      H3("Sprint 14"),
      TASK({ title: "Wire up onboarding step 2", priority: "high", due: "2026-07-07" }),
      TASK({ title: "Review latency dashboard PR", priority: "medium", due: "2026-07-06" }),
      TASK({ title: "Write migration for user_prefs", completed: true }),
    ],
  });
  await makeNote({
    title: "Color tokens",
    bubbleId: designSys.id,
    createdAt: at("2026-06-15T09:00:00Z"),
    updatedAt: at("2026-06-30T16:20:00Z"),
    blocks: [
      H2("Color tokens"),
      P("Semantic naming over raw hex. Everything maps to a role."),
      CODE(
        `--color-bg: #ffffff;\n--color-fg: #0a0a0a;\n--color-accent: #3b82f6;\n--color-muted: #737373;`,
        "css",
      ),
      P("Dark mode flips ", { text: "bg", code: true }, " and ", { text: "fg", code: true }, ", accent stays."),
    ],
  });
  await makeNote({
    title: "Verbs — present tense",
    bubbleId: spanish.id,
    createdAt: at("2026-06-10T09:00:00Z"),
    updatedAt: at("2026-06-25T19:00:00Z"),
    blocks: [
      H2("Present tense — regular -ar"),
      BULLETS([
        [{ text: "hablar", bold: true }, " → hablo, hablas, habla, hablamos, habláis, hablan"],
        [{ text: "trabajar", bold: true }, " → trabajo, trabajas, trabaja…"],
        [{ text: "estudiar", bold: true }, " → estudio, estudias, estudia…"],
      ]),
      P({ text: "Note: ", italic: true }, "the ", { text: "nosotros", italic: true }, " form always ends in -amos."),
      TASK({ title: "Do Duolingo lesson 12", priority: "low", due: "2026-07-06" }),
    ],
  });
  await makeNote({
    title: "Weeknight pasta",
    bubbleId: recipes.id,
    createdAt: at("2026-06-22T09:00:00Z"),
    updatedAt: at("2026-06-29T20:15:00Z"),
    blocks: [
      H2("Garlic butter pasta 🍝"),
      P("20 minutes, one pan, always a hit."),
      H3("Ingredients"),
      BULLETS([
        ["200g spaghetti"],
        ["4 cloves garlic, thin sliced"],
        ["3 tbsp butter"],
        ["Parmesan, lemon, parsley"],
      ]),
      H3("Method"),
      NUMBERS([
        ["Boil pasta, save a cup of the water"],
        ["Gently brown garlic in butter"],
        ["Toss with pasta + splash of pasta water"],
        ["Finish with lemon, parm, parsley"],
      ]),
    ],
  });
  await makeNote({
    title: "Itinerary draft",
    bubbleId: japan.id,
    createdAt: at("2026-06-18T09:00:00Z"),
    updatedAt: at("2026-07-02T22:00:00Z"),
    blocks: [
      H1("Japan — Oct 2026"),
      P("Two weeks. Tokyo → Hakone → Kyoto → Osaka."),
      CHECKS([
        { text: "Book flights", checked: true },
        { text: "JR Pass (order 1 month ahead)", checked: false },
        { text: "Reserve ryokan in Hakone", checked: false },
        { text: "TeamLab tickets", checked: false },
      ]),
      TASK({ title: "Renew passport", priority: "high", due: "2026-07-10" }),
    ],
  });

  // -------------------------------------------------------------------------
  // Standalone notes (main notes list). Newest updatedAt shows first.
  // -------------------------------------------------------------------------
  console.log("Adding standalone notes…");
  const welcome = await makeNote({
    title: "👋 Start here",
    createdAt: at("2026-07-05T08:00:00Z"),
    updatedAt: at("2026-07-05T08:30:00Z"),
    blocks: [
      H1("Welcome to your agenda"),
      P("This is a real note. Try a few things:"),
      BULLETS([
        [{ text: "Press ", }, { text: "/", code: true }, " on a new line for the command menu"],
        ["Type ", { text: "[[", code: true }, " to link another note"],
        [{ text: "Cmd/Ctrl + K", bold: true }, " opens the palette"],
      ]),
      P("Tasks are first-class — check one off right here:"),
      TASK({ title: "Check this box to see it work", priority: "low" }),
      QUOTE("Everything is editable. Poke around."),
    ],
  });

  const readingList = await makeNote({
    title: "Reading list",
    createdAt: at("2026-06-12T09:00:00Z"),
    updatedAt: at("2026-07-04T21:00:00Z"),
    blocks: [
      H2("To read"),
      CHECKS([
        { text: "The Pragmatic Programmer", checked: true },
        { text: "Thinking in Systems", checked: false },
        { text: "A Philosophy of Software Design", checked: false },
        { text: "Designing Data-Intensive Applications", checked: false },
      ]),
      P("Currently on: ", { text: "Thinking in Systems", italic: true }, " (ch. 4)."),
    ],
  });

  await makeNote({
    title: "Meeting notes — kickoff",
    createdAt: at("2026-07-03T15:00:00Z"),
    updatedAt: at("2026-07-03T15:45:00Z"),
    blocks: [
      H2("Project kickoff — Jul 3"),
      P({ text: "Attendees: ", bold: true }, "me, Priya, Sam, Dana"),
      H3("Decisions"),
      BULLETS([
        ["Launch target is end of Q3"],
        ["Priya owns the API, Sam owns the client"],
        ["Weekly sync Thursdays at 10"],
      ]),
      H3("Action items"),
      TASK({ title: "Send Priya the schema draft", priority: "high", due: "2026-07-04" }),
      TASK({ title: "Book the recurring Thursday sync", priority: "medium", due: "2026-07-06" }),
      TASK({ title: "Share kickoff notes with the team", completed: true }),
    ],
  });

  await makeNote({
    title: "Workout split",
    createdAt: at("2026-06-08T09:00:00Z"),
    updatedAt: at("2026-07-02T07:00:00Z"),
    blocks: [
      H2("Push / Pull / Legs"),
      H3("Push"),
      BULLETS([["Bench 4×6"], ["Overhead press 3×8"], ["Dips 3×10"]]),
      H3("Pull"),
      BULLETS([["Deadlift 3×5"], ["Rows 4×8"], ["Pull-ups 3×max"]]),
      H3("Legs"),
      BULLETS([["Squat 4×6"], ["RDL 3×8"], ["Calf raises 4×15"]]),
    ],
  });

  await makeNote({
    title: "Budget rethink",
    createdAt: at("2026-06-30T09:00:00Z"),
    updatedAt: at("2026-07-01T12:30:00Z"),
    blocks: [
      H2("Monthly budget"),
      P("The 50/30/20 rule, roughly:"),
      NUMBERS([
        [{ text: "50% needs", bold: true }, " — rent, groceries, utilities"],
        [{ text: "30% wants", bold: true }, " — eating out, subscriptions"],
        [{ text: "20% savings", bold: true }, " — index funds + emergency"],
      ]),
      TASK({ title: "Cancel the unused streaming subscription", priority: "low", due: "2026-07-08" }),
      TASK({ title: "Set up automatic transfer to savings", priority: "medium", due: "2026-07-12" }),
    ],
  });

  await makeNote({
    title: "Snippet — debounce",
    createdAt: at("2026-06-05T09:00:00Z"),
    updatedAt: at("2026-06-27T13:00:00Z"),
    blocks: [
      H3("A tiny debounce"),
      CODE(
        `function debounce(fn, ms) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n}`,
        "javascript",
      ),
      P("Reach for this before adding a whole library."),
    ],
  });

  await makeNote({
    title: "Gift ideas 🎁",
    createdAt: at("2026-06-25T09:00:00Z"),
    updatedAt: at("2026-06-26T10:00:00Z"),
    blocks: [
      H2("Gift ideas"),
      BULLETS([
        ["Mom — that ceramics class she mentioned"],
        ["Dana — good coffee beans + a nice grinder"],
        ["Sam — the mechanical keyboard he keeps eyeing"],
      ]),
    ],
  });

  // -------------------------------------------------------------------------
  // Standalone tasks (task dock on the daily map). No note link.
  // Spread across overdue / today / upcoming / completed.
  // -------------------------------------------------------------------------
  console.log("Adding standalone tasks…");
  const standalone: {
    title: string;
    due?: string;
    priority?: "none" | "low" | "medium" | "high";
    completedAt?: string;
  }[] = [
    { title: "Call the dentist to reschedule", due: "2026-07-03", priority: "high" }, // overdue
    { title: "Pay the electric bill", due: "2026-07-04", priority: "medium" }, // overdue
    { title: "Water the plants", due: "2026-07-05", priority: "low" }, // today
    { title: "Reply to Dana's email", due: "2026-07-05", priority: "medium" }, // today
    { title: "Stand-up notes", due: "2026-07-05", priority: "none" }, // today
    { title: "Grocery run", due: "2026-07-06", priority: "low" }, // upcoming
    { title: "Draft the quarterly review", due: "2026-07-09", priority: "high" }, // upcoming
    { title: "Dentist appointment", due: "2026-07-11", priority: "medium" }, // upcoming
    { title: "Morning run", priority: "low", completedAt: "2026-07-05T13:00:00Z" }, // done today
    { title: "Inbox to zero", priority: "none", completedAt: "2026-07-05T14:30:00Z" }, // done today
    { title: "Book flights for Japan", priority: "high", completedAt: "2026-07-04T18:00:00Z" }, // done yesterday
  ];
  for (const t of standalone) {
    await db.insert(tasks).values({
      ownerId,
      title: t.title,
      priority: t.priority ?? "none",
      dueAt: t.due ? day(t.due) : null,
      completedAt: t.completedAt ? at(t.completedAt) : null,
    });
  }

  // -------------------------------------------------------------------------
  // Daily jot notes (notes with dailyDate) — the Today page's past dailies.
  // -------------------------------------------------------------------------
  console.log("Adding daily notes…");
  for (const d of ["2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"]) {
    await makeNote({
      title: `Daily — ${d}`,
      dailyDate: day(d),
      createdAt: at(`${d}T08:00:00Z`),
      updatedAt: at(`${d}T20:00:00Z`),
      blocks: [
        H3("Focus"),
        P(d === TODAY ? "Ship the onboarding step and go for a run." : "Cleared the backlog, felt good."),
        H3("Notes"),
        BULLETS([["Slept well"], ["One deep-work block before lunch"]]),
      ],
    });
  }

  // -------------------------------------------------------------------------
  // Trash (soft-deleted notes).
  // -------------------------------------------------------------------------
  console.log("Adding trashed notes…");
  await makeNote({
    title: "Old draft (scratch)",
    createdAt: at("2026-06-01T09:00:00Z"),
    updatedAt: at("2026-06-02T09:00:00Z"),
    deletedAt: at("2026-06-20T09:00:00Z"),
    blocks: [H2("Half-formed idea"), P("Never went anywhere. Trashed.")],
  });
  await makeNote({
    title: "Duplicate meeting note",
    createdAt: at("2026-06-15T09:00:00Z"),
    updatedAt: at("2026-06-15T09:00:00Z"),
    deletedAt: at("2026-07-01T09:00:00Z"),
    blocks: [P("Accidentally made this twice.")],
  });

  // -------------------------------------------------------------------------
  // Tags (schema-only for now, but seed a few flat labels + links).
  // -------------------------------------------------------------------------
  console.log("Adding tags…");
  const tagRows = [
    { name: "urgent", color: "#ef4444", isPinned: true },
    { name: "someday", color: "#a3a3a3", isPinned: false },
    { name: "reference", color: "#3b82f6", isPinned: false },
  ];
  for (let i = 0; i < tagRows.length; i++) {
    await db.insert(tags).values({ ownerId, sortOrder: i, ...tagRows[i] });
  }

  // -------------------------------------------------------------------------
  // Backlink: "Start here" -> "Reading list", so the backlinks panel has data.
  // -------------------------------------------------------------------------
  if (welcome && readingList) {
    await db
      .insert(noteLinks)
      .values({ sourceNoteId: welcome.id, targetNoteId: readingList.id })
      .onConflictDoNothing();
  }

  console.log("\n✅ Seed complete. Sign in as gehrigspam@gmail.com to see it.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

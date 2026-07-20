import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema for the notes / agenda app.
 *
 * Design notes:
 * - `ownerId` everywhere is the Clerk user id (a string like "user_xxx"). We do
 *   not store a local users table; Clerk is the source of truth for identity.
 * - `tasks` are FIRST-CLASS entities, never embedded in note content. A task
 *   links to notes via `note_tasks`, so the SAME task can appear in multiple
 *   notes and share one completion state. (Full multi-note sync is a later
 *   phase, but the data model supports it now.)
 * - `tags` are a self-referential hierarchy that doubles as the folder tree.
 * - Soft-delete via `deletedAt` powers Trash.
 */

export const priorityEnum = pgEnum("priority", [
  "none",
  "low",
  "medium",
  "high",
]);

export const attachmentKindEnum = pgEnum("attachment_kind", [
  "image",
  "file",
]);

export const recurrenceFreqEnum = pgEnum("recurrence_freq", [
  "daily",
  "weekly",
  "interval",
  "monthly",
]);

export const threadStatusEnum = pgEnum("thread_status", [
  "active",
  "promoted",
  "dismissed",
]);

// Direction of a person commitment (design 15a): something you owe them vs.
// something they owe you.
export const commitmentDirectionEnum = pgEnum("commitment_direction", [
  "you_owe",
  "they_owe",
]);

// Gardener suggestion kinds (design 15c).
export const gardenerKindEnum = pgEnum("gardener_kind", [
  "merge_duplicate",
  "archive_board",
  "link_notes",
]);

export const gardenerStatusEnum = pgEnum("gardener_status", [
  "open",
  "accepted",
  "dismissed",
]);

// Capture-inbox item source + lifecycle (design 16c).
export const captureSourceEnum = pgEnum("capture_source", [
  "email",
  "link",
  "photo",
  "text",
]);

export const captureStatusEnum = pgEnum("capture_status", [
  "new",
  "filed",
  "dismissed",
]);

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull().default("Untitled"),
    // Serialized Lexical editor state (editor.getEditorState().toJSON()).
    content: jsonb("content"),
    // Plain-text mirror of `content`, refreshed on every save (and lazily
    // backfilled for notes that predate the column). Exists so content search
    // (ask-your-notes retrieval, ambient recall, thread detection) can run as
    // a cheap ILIKE/substring query instead of walking Lexical JSON per note.
    textContent: text("text_content"),
    // When set, this note belongs to a bubble in the bubble map (and is hidden
    // from the main notes list). Null = a regular standalone note. FK cascades
    // so deleting a bubble (or its ancestors) removes the bubble's notes too.
    bubbleId: uuid("bubble_id").references((): AnyPgColumn => bubbles.id, {
      onDelete: "cascade",
    }),
    // When set, this note is the daily jot for the given calendar date.
    // A unique (owner, dailyDate) index enforces one daily note per day.
    dailyDate: timestamp("daily_date", { mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("notes_owner_idx").on(t.ownerId),
    index("notes_owner_updated_idx").on(t.ownerId, t.updatedAt),
    index("notes_deleted_idx").on(t.deletedAt),
    index("notes_bubble_idx").on(t.bubbleId),
    // Partial so a trashed daily note doesn't block creating a fresh one for
    // the same date.
    uniqueIndex("notes_owner_daily_date_idx")
      .on(t.ownerId, t.dailyDate)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// tags (self-referential hierarchy === folder tree)
// ---------------------------------------------------------------------------
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    isPinned: boolean("is_pinned").notNull().default(false),
    color: text("color"),
    // Manual ordering within a parent.
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tags_owner_idx").on(t.ownerId),
    index("tags_parent_idx").on(t.parentId),
  ],
);

// ---------------------------------------------------------------------------
// note_tags (many-to-many)
// ---------------------------------------------------------------------------
export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.tagId] }),
    index("note_tags_tag_idx").on(t.tagId),
  ],
);

// ---------------------------------------------------------------------------
// recurring_tasks — recurrence RULES. Occurrences are ordinary `tasks` rows
// materialized lazily (see src/server/recurring.ts) with `recurringTaskId`
// pointing back here, so they flow through every existing task surface.
// All calendar fields are the user's LOCAL day/time as strings (YYYY-MM-DD /
// HH:MM) — the client supplies them; the server never guesses a timezone.
// ---------------------------------------------------------------------------
export const recurringTasks = pgTable(
  "recurring_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    freq: recurrenceFreqEnum("freq").notNull(),
    // 0=Sunday … 6=Saturday; set when freq = "weekly".
    weekday: integer("weekday"),
    // Every N days; set when freq = "interval".
    intervalDays: integer("interval_days"),
    // 1–31, clamped to the month's length; set when freq = "monthly".
    monthDay: integer("month_day"),
    // Reminder wall-clock time "HH:MM" (display chip only for now).
    remindAt: text("remind_at"),
    paused: boolean("paused").notNull().default(false),
    // Opt-in (design 16b): when true this rule is a HABIT — it surfaces in the
    // daily note's habit strip with a streak of dots instead of (or alongside)
    // the plain recurring-task chip. Streaks are computed from the materialized
    // occurrences' completedAt, so no separate log table is needed.
    isHabit: boolean("is_habit").notNull().default(false),
    // Which Tasks-page section this rule was created in / belongs to. false =
    // a plain "Recurring task" built with the structured schedule picker (the
    // default); true = a "Rule" typed as a natural-language phrase. Purely a
    // presentation discriminator — the schedule itself is identical either way.
    isRule: boolean("is_rule").notNull().default(false),
    // Local date the schedule counts from (first occurrence >= this day).
    anchorDate: text("anchor_date").notNull(),
    // Last local date an occurrence was materialized for; the materializer's
    // atomic claim on this column is what makes concurrent reads insert-once.
    lastDate: text("last_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("recurring_tasks_owner_idx").on(t.ownerId)],
);

// ---------------------------------------------------------------------------
// tasks (first-class entities)
// ---------------------------------------------------------------------------
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    address: text("address"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    // Multiple reminders per task. (Legacy — unused; remindAtLocal below is
    // what the UI reads.)
    remindAts: timestamp("remind_ats", { withTimezone: true }).array(),
    // Reminder wall-clock time "HH:MM" in the user's local timezone (display
    // chip only for now; copied from the rule for recurring occurrences).
    remindAtLocal: text("remind_at_local"),
    // Set when this task is a materialized occurrence of a recurrence rule.
    // Rule deletion keeps the occurrence (it's a real task the user may have
    // half-done), so SET NULL rather than CASCADE.
    recurringTaskId: uuid("recurring_task_id").references(
      () => recurringTasks.id,
      { onDelete: "set null" },
    ),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    priority: priorityEnum("priority").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tasks_owner_idx").on(t.ownerId),
    index("tasks_owner_due_idx").on(t.ownerId, t.dueAt),
    index("tasks_completed_idx").on(t.completedAt),
  ],
);

// ---------------------------------------------------------------------------
// note_tasks (join: which notes a task appears in)
// ---------------------------------------------------------------------------
export const noteTasks = pgTable(
  "note_tasks",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.taskId] }),
    index("note_tasks_task_idx").on(t.taskId),
  ],
);

// ---------------------------------------------------------------------------
// note_links (backlinks between notes)
// ---------------------------------------------------------------------------
export const noteLinks = pgTable(
  "note_links",
  {
    sourceNoteId: uuid("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetNoteId: uuid("target_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceNoteId, t.targetNoteId] }),
    index("note_links_target_idx").on(t.targetNoteId),
  ],
);

// ---------------------------------------------------------------------------
// attachments (file/image metadata; storage handled by the storage adapter)
// ---------------------------------------------------------------------------
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    noteId: uuid("note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    kind: attachmentKindEnum("kind").notNull().default("file"),
    // Opaque storage key resolved by the active storage adapter.
    storageKey: text("storage_key").notNull(),
    url: text("url").notNull(),
    mimeType: text("mime_type"),
    fileName: text("file_name"),
    sizeBytes: integer("size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("attachments_owner_idx").on(t.ownerId),
    index("attachments_note_idx").on(t.noteId),
  ],
);

// ---------------------------------------------------------------------------
// upload_blobs — raw upload bytes (base64) for the "db" storage driver. The
// local-disk driver is ephemeral on serverless hosts, so image bytes live in
// Postgres until an S3 adapter lands; personal-scale data, capped per file at
// the /api/uploads route. Served by GET /api/uploads/[id].
// ---------------------------------------------------------------------------
export const uploadBlobs = pgTable(
  "upload_blobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    mimeType: text("mime_type").notNull(),
    dataBase64: text("data_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("upload_blobs_owner_idx").on(t.ownerId)],
);

// ---------------------------------------------------------------------------
// bubbles — nested "knowledge map" tree (separate from notes/tags). Each bubble
// has a title, free-text notes, and any number of child bubbles; nesting is
// unlimited. Deleting a bubble cascades to its whole subtree via the
// self-referential FK.
// ---------------------------------------------------------------------------
export const bubbles = pgTable(
  "bubbles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => bubbles.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull().default("Untitled"),
    notes: text("notes").notNull().default(""),
    emoji: text("emoji"),
    color: text("color"),
    // Opt-in: when true, this bubble surfaces as a folder in the Notes sidebar
    // (its notes become browsable there). Bubbles stay independent otherwise.
    isFolder: boolean("is_folder").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("bubbles_owner_idx").on(t.ownerId),
    index("bubbles_parent_idx").on(t.parentId),
    // One root (parent_id IS NULL) per owner — backstops the check-then-insert
    // race in getOrCreateRoot, which would otherwise create duplicate roots
    // and silently hide boards created under the losing one.
    uniqueIndex("bubbles_owner_root_uq")
      .on(t.ownerId)
      .where(sql`parent_id is null`),
  ],
);

// ---------------------------------------------------------------------------
// user_settings — one row per owner for the handful of per-user knobs the AI
// features need (calendar feed, feature toggles, scan cursors). Deliberately
// a single wide row rather than a key/value table: the set is small and typed
// access beats stringly-typed lookups.
// ---------------------------------------------------------------------------
export const userSettings = pgTable("user_settings", {
  ownerId: text("owner_id").primaryKey(),
  // Read-only ICS subscription URL (Google/Apple "secret address") that powers
  // meeting mode. Null = meeting mode off.
  calendarIcsUrl: text("calendar_ics_url"),
  // Ambient recall margin cards in the daily editor.
  recallEnabled: boolean("recall_enabled").notNull().default(true),
  // Last time thread detection scanned this owner's notes; the scanner skips
  // itself when nothing changed since.
  threadsScannedAt: timestamp("threads_scanned_at", { withTimezone: true }),
  // Scan cursors for the People (15a) and Gardener (15c) sweeps — same "skip
  // when nothing changed since" pattern as threadsScannedAt.
  peopleScannedAt: timestamp("people_scanned_at", { withTimezone: true }),
  gardenerScannedAt: timestamp("gardener_scanned_at", { withTimezone: true }),
  // Private forwarding address (design 16c): the local part of the per-user
  // capture address (e.g. "jots-a1b2c3" in jots-a1b2c3@yourapp.co). Generated
  // on first visit to the inbox; null until then.
  captureAddress: text("capture_address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// threads — auto-assembled topic threads across notes (design 14b). Detection
// writes these; the user never tags anything. Mentions are snippets pinned to
// the note (and day) they came from. Rescans are idempotent via the unique
// (thread, note, snippet) index.
// ---------------------------------------------------------------------------
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    topic: text("topic").notNull(),
    status: threadStatusEnum("status").notNull().default("active"),
    // Set when the user promotes the thread to a real note.
    promotedNoteId: uuid("promoted_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("threads_owner_idx").on(t.ownerId),
    // One live thread per topic per owner; detection upserts against this.
    uniqueIndex("threads_owner_topic_uq").on(t.ownerId, t.topic),
  ],
);

export const threadMentions = pgTable(
  "thread_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    // Short verbatim excerpt from the note where the topic appears.
    snippet: text("snippet").notNull(),
    // The day this mention belongs to: the note's dailyDate when it has one,
    // otherwise the note's updatedAt at scan time.
    mentionDate: timestamp("mention_date", { withTimezone: true }).notNull(),
    // Low-signal mentions collapse in the timeline UI ("3 quieter mentions").
    quiet: boolean("quiet").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("thread_mentions_thread_idx").on(t.threadId),
    index("thread_mentions_note_idx").on(t.noteId),
    uniqueIndex("thread_mentions_dedupe_uq").on(t.threadId, t.noteId, t.snippet),
  ],
);

// ---------------------------------------------------------------------------
// automations — plain-language rules run on what the user writes (design 14e).
// Every action an automation takes is recorded as a run with enough undo data
// to revert it — no black box.
// ---------------------------------------------------------------------------
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    // The rule exactly as the user wrote it ("when I write a line starting
    // with read:, add it to Reading list"). The model interprets it at run
    // time; there is no compiled form to drift out of sync.
    rule: text("rule").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("automations_owner_idx").on(t.ownerId)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    // The note whose save triggered the run (informational).
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    // Human-readable one-liner: 'added "The Design of Everyday Things"'.
    summary: text("summary").notNull(),
    // Everything needed to revert the action, discriminated on `kind`:
    //   { kind: "create_task", taskId }
    //   { kind: "append_note", noteId, appendedText }
    //   { kind: "flag_task", taskId }
    undoData: jsonb("undo_data"),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("automation_runs_automation_idx").on(t.automationId),
    index("automation_runs_owner_created_idx").on(t.ownerId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// voice_memos — metadata for captured voice memos (design 14a). Audio bytes go
// through the storage adapter like image uploads; the transcript is inserted
// into the daily note as ordinary content, and this row keeps the raw audio
// attached to it.
// ---------------------------------------------------------------------------
export const voiceMemos = pgTable(
  "voice_memos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    // The (daily) note the transcript landed in.
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    storageKey: text("storage_key"),
    durationSec: integer("duration_sec"),
    transcript: text("transcript").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("voice_memos_owner_idx").on(t.ownerId)],
);

// ---------------------------------------------------------------------------
// meeting_declines — "decline it and it never asks again for that event"
// (design 14c). Keyed by the calendar event's UID (plus start for recurring
// events, folded into the uid string by the caller).
// ---------------------------------------------------------------------------
export const meetingDeclines = pgTable(
  "meeting_declines",
  {
    ownerId: text("owner_id").notNull(),
    eventUid: text("event_uid").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.eventUid] })],
);

// ---------------------------------------------------------------------------
// week_reviews — cached drafted retrospectives (design 14d), one per owner per
// week. Content is the structured draft; regenerating overwrites it until the
// user inserts it into Sunday's note.
// ---------------------------------------------------------------------------
export const weekReviews = pgTable(
  "week_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    // Local YYYY-MM-DD of the week's Monday (client-supplied, like all local
    // dates in this schema).
    weekStart: text("week_start").notNull(),
    // { done, doneRefs: [{noteId, date, label}], stillOpen, openRefs: [...],
    //   threads: [{topic, mentions}] }
    content: jsonb("content").notNull(),
    // Set once the draft has been inserted into the Sunday daily note.
    insertedNoteId: uuid("inserted_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("week_reviews_owner_week_uq").on(t.ownerId, t.weekStart)],
);

// ---------------------------------------------------------------------------
// people — auto-maintained page per person the user mentions (design 15a). The
// People scan writes these; the user never creates or files them. `mentions`
// are snippets pinned to the note they came from; `commitments` track what you
// owe them / they owe you. Rescans are idempotent via the unique indexes.
// ---------------------------------------------------------------------------
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    // Canonical display name as first seen ("Sam"). Matching is done on the
    // lowercased form via the unique index below.
    name: text("name").notNull(),
    // Lowercased name — the identity key the scanner upserts against, so "Sam"
    // and "sam" collapse to one page.
    nameKey: text("name_key").notNull(),
    // Denormalized so the list/hover peek don't aggregate mentions every read.
    lastMentionedAt: timestamp("last_mentioned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("people_owner_idx").on(t.ownerId),
    uniqueIndex("people_owner_namekey_uq").on(t.ownerId, t.nameKey),
  ],
);

export const personMentions = pgTable(
  "person_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    snippet: text("snippet").notNull(),
    mentionDate: timestamp("mention_date", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("person_mentions_person_idx").on(t.personId),
    index("person_mentions_note_idx").on(t.noteId),
    uniqueIndex("person_mentions_dedupe_uq").on(
      t.personId,
      t.noteId,
      t.snippet,
    ),
  ],
);

export const personCommitments = pgTable(
  "person_commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    direction: commitmentDirectionEnum("direction").notNull(),
    text: text("text").notNull(),
    // Optional link to a real task (when the commitment maps to one) and the
    // note it was extracted from ("from Tue's 1:1").
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    sourceNoteId: uuid("source_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    // Free-text provenance label shown on the row ("from Tue's 1:1").
    contextLabel: text("context_label"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("person_commitments_person_idx").on(t.personId),
    uniqueIndex("person_commitments_dedupe_uq").on(
      t.personId,
      t.direction,
      t.text,
    ),
  ],
);

// ---------------------------------------------------------------------------
// gardener_suggestions — one small tidy-up proposal at a time (design 15c). The
// weekly sweep writes `open` rows; accepting one performs the action (merge /
// archive / link) and marks it `accepted`. `payload` carries the ids the action
// needs, discriminated on `kind`.
// ---------------------------------------------------------------------------
export const gardenerSuggestions = pgTable(
  "gardener_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    kind: gardenerKindEnum("kind").notNull(),
    status: gardenerStatusEnum("status").notNull().default("open"),
    // Headline shown on the card ("… look like the same note").
    title: text("title").notNull(),
    // Optional evidence line under the headline.
    detail: text("detail"),
    // { kind:"merge_duplicate", noteIds:[a,b] }
    // { kind:"archive_board", bubbleId }
    // { kind:"link_notes", sourceNoteId, targetNoteId }
    payload: jsonb("payload").notNull(),
    // Stable identity of the suggestion so a rescan doesn't re-propose a
    // tidy-up the user already acted on (hash of kind + sorted subject ids).
    dedupeKey: text("dedupe_key").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("gardener_owner_status_idx").on(t.ownerId, t.status),
    uniqueIndex("gardener_owner_dedupe_uq").on(t.ownerId, t.dedupeKey),
  ],
);

// ---------------------------------------------------------------------------
// task_blocks — timeboxed suggestions for a task on a given local day (design
// 15d). A block is just a note-to-self: the task stays a task, so deleting a
// block never touches the task, and an incomplete block "rolls forward" by
// being re-created on the next day. One block per (task, day); events from the
// calendar are NOT stored here (they're read live from the ICS feed).
// ---------------------------------------------------------------------------
export const taskBlocks = pgTable(
  "task_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    // Local day the block lives on (YYYY-MM-DD, client-supplied).
    localDate: text("local_date").notNull(),
    // Minutes from midnight (local) for the block's start/end.
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("task_blocks_owner_date_idx").on(t.ownerId, t.localDate),
    uniqueIndex("task_blocks_task_date_uq").on(t.taskId, t.localDate),
  ],
);

// ---------------------------------------------------------------------------
// calendar_events — user-created events (calendar quick-add). Distinct from
// the read-only ICS feed (server/calendar.ts): these are the events the user
// types into the app ("coffee w/ Sam fri 3pm"), and the only calendar data we
// ever write. Times follow the task_blocks convention — a client-supplied
// local day plus minutes from local midnight; both minutes null = all-day.
// ---------------------------------------------------------------------------
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    // Local day the event is on (YYYY-MM-DD, client-supplied).
    localDate: text("local_date").notNull(),
    // Minutes from midnight (local); null start = all-day event.
    startMin: integer("start_min"),
    endMin: integer("end_min"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("calendar_events_owner_date_idx").on(t.ownerId, t.localDate)],
);

// ---------------------------------------------------------------------------
// capture_inbox — items forwarded to the user's private address (design 16c):
// an email, a shared link, a texted photo. Each lands here with a suggested
// destination already worked out; accepting files it, and everything is opt-in
// (an item with no suggestion just waits). Real inbound wiring is out of scope
// for the MVP — items are seeded via a server action — but the model and UI are
// the real thing.
// ---------------------------------------------------------------------------
export const captureInbox = pgTable(
  "capture_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    source: captureSourceEnum("source").notNull(),
    status: captureStatusEnum("status").notNull().default("new"),
    title: text("title").notNull(),
    // Short preview line ("…approved with one change…").
    excerpt: text("excerpt"),
    // For link items.
    url: text("url"),
    // For photo items — the stored image (storage adapter), if any.
    attachmentId: uuid("attachment_id").references(() => attachments.id, {
      onDelete: "set null",
    }),
    // Suggested destination: a board (bubble) to file into, plus the label the
    // card shows ("File to Launch checklist"). Null suggestion = "stays here
    // until you decide".
    suggestedBubbleId: uuid("suggested_bubble_id").references(() => bubbles.id, {
      onDelete: "set null",
    }),
    suggestionLabel: text("suggestion_label"),
    // Why it was suggested ("mentioned in 3 notes").
    suggestionReason: text("suggestion_reason"),
    // The note created when the item is filed.
    filedNoteId: uuid("filed_note_id").references(() => notes.id, {
      onDelete: "set null",
    }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("capture_inbox_owner_status_idx").on(t.ownerId, t.status)],
);

// ---------------------------------------------------------------------------
// Relations (for drizzle's relational query API)
// ---------------------------------------------------------------------------
export const notesRelations = relations(notes, ({ many }) => ({
  noteTags: many(noteTags),
  noteTasks: many(noteTasks),
  attachments: many(attachments),
  outgoingLinks: many(noteLinks, { relationName: "source" }),
  incomingLinks: many(noteLinks, { relationName: "target" }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  parent: one(tags, {
    fields: [tags.parentId],
    references: [tags.id],
    relationName: "tag_parent",
  }),
  children: many(tags, { relationName: "tag_parent" }),
  noteTags: many(noteTags),
}));

export const noteTagsRelations = relations(noteTags, ({ one }) => ({
  note: one(notes, { fields: [noteTags.noteId], references: [notes.id] }),
  tag: one(tags, { fields: [noteTags.tagId], references: [tags.id] }),
}));

export const tasksRelations = relations(tasks, ({ many }) => ({
  noteTasks: many(noteTasks),
}));

export const noteTasksRelations = relations(noteTasks, ({ one }) => ({
  note: one(notes, { fields: [noteTasks.noteId], references: [notes.id] }),
  task: one(tasks, { fields: [noteTasks.taskId], references: [tasks.id] }),
}));

export const noteLinksRelations = relations(noteLinks, ({ one }) => ({
  source: one(notes, {
    fields: [noteLinks.sourceNoteId],
    references: [notes.id],
    relationName: "source",
  }),
  target: one(notes, {
    fields: [noteLinks.targetNoteId],
    references: [notes.id],
    relationName: "target",
  }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  note: one(notes, { fields: [attachments.noteId], references: [notes.id] }),
}));

export const bubblesRelations = relations(bubbles, ({ one, many }) => ({
  parent: one(bubbles, {
    fields: [bubbles.parentId],
    references: [bubbles.id],
    relationName: "bubble_parent",
  }),
  children: many(bubbles, { relationName: "bubble_parent" }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type RecurringTask = typeof recurringTasks.$inferSelect;
export type NewRecurringTask = typeof recurringTasks.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type Bubble = typeof bubbles.$inferSelect;
export type NewBubble = typeof bubbles.$inferInsert;
export type UserSettings = typeof userSettings.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type ThreadMention = typeof threadMentions.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type VoiceMemo = typeof voiceMemos.$inferSelect;
export type WeekReview = typeof weekReviews.$inferSelect;
export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type PersonMention = typeof personMentions.$inferSelect;
export type PersonCommitment = typeof personCommitments.$inferSelect;
export type GardenerSuggestion = typeof gardenerSuggestions.$inferSelect;
export type TaskBlock = typeof taskBlocks.$inferSelect;
export type NewTaskBlock = typeof taskBlocks.$inferInsert;
export type CaptureInboxItem = typeof captureInbox.$inferSelect;

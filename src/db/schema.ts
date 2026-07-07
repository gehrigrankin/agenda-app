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

-- One-time cleanup for the habit materializer bug: every task-list call on a
-- habit's scheduled day re-claimed the day and inserted another occurrence.
-- Keep one row per (owner, habit, day) — a completed one if any, else the
-- oldest — and leave anything a note links to alone.
DELETE FROM "tasks"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      t."id",
      row_number() OVER (
        PARTITION BY t."owner_id", t."recurring_task_id", t."due_at"
        ORDER BY (t."completed_at" IS NULL), t."created_at", t."id"
      ) AS rn
    FROM "tasks" t
    JOIN "recurring_tasks" r ON r."id" = t."recurring_task_id"
    WHERE r."is_habit" = true
  ) ranked
  WHERE ranked.rn > 1
)
AND NOT EXISTS (
  SELECT 1 FROM "note_tasks" nt WHERE nt."task_id" = "tasks"."id"
);

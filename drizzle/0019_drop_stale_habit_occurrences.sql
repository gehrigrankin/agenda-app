-- Custom SQL migration file, put your code below! --

-- Habits are not tasks (CONTEXT.md, product coherence): a habit occurrence
-- never goes overdue and never carries — a missed day breaks the streak and
-- passes. Uncompleted occurrences of habit rules for past days used to be the
-- "carried Nd" rows on task surfaces; the streak reads completed rows only, so
-- open past rows serve nothing. Delete them. (due_at is stored as midnight UTC
-- of the local day; CURRENT_DATE on Neon is UTC, so this keeps today's rows.)
DELETE FROM "tasks"
USING "recurring_tasks"
WHERE "tasks"."recurring_task_id" = "recurring_tasks"."id"
  AND "recurring_tasks"."is_habit" = true
  AND "tasks"."completed_at" IS NULL
  AND "tasks"."due_at" < CURRENT_DATE;

-- Duplicate roots can already exist (check-then-insert race in
-- getOrCreateRoot). Fold each owner's extra roots into their oldest root
-- before enforcing uniqueness: reparent child bubbles and re-home direct
-- notes first — deleting a root cascades to its whole subtree.
UPDATE "bubbles" b
SET "parent_id" = k."keeper"
FROM (
	SELECT "id", first_value("id") OVER (PARTITION BY "owner_id" ORDER BY "created_at", "id") AS "keeper"
	FROM "bubbles"
	WHERE "parent_id" IS NULL
) k
WHERE b."parent_id" = k."id" AND k."id" <> k."keeper";--> statement-breakpoint
UPDATE "notes" n
SET "bubble_id" = k."keeper"
FROM (
	SELECT "id", first_value("id") OVER (PARTITION BY "owner_id" ORDER BY "created_at", "id") AS "keeper"
	FROM "bubbles"
	WHERE "parent_id" IS NULL
) k
WHERE n."bubble_id" = k."id" AND k."id" <> k."keeper";--> statement-breakpoint
DELETE FROM "bubbles" b
USING (
	SELECT "id", first_value("id") OVER (PARTITION BY "owner_id" ORDER BY "created_at", "id") AS "keeper"
	FROM "bubbles"
	WHERE "parent_id" IS NULL
) k
WHERE b."id" = k."id" AND k."id" <> k."keeper";--> statement-breakpoint
CREATE UNIQUE INDEX "bubbles_owner_root_uq" ON "bubbles" USING btree ("owner_id") WHERE parent_id is null;

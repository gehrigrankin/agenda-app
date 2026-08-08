CREATE TABLE "task_tags" (
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_tags_tag_idx" ON "task_tags" USING btree ("tag_id");--> statement-breakpoint
-- Hand-added: no app code has ever written `tags` (only the dev seed scripts),
-- but a pre-existing duplicate name would fail the unique index below and take
-- the deploy migration down with it. Disambiguate rather than delete.
UPDATE "tags" t SET "name" = t."name" || ' (' || d.rn || ')'
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "owner_id", lower("name") ORDER BY "created_at", "id"
  ) AS rn FROM "tags"
) d
WHERE t."id" = d."id" AND d.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_owner_name_uq" ON "tags" USING btree ("owner_id",lower("name"));
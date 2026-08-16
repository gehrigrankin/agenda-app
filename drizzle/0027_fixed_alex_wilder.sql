DROP INDEX "people_owner_namekey_uq";--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD COLUMN "weekdays" integer[];--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD COLUMN "end_date" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "people_owner_namekey_idx" ON "people" USING btree ("owner_id","name_key");
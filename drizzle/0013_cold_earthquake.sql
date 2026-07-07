CREATE TYPE "public"."capture_source" AS ENUM('email', 'link', 'photo', 'text');--> statement-breakpoint
CREATE TYPE "public"."capture_status" AS ENUM('new', 'filed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."commitment_direction" AS ENUM('you_owe', 'they_owe');--> statement-breakpoint
CREATE TYPE "public"."gardener_kind" AS ENUM('merge_duplicate', 'archive_board', 'link_notes');--> statement-breakpoint
CREATE TYPE "public"."gardener_status" AS ENUM('open', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TABLE "capture_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"source" "capture_source" NOT NULL,
	"status" "capture_status" DEFAULT 'new' NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"url" text,
	"attachment_id" uuid,
	"suggested_bubble_id" uuid,
	"suggestion_label" text,
	"suggestion_reason" text,
	"filed_note_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gardener_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"kind" "gardener_kind" NOT NULL,
	"status" "gardener_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"last_mentioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"direction" "commitment_direction" NOT NULL,
	"text" text NOT NULL,
	"task_id" uuid,
	"source_note_id" uuid,
	"context_label" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"snippet" text NOT NULL,
	"mention_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"local_date" text NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD COLUMN "is_habit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "people_scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "gardener_scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "capture_address" text;--> statement-breakpoint
ALTER TABLE "capture_inbox" ADD CONSTRAINT "capture_inbox_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_inbox" ADD CONSTRAINT "capture_inbox_suggested_bubble_id_bubbles_id_fk" FOREIGN KEY ("suggested_bubble_id") REFERENCES "public"."bubbles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_inbox" ADD CONSTRAINT "capture_inbox_filed_note_id_notes_id_fk" FOREIGN KEY ("filed_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_commitments" ADD CONSTRAINT "person_commitments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_commitments" ADD CONSTRAINT "person_commitments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_commitments" ADD CONSTRAINT "person_commitments_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_mentions" ADD CONSTRAINT "person_mentions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_mentions" ADD CONSTRAINT "person_mentions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_blocks" ADD CONSTRAINT "task_blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_inbox_owner_status_idx" ON "capture_inbox" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "gardener_owner_status_idx" ON "gardener_suggestions" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gardener_owner_dedupe_uq" ON "gardener_suggestions" USING btree ("owner_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "people_owner_idx" ON "people" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_owner_namekey_uq" ON "people" USING btree ("owner_id","name_key");--> statement-breakpoint
CREATE INDEX "person_commitments_person_idx" ON "person_commitments" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_commitments_dedupe_uq" ON "person_commitments" USING btree ("person_id","direction","text");--> statement-breakpoint
CREATE INDEX "person_mentions_person_idx" ON "person_mentions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_mentions_note_idx" ON "person_mentions" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_mentions_dedupe_uq" ON "person_mentions" USING btree ("person_id","note_id","snippet");--> statement-breakpoint
CREATE INDEX "task_blocks_owner_date_idx" ON "task_blocks" USING btree ("owner_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "task_blocks_task_date_uq" ON "task_blocks" USING btree ("task_id","local_date");
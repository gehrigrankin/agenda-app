CREATE TYPE "public"."thread_status" AS ENUM('active', 'promoted', 'dismissed');--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"note_id" uuid,
	"summary" text NOT NULL,
	"undo_data" jsonb,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"rule" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_declines" (
	"owner_id" text NOT NULL,
	"event_uid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_declines_owner_id_event_uid_pk" PRIMARY KEY("owner_id","event_uid")
);
--> statement-breakpoint
CREATE TABLE "thread_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"snippet" text NOT NULL,
	"mention_date" timestamp with time zone NOT NULL,
	"quiet" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"topic" text NOT NULL,
	"status" "thread_status" DEFAULT 'active' NOT NULL,
	"promoted_note_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"calendar_ics_url" text,
	"recall_enabled" boolean DEFAULT true NOT NULL,
	"threads_scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_memos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"note_id" uuid,
	"url" text NOT NULL,
	"storage_key" text,
	"duration_sec" integer,
	"transcript" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"week_start" text NOT NULL,
	"content" jsonb NOT NULL,
	"inserted_note_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "text_content" text;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_mentions" ADD CONSTRAINT "thread_mentions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_mentions" ADD CONSTRAINT "thread_mentions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_promoted_note_id_notes_id_fk" FOREIGN KEY ("promoted_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_memos" ADD CONSTRAINT "voice_memos_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_reviews" ADD CONSTRAINT "week_reviews_inserted_note_id_notes_id_fk" FOREIGN KEY ("inserted_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_owner_created_idx" ON "automation_runs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "automations_owner_idx" ON "automations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "thread_mentions_thread_idx" ON "thread_mentions" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "thread_mentions_note_idx" ON "thread_mentions" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_mentions_dedupe_uq" ON "thread_mentions" USING btree ("thread_id","note_id","snippet");--> statement-breakpoint
CREATE INDEX "threads_owner_idx" ON "threads" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_owner_topic_uq" ON "threads" USING btree ("owner_id","topic");--> statement-breakpoint
CREATE INDEX "voice_memos_owner_idx" ON "voice_memos" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "week_reviews_owner_week_uq" ON "week_reviews" USING btree ("owner_id","week_start");
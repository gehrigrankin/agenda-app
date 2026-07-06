CREATE TYPE "public"."recurrence_freq" AS ENUM('daily', 'weekly', 'interval', 'monthly');--> statement-breakpoint
CREATE TABLE "recurring_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"freq" "recurrence_freq" NOT NULL,
	"weekday" integer,
	"interval_days" integer,
	"month_day" integer,
	"remind_at" text,
	"paused" boolean DEFAULT false NOT NULL,
	"anchor_date" text NOT NULL,
	"last_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "remind_at_local" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurring_task_id" uuid;--> statement-breakpoint
CREATE INDEX "recurring_tasks_owner_idx" ON "recurring_tasks" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurring_task_id_recurring_tasks_id_fk" FOREIGN KEY ("recurring_task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE set null ON UPDATE no action;
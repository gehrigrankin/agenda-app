ALTER TYPE "public"."capture_source" ADD VALUE 'voice';--> statement-breakpoint
CREATE TABLE "person_group_members" (
	"group_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "person_group_members_group_id_person_id_pk" PRIMARY KEY("group_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "person_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capture_inbox" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capture_inbox" ADD COLUMN "filed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "someday" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "person_group_members" ADD CONSTRAINT "person_group_members_group_id_person_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."person_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_group_members" ADD CONSTRAINT "person_group_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_group_members_person_idx" ON "person_group_members" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_groups_owner_idx" ON "person_groups" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_id");
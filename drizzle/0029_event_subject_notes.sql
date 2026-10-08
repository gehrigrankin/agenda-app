ALTER TABLE "calendar_events" ADD COLUMN "tag_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;
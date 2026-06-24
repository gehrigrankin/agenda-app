ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "bubble_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_bubble_id_bubbles_id_fk" FOREIGN KEY ("bubble_id") REFERENCES "public"."bubbles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_bubble_idx" ON "notes" USING btree ("bubble_id");

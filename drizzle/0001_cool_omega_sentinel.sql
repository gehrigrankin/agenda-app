CREATE TABLE IF NOT EXISTS "bubbles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"parent_id" uuid,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bubbles" ADD CONSTRAINT "bubbles_parent_id_bubbles_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."bubbles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bubbles_owner_idx" ON "bubbles" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bubbles_parent_idx" ON "bubbles" USING btree ("parent_id");

CREATE TABLE "jots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"text" text NOT NULL,
	"jot_date" timestamp NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jots_owner_date_idx" ON "jots" USING btree ("owner_id","jot_date");
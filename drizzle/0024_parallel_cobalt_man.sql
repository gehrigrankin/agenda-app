CREATE TABLE "guest_sessions" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by_owner_id" text,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "guest_sessions_last_seen_idx" ON "guest_sessions" USING btree ("last_seen_at");
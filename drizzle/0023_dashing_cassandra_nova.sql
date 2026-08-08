CREATE TABLE "note_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source_note_id" uuid NOT NULL,
	"target_note_id" uuid NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_logs" ADD CONSTRAINT "note_logs_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_logs" ADD CONSTRAINT "note_logs_target_note_id_notes_id_fk" FOREIGN KEY ("target_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_logs_owner_idx" ON "note_logs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "note_logs_target_idx" ON "note_logs" USING btree ("target_note_id","created_at");--> statement-breakpoint
CREATE INDEX "note_logs_source_idx" ON "note_logs" USING btree ("source_note_id");
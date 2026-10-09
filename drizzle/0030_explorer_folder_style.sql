ALTER TABLE "bubbles" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "bubbles" ADD COLUMN "sort_mode" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
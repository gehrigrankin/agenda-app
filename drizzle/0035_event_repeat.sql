CREATE TYPE "public"."event_repeat" AS ENUM('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly');--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "repeat" "event_repeat";--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "repeat_until" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "skip_dates" text[];
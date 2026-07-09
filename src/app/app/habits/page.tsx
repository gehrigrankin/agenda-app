import { HabitsPageClient } from "@/components/habits/HabitsPageClient";

export const metadata = { title: "Habits" };

/**
 * Habits page (design Turn 17g): the phone tab bar's Habits destination —
 * one card per habit with a one-tap log button and a 7-day streak strip.
 * All data loads client-side, same as Tasks: "today" is a local-timezone
 * concept only the client can resolve, and the log toggle wants an
 * optimistic update the server round-trip can't give for free.
 */
export default function HabitsPage() {
  return <HabitsPageClient />;
}

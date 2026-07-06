import { CalendarPageClient } from "@/components/calendar/CalendarPageClient";

/**
 * Calendar page: month grid of daily notes and task due dates. All data loads
 * client-side (dates are the user's LOCAL calendar days, so the client owns
 * the month math — same convention as the daily home).
 */
export default function CalendarPage() {
  return <CalendarPageClient />;
}

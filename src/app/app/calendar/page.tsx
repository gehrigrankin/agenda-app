import { CalendarPageClient } from "@/components/calendar/CalendarPageClient";

import { cacheScopeForOwner } from "../cache-scope";
import { getOwnerId } from "../owner";

/**
 * Calendar page: month grid of daily notes and task due dates. All data loads
 * client-side (dates are the user's LOCAL calendar days, so the client owns
 * the month math — same convention as the daily home).
 */
export default async function CalendarPage() {
  const ownerId = await getOwnerId();
  return <CalendarPageClient cacheScope={cacheScopeForOwner(ownerId)} />;
}

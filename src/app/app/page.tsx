import { CalendarDays } from "lucide-react";

import { HomeClient } from "@/components/home/HomeClient";
import { DATE_STR_RE } from "@/lib/dates";
import { listInbox } from "@/server/inbox";

import { getOwnerId } from "./owner";

/**
 * Home: the daily-note page. The client owns everything date-shaped (the
 * server can't know the user's timezone); this component only validates the
 * `?d=` param and counts the inbox for the phone header badge.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const ownerId = await getOwnerId();
  const { d } = await searchParams;
  const viewDate = typeof d === "string" && DATE_STR_RE.test(d) ? d : null;

  let inboxCount = 0;
  let dbUnavailable = false;

  if (ownerId) {
    try {
      // Inbox count feeds the phone header's badge (Turn 17a). The pinned
      // folder is no longer read here — the board widget left the home when
      // the daily note took the full column.
      inboxCount = (await listInbox(ownerId)).length;
    } catch (err) {
      console.error("[app] failed to load home data:", err);
      dbUnavailable = true;
    }
  }

  if (dbUnavailable) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-8 text-center">
        <CalendarDays className="h-10 w-10 text-ink-700" />
        <div>
          <p className="text-sm font-medium text-ink-400">
            We couldn&rsquo;t reach the database.
          </p>
          <p className="mt-1 text-sm text-ink-600">
            Check DATABASE_URL, then refresh.
          </p>
        </div>
      </div>
    );
  }

  return <HomeClient viewDate={viewDate} inboxCount={inboxCount} />;
}

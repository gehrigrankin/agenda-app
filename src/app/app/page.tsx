import { HomeClient } from "@/components/home/HomeClient";
import { DATE_STR_RE } from "@/lib/dates";

import { cacheScopeForOwner } from "./cache-scope";
import { getOwnerId } from "./owner";

/**
 * Home: the daily-note page. The client owns everything date-shaped (the
 * server can't know the user's timezone); this component only validates the
 * `?d=` param and supplies an owner-scoped browser-cache namespace.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const ownerId = await getOwnerId();
  const { d } = await searchParams;
  const viewDate = typeof d === "string" && DATE_STR_RE.test(d) ? d : null;

  return (
    <HomeClient
      viewDate={viewDate}
      cacheScope={cacheScopeForOwner(ownerId)}
    />
  );
}

import { auth } from "@clerk/nextjs/server";
import { CalendarDays } from "lucide-react";

import { HomeClient } from "@/components/home/HomeClient";
import type { BoardData } from "@/components/home/PinnedBoardWidget";
import { DATE_STR_RE } from "@/lib/dates";
import * as bubblesRepo from "@/server/bubbles";
import { listNotesForBubble } from "@/server/notes";

/**
 * Home: the daily-note page. The client owns everything date-shaped (the
 * server can't know the user's timezone); this component only validates the
 * `?d=` param and loads the timezone-independent pinned-board data.
 */
export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { userId } = await auth();
  const { d } = await searchParams;
  const viewDate = typeof d === "string" && DATE_STR_RE.test(d) ? d : null;

  let board: BoardData | null = null;
  let dbUnavailable = false;

  if (userId) {
    try {
      const folders = await bubblesRepo.listFolderBubbles(userId);
      const folder = folders[0];
      if (folder) {
        board = {
          id: folder.id,
          title: folder.title,
          color: folder.color,
          notes: await listNotesForBubble(userId, folder.id, 2),
        };
      }
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

  return <HomeClient viewDate={viewDate} board={board} />;
}

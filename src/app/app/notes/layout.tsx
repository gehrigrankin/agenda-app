import { auth } from "@clerk/nextjs/server";

import {
  NotesDetailPane,
  NotesListPane,
  type DailyRowData,
  type NoteRowData,
} from "@/components/notes/NotesListPane";
import { listNotesWithPreview, listRecentDailyNotes } from "@/server/notes";

/**
 * Notes route shell: list pane + detail pane (`[id]` renders into children).
 * The pinned daily row is the MOST RECENT live daily note — the server can't
 * know the client's "today", so the client just labels whatever this is.
 */
export default async function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userId } = await auth();

  let daily: DailyRowData | null = null;
  let notes: NoteRowData[] = [];
  if (userId) {
    try {
      const [dailies, rows] = await Promise.all([
        listRecentDailyNotes(userId, 1),
        listNotesWithPreview(userId, 60),
      ]);
      const latest = dailies[0];
      if (latest) {
        daily = {
          id: latest.id,
          title: latest.title,
          updatedAt: latest.updatedAt.toISOString(),
        };
      }
      notes = rows.map((n) => ({
        id: n.id,
        title: n.title,
        preview: n.preview,
        updatedAt: n.updatedAt.toISOString(),
      }));
    } catch (err) {
      console.error("[notes] failed to load list:", err);
    }
  }

  return (
    // md:pl clears the floating nav rail.
    <div className="flex h-full min-h-0 md:pl-[5.75rem]">
      <NotesListPane daily={daily} notes={notes} />
      <NotesDetailPane>{children}</NotesDetailPane>
    </div>
  );
}

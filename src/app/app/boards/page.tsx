import { auth } from "@clerk/nextjs/server";

import { BoardsGrid, type BoardCard } from "@/components/bubbles/BoardsGrid";
import { listFolderBubbles } from "@/server/bubbles";
import { countNotesByBubble, listBubbleNoteSummaries } from "@/server/notes";

export const metadata = { title: "Boards" };

/**
 * Boards overview (design Turn 17l): the phone tab bar's Boards destination.
 * Each card shows the board's note count and two freshest note titles.
 */
export default async function BoardsPage() {
  const { userId } = await auth();

  let boards: BoardCard[] = [];
  if (userId) {
    try {
      const [folders, counts, notes] = await Promise.all([
        listFolderBubbles(userId),
        countNotesByBubble(userId),
        listBubbleNoteSummaries(userId),
      ]);
      const countByBubble = new Map(
        counts
          .filter((c) => c.bubbleId !== null)
          .map((c) => [c.bubbleId as string, c.count]),
      );
      // Two freshest note titles per board.
      const recentByBubble = new Map<string, string[]>();
      for (const note of [...notes].sort((a, b) =>
        b.updatedAt.toISOString().localeCompare(a.updatedAt.toISOString()),
      )) {
        if (!note.bubbleId) continue;
        const list = recentByBubble.get(note.bubbleId) ?? [];
        if (list.length < 2) {
          list.push(note.title);
          recentByBubble.set(note.bubbleId, list);
        }
      }
      boards = folders.map((f) => ({
        id: f.id,
        title: f.title,
        emoji: f.emoji,
        color: f.color,
        count: countByBubble.get(f.id) ?? 0,
        recent: recentByBubble.get(f.id) ?? [],
      }));
    } catch (err) {
      console.error("[boards] failed to load:", err);
    }
  }

  return <BoardsGrid boards={boards} />;
}

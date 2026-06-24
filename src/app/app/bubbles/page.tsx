import { auth } from "@clerk/nextjs/server";

import {
  BubbleView,
  type BubbleData,
  type BubbleNoteData,
} from "@/components/bubbles/BubbleView";
import { getOrCreateRoot, listBubbles } from "@/server/bubbles";
import { listBubbleNoteSummaries } from "@/server/notes";

export default async function BubblesPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string }>;
}) {
  const { userId } = await auth();
  const { b } = await searchParams;
  const initialBubbleId = typeof b === "string" ? b : null;

  let nodes: BubbleData[] = [];
  let notes: BubbleNoteData[] = [];
  let rootId: string | null = null;

  if (userId) {
    try {
      const root = await getOrCreateRoot(userId);
      rootId = root.id;
      const all = await listBubbles(userId);
      nodes = all.map((b) => ({
        id: b.id,
        parentId: b.parentId,
        title: b.title,
        emoji: b.emoji,
        color: b.color,
        isFolder: b.isFolder,
      }));
      const noteRows = await listBubbleNoteSummaries(userId);
      notes = noteRows
        .filter((n): n is typeof n & { bubbleId: string } => n.bubbleId !== null)
        .map((n) => ({
          id: n.id,
          bubbleId: n.bubbleId,
          title: n.title,
          preview: n.preview,
        }));
    } catch (err) {
      console.error("[bubbles] load failed:", err);
    }
  }

  if (!rootId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
        Bubble map is unavailable right now (couldn’t reach the database).
      </div>
    );
  }

  return (
    <BubbleView
      rootId={rootId}
      initialBubbleId={initialBubbleId}
      nodes={nodes}
      notes={notes}
    />
  );
}

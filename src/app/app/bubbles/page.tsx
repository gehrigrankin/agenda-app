import { auth } from "@clerk/nextjs/server";

import { BubbleView, type BubbleData } from "@/components/bubbles/BubbleView";
import { getOrCreateRoot, listBubbles } from "@/server/bubbles";

export default async function BubblesPage() {
  const { userId } = await auth();

  let nodes: BubbleData[] = [];
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
        notes: b.notes,
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

  return <BubbleView rootId={rootId} nodes={nodes} />;
}

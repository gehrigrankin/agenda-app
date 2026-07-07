import type { Metadata } from "next";

import { ThreadsPageClient } from "@/components/threads/ThreadsPageClient";

export const metadata: Metadata = {
  title: "Threads",
};

/**
 * Threads page: the rail's Threads destination — auto-assembled chronological
 * topic threads across notes (design Turn 14b). All data loads client-side;
 * auth is enforced in the server actions.
 */
export default function ThreadsPage() {
  return <ThreadsPageClient />;
}

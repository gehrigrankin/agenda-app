import type { Metadata } from "next";

import { ThreadsPageClient } from "@/components/threads/ThreadsPageClient";

export const metadata: Metadata = {
  title: "Threads",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Threads page (under More): auto-assembled chronological topic threads
 * across notes. `?t=<id>` opens a specific thread (the client keeps it in
 * the URL as you select). All data loads client-side; auth is enforced in
 * the server actions.
 */
export default async function ThreadsPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t } = await searchParams;
  const id = Array.isArray(t) ? t[0] : t;
  return (
    <ThreadsPageClient initialThreadId={id && UUID_RE.test(id) ? id : null} />
  );
}

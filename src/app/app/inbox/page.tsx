import type { Metadata } from "next";

import { InboxPageClient } from "@/components/inbox/InboxPageClient";

export const metadata: Metadata = {
  title: "Inbox",
};

/**
 * Capture inbox page (design 16c): "forward anything" — the rail's Inbox
 * destination. All data loads client-side; auth is enforced in the server
 * actions.
 */
export default function InboxPage() {
  return <InboxPageClient />;
}

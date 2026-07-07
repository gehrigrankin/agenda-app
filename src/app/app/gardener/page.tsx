import type { Metadata } from "next";

import { GardenerPageClient } from "@/components/gardener/GardenerPageClient";

export const metadata: Metadata = {
  title: "Gardener",
};

/**
 * Gardener page (design 15c): the rail's Gardener destination — a weekly
 * heuristic sweep of the library that proposes small, evidence-backed
 * tidy-ups (merge near-duplicates, archive a stale board, link notes that
 * answer each other) one at a time. All data loads client-side; auth is
 * enforced in the server actions.
 */
export default function GardenerPage() {
  return <GardenerPageClient />;
}

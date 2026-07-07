import type { Metadata } from "next";

import { PeoplePageClient } from "@/components/people/PeoplePageClient";

export const metadata: Metadata = {
  title: "People",
};

/**
 * People page: the rail's People destination — an auto-maintained page per
 * person the user mentions (design 15a). All data loads client-side; auth is
 * enforced in the server actions.
 */
export default function PeoplePage() {
  return <PeoplePageClient />;
}

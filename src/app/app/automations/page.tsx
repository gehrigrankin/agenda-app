import type { Metadata } from "next";

import { AutomationsPageClient } from "@/components/automations/AutomationsPageClient";

export const metadata: Metadata = {
  title: "Automations",
};

/**
 * Automations page (design Turn 14e): plain-language rules that run quietly
 * on what you write, each with its last run and an undo. All data loads
 * client-side; auth is enforced in the server actions.
 */
export default function AutomationsPage() {
  return <AutomationsPageClient />;
}

import { TasksPageClient } from "@/components/tasks/TasksPageClient";

import { cacheScopeForOwner } from "../cache-scope";
import { getOwnerId } from "../owner";

/**
 * Tasks page: the rail's Tasks destination — Today and Upcoming lists plus
 * the Recurring rules section (design Turn 12b). All data loads client-side.
 */
export default async function TasksPage() {
  const ownerId = await getOwnerId();
  return <TasksPageClient cacheScope={cacheScopeForOwner(ownerId)} />;
}

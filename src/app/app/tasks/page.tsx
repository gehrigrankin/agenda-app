import { TasksPageClient } from "@/components/tasks/TasksPageClient";

/**
 * Tasks page: the rail's Tasks destination — Today and Upcoming lists plus
 * the Recurring rules section (design Turn 12b). All data loads client-side.
 */
export default function TasksPage() {
  return <TasksPageClient />;
}

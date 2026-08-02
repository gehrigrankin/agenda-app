import { NotesShellSkeleton } from "@/components/notes/NotesShellSkeleton";

/**
 * Notes route loading skeleton — covers navigation between notes. First
 * navigation into /app/notes is covered separately by the layout's own
 * Suspense fallback (same skeleton component).
 */
export default function NotesLoading() {
  return <NotesShellSkeleton />;
}

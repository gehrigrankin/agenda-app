import { NoteEditorSkeleton } from "@/components/notes/NotesShellSkeleton";

/**
 * Notes route loading UI — covers navigation between notes. It renders inside
 * the editor pane (the layout's Explorer and tabs stay mounted), so it's the
 * document alone. First entry into /app/notes is covered by the layout's own
 * Suspense fallback (the full NotesShellSkeleton).
 */
export default function NotesLoading() {
  return <NoteEditorSkeleton />;
}

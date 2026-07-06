import { FileText } from "lucide-react";

/** No-selection state for the notes route (the list pane sits on the left). */
export default function NotesIndexPage() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-8 text-center">
      <FileText className="h-8 w-8 text-ink-700" />
      <p className="text-sm text-ink-500">
        Select a note — or start with today&rsquo;s daily note, pinned at the
        top of the list.
      </p>
    </div>
  );
}

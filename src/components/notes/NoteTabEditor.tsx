"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { getNoteAction, type NoteDetailResult } from "@/app/app/actions";
import { NoteEditor } from "@/components/notes/NoteEditor";

/**
 * A main-view tab whose note is NOT the one the route server-rendered — loaded
 * on the client so switching tabs costs a fetch, not a navigation.
 *
 * The route's own tab keeps the server-rendered page (logs rail, backlinks);
 * this is the editor alone. That asymmetry is the price of a switch that
 * doesn't re-render the world, and it resolves itself the moment the tab is
 * reached by a real navigation (a reload, a deep link, a click from the list).
 *
 * A failed load and a note that no longer exists are separate states, as in
 * the dock: a transient DB hiccup must not look permanent, and a genuinely
 * gone note needs the one action left — closing its tab.
 */
type TabLoad =
  | { status: "loading" }
  | { status: "ready"; detail: NoteDetailResult }
  | { status: "gone" }
  | { status: "error" };

export function NoteTabEditor({
  noteId,
  onTitle,
  onCloseTab,
}: {
  noteId: string;
  onTitle: (title: string) => void;
  onCloseTab: () => void;
}) {
  const [load, setLoad] = useState<TabLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    getNoteAction(noteId)
      .then((n) => {
        if (cancelled) return;
        if (!n) {
          setLoad({ status: "gone" });
          return;
        }
        setLoad({ status: "ready", detail: n });
        onTitle(n.title || "");
      })
      .catch((err) => {
        console.error("[notes] tab load failed:", err);
        if (!cancelled) setLoad({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // onTitle is stable enough for a one-shot report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, attempt]);

  if (load.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-ink-600" />
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <TabMessage
        text="Couldn't load this note."
        actionLabel="Try again"
        onAction={() => setAttempt((a) => a + 1)}
      />
    );
  }
  if (load.status === "gone") {
    return (
      <TabMessage
        text="This note is gone — it was deleted, or it belongs to another account."
        actionLabel="Close tab"
        onAction={onCloseTab}
      />
    );
  }
  return (
    // No onClose/onTrashed: this IS the full-page editor for its note, so it
    // keeps the phone toolbar the embedded surfaces suppress.
    <NoteEditor
      key={load.detail.id}
      noteId={load.detail.id}
      initialTitle={load.detail.title}
      initialContent={load.detail.content}
      initialContentRevision={load.detail.contentRevision}
      initialBubbleId={load.detail.bubbleId}
    />
  );
}

/** A dead-end state in the editor pane, with the one action that resolves it. */
function TabMessage({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="max-w-[18rem] text-[0.78125rem] text-ink-500">{text}</p>
      <button
        type="button"
        onClick={onAction}
        className="rounded-md border border-steel/35 px-2.5 py-1 text-[0.75rem] font-medium text-ink-200 hover:border-steel/60 hover:bg-white/6"
      >
        {actionLabel}
      </button>
    </div>
  );
}

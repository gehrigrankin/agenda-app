"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import { Link2, ScanEye } from "lucide-react";

import {
  getLinkedTodayAction,
  type LinkedTodayEntry,
} from "@/app/app/actions";
import {
  $createLinkedNoteCardNode,
  LinkedNoteCard,
} from "@/components/editor/nodes/LinkedNoteCardNode";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { QuickViewContext } from "@/components/notes/NotePreviewProvider";
import { localDayBounds } from "@/lib/dates";

/**
 * Right-column "Linked today": notes the viewed day's daily note links out
 * to, plus notes edited that day but not linked. The latter render as
 * standalone editable LinkedNoteCards (live inline editor, no auto-insert
 * into the daily doc). Their title row doubles as the "open in a window"
 * trigger, and the top-right icon links the card into the daily doc (only
 * once its editor is on-screen) — see LinkedNoteCard's `titleOpensWindow` /
 * `onLinkIntoToday` props, which only this widget's cards opt into.
 */

function formatEditedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LinkedTodayWidget({
  dailyNoteId,
  dateStr,
  refreshKey,
  editorRef,
}: {
  dailyNoteId: string | null;
  dateStr: string | null;
  /** Bump to refetch (linked-card count changed, quick view closed…). */
  refreshKey: number;
  editorRef: React.MutableRefObject<LexicalEditor | null>;
}) {
  const quickView = useContext(QuickViewContext);
  const [linked, setLinked] = useState<LinkedTodayEntry[]>([]);
  const [edited, setEdited] = useState<LinkedTodayEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    if (!dailyNoteId || !dateStr) {
      // No daily note for this day — clear the previous day's rows instead
      // of leaving them on screen.
      setLinked([]);
      setEdited([]);
      setLoaded(true);
      return;
    }
    const { start, end } = localDayBounds(dateStr);
    getLinkedTodayAction(dailyNoteId, start.toISOString(), end.toISOString())
      .then((res) => {
        setLinked(res.linked);
        setEdited(res.editedElsewhere);
        setLoaded(true);
      })
      .catch((err) => console.error("[linked-today] load failed:", err));
  }, [dailyNoteId, dateStr]);

  useEffect(() => {
    refresh();
    // refreshKey is a deliberate extra trigger (autosave lands ~1s after a
    // card is added, so also refetch shortly after a bump).
    const timer = setTimeout(refresh, 1500);
    return () => clearTimeout(timer);
  }, [refresh, refreshKey]);

  const appendLinkCard = (entry: LinkedTodayEntry) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.update(() => {
      const root = $getRoot();
      const lead = $createTimedParagraphNode();
      root.append(lead);
      const card = $createLinkedNoteCardNode({
        noteId: entry.id,
        title: entry.title,
      });
      root.append(card);
      const continuation = $createTimedParagraphNode();
      root.append(continuation);
      continuation.select();
    });
    // Optimistic move between sections; the autosave reconcile confirms it.
    setEdited((prev) => prev.filter((e) => e.id !== entry.id));
    setLinked((prev) => [entry, ...prev]);
  };

  const row = (entry: LinkedTodayEntry) => (
    <div
      key={entry.id}
      className="flex items-center gap-2 rounded-[0.5rem] border border-white/7 bg-white/3 px-2 py-2 hover:border-steel/35"
    >
      <span
        className="h-[0.4375rem] w-[0.4375rem] flex-none rounded-full"
        style={{ background: entry.bubbleColor ?? "#9CC5AC" }}
      />
      <button
        type="button"
        onClick={() => quickView?.open(entry.id)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-[0.75rem] font-medium leading-[1.3] text-ink-200">
          {entry.title || "Untitled"}
        </span>
        <span className="block text-[0.625rem] leading-[1.4] text-ink-600">
          edited {formatEditedTime(entry.updatedAt)}
        </span>
      </button>
      <ScanEye className="h-3 w-3 flex-none text-ink-600" />
    </div>
  );

  // "Edited today" entries render as full editable LinkedNoteCards (live
  // inline editor via NotePreviewProvider) rather than plain rows — the user
  // can read/edit them in place without linking into the daily note. The
  // title itself opens the note in a window; the top-right icon links the
  // card into the daily doc (only once its editor is on-screen).
  const editedCard = (entry: LinkedTodayEntry) => (
    <LinkedNoteCard
      key={entry.id}
      noteId={entry.id}
      title={entry.title}
      titleOpensWindow
      onLinkIntoToday={
        editorRef.current ? () => appendLinkCard(entry) : undefined
      }
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-white/7 px-3.5 py-3">
        <Link2 className="h-[0.8125rem] w-[0.8125rem] text-steel" />
        <span className="text-[0.8125rem] font-semibold text-ink-100">
          Linked today
        </span>
        {loaded ? (
          <span className="text-[0.6875rem] text-ink-600">
            {linked.length} note{linked.length === 1 ? "" : "s"}
          </span>
        ) : (
          <div className="h-2.5 w-12 animate-pulse rounded bg-white/6" />
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {!loaded ? (
          <div className="flex flex-col gap-1.5 p-1.5" aria-hidden>
            <div className="h-8 animate-pulse rounded-[0.5rem] bg-white/6" />
            <div className="h-8 animate-pulse rounded-[0.5rem] bg-white/5" />
            <div className="h-8 animate-pulse rounded-[0.5rem] bg-white/6" />
          </div>
        ) : (
          <>
            {linked.length === 0 && (
              <p className="px-2 py-2 text-[0.6875rem] leading-relaxed text-ink-600">
                Link a note from today&rsquo;s writing — type{" "}
                <span className="font-mono text-steel">[[</span> in the daily
                note — and it shows up here.
              </p>
            )}
            {linked.map((e) => row(e))}
            {edited.length > 0 && (
              <div className="px-1.5 pb-1 pt-2 text-[0.59375rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
                Edited today
              </div>
            )}
            <div className="flex flex-col gap-2 px-0.5 pb-1">
              {edited.map((e) => editedCard(e))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

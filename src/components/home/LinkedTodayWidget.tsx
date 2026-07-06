"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import { Link2, ScanEye } from "lucide-react";

import {
  getLinkedTodayAction,
  type LinkedTodayEntry,
} from "@/app/app/actions";
import { $createLinkedNoteCardNode } from "@/components/editor/nodes/LinkedNoteCardNode";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { QuickViewContext } from "@/components/notes/NotePreviewProvider";
import { localDayBounds } from "@/lib/dates";

/**
 * Right-column "Linked today": notes the viewed day's daily note links out
 * to, plus notes edited that day but not linked — with a one-click "link"
 * that appends a card to the daily doc (only when its editor is on-screen).
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
    if (!dailyNoteId || !dateStr) return;
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

  const row = (entry: LinkedTodayEntry, isLinked: boolean) => (
    <div
      key={entry.id}
      className={`flex items-center gap-2 rounded-[0.5625rem] px-2 py-2 ${
        isLinked
          ? "border border-white/7 bg-white/3 hover:border-steel/35"
          : "hover:bg-white/4"
      }`}
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
          {!isLinked && " · not linked"}
        </span>
      </button>
      {isLinked ? (
        <ScanEye className="h-3 w-3 flex-none text-ink-600" />
      ) : (
        editorRef.current && (
          <button
            type="button"
            onClick={() => appendLinkCard(entry)}
            className="flex-none text-[0.625rem] font-medium text-steel hover:underline"
          >
            link
          </button>
        )
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-white/7 px-3.5 py-3">
        <Link2 className="h-[0.8125rem] w-[0.8125rem] text-steel" />
        <span className="text-[0.8125rem] font-semibold text-ink-100">
          Linked today
        </span>
        <span className="text-[0.6875rem] text-ink-600">
          {linked.length} note{linked.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {linked.length === 0 && loaded && (
          <p className="px-2 py-2 text-[0.6875rem] leading-relaxed text-ink-600">
            Link a note from today&rsquo;s writing — type{" "}
            <span className="font-mono text-steel">[[</span> in the daily note
            — and it shows up here.
          </p>
        )}
        {linked.map((e) => row(e, true))}
        {edited.length > 0 && (
          <div className="px-1.5 pb-1 pt-2 text-[0.59375rem] font-medium uppercase tracking-[0.0875rem] text-ink-600">
            Edited elsewhere
          </div>
        )}
        {edited.map((e) => row(e, false))}
      </div>
    </div>
  );
}

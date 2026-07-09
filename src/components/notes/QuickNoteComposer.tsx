"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { $getRoot, $isElementNode, type EditorState } from "lexical";
import { FileText, Loader2, X } from "lucide-react";

import { quickCreateNoteAction } from "@/app/app/actions";
import { Editor } from "@/components/editor/Editor";
import { useNoteDock } from "@/components/notes/NoteDockProvider";

/**
 * Mini note composer for the rail's + menu: a title input over a small LOCAL
 * Lexical editor. No note row exists yet, so the dock's autosaving editors
 * (which need a note id) don't apply — the latest EditorState is held in a
 * ref and only serialized when the user hits Create, which persists title +
 * body via `quickCreateNoteAction` and opens the new note as a floating dock
 * tab. Nothing navigates; nothing is written to the DB until Create.
 *
 * Dismissal contract (the parent CreateMenu enforces the outside-click half
 * via `dirtyRef`): outside clicks only close the composer while it is
 * completely empty; once there's a title or body, only the X button or
 * Escape closes it (discarding the draft).
 */
export function QuickNoteComposer({
  dirtyRef,
  onClose,
}: {
  /** Parent-owned flag: true while the composer holds any typed text. */
  dirtyRef: React.MutableRefObject<boolean>;
  onClose: () => void;
}) {
  const dock = useNoteDock();
  const [title, setTitle] = useState("");
  const [isCreating, startCreate] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<EditorState | null>(null);
  const bodyHasContentRef = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const onTitleChange = (next: string) => {
    setTitle(next);
    dirtyRef.current = next.trim().length > 0 || bodyHasContentRef.current;
  };

  const onEditorChange = (state: EditorState) => {
    stateRef.current = state;
    // "Has content" = any text, or any non-empty block (an image or task
    // node carries no text but is still content worth protecting/saving).
    bodyHasContentRef.current = state.read(() => {
      const root = $getRoot();
      if (root.getTextContent().trim().length > 0) return true;
      const children = root.getChildren();
      if (children.length > 1) return true;
      const first = children[0];
      return first !== undefined &&
        (!$isElementNode(first) || first.getChildrenSize() > 0);
    });
    dirtyRef.current = title.trim().length > 0 || bodyHasContentRef.current;
  };

  const create = () => {
    if (isCreating) return;
    const body =
      bodyHasContentRef.current && stateRef.current
        ? stateRef.current.toJSON()
        : undefined;
    startCreate(async () => {
      try {
        const note = await quickCreateNoteAction(title.trim(), body);
        dock?.open(note.id, note.title);
        onClose();
      } catch (err) {
        console.error("[quick-note] create failed:", err);
        // Leave the draft intact so the user can retry.
      }
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-1">
        <FileText className="h-3.5 w-3.5 flex-none text-sage" />
        <span className="min-w-0 flex-1 truncate text-[0.65625rem] font-medium uppercase tracking-wide text-ink-500">
          New note
        </span>
        <button
          type="button"
          aria-label="Discard"
          title="Discard"
          onClick={onClose}
          className="flex h-[1.375rem] w-[1.375rem] flex-none items-center justify-center rounded-md hover:bg-white/6"
        >
          <X className="h-3 w-3 text-ink-400" />
        </button>
      </div>
      <input
        ref={titleRef}
        value={title}
        disabled={isCreating}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") create();
        }}
        placeholder="Untitled…"
        className="w-full border-b border-sage/50 bg-transparent px-0.5 py-1 text-[0.8125rem] font-medium text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-60"
      />
      <div className="flex max-h-[14rem] min-h-[7rem] flex-col overflow-y-auto">
        <Editor
          hideToolbar
          onChange={onEditorChange}
          contentClassName="editor-content min-h-[7rem] w-full px-0.5 py-2 text-[0.8125rem] leading-relaxed text-ink-200 outline-none"
        />
      </div>
      <div className="flex items-center justify-end border-t border-white/7 pt-1.5">
        <button
          type="button"
          disabled={isCreating}
          onClick={create}
          className="flex items-center gap-1.5 rounded-lg bg-sage/16 px-3 py-1.5 text-[0.75rem] font-semibold text-sage hover:bg-sage/24 disabled:opacity-60"
        >
          {isCreating && <Loader2 className="h-3 w-3 animate-spin" />}
          Create
        </button>
      </div>
    </div>
  );
}

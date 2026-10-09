"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import { $isHeadingNode } from "@lexical/rich-text";

import type { SaveStatus } from "@/lib/hooks/use-save-retry";

/**
 * What a live note editor on the Notes page reports up to the page: its
 * outline (for the Explorer's Outline pane), word count and save state (for
 * focus mode's status bar), and the Lexical instance (so an outline click can
 * scroll to its heading). Editors outside the Notes page have no provider and
 * report nothing.
 */

export interface OutlineItem {
  key: string;
  text: string;
  level: number; // 1–6
}

export interface NoteSurfaceInfo {
  noteId: string;
  title: string;
  status: SaveStatus;
  words: number;
  outline: OutlineItem[];
  editor: LexicalEditor | null;
}

type Report = (info: NoteSurfaceInfo | null, noteId: string) => void;

const NoteSurfaceContext = createContext<Report | null>(null);

export const NoteSurfaceProvider = NoteSurfaceContext.Provider;

/**
 * Set by the Notes page around its editor panes: full-page NoteEditors inside
 * it render the "document" layout with this breadcrumb (the folder path).
 */
export const NoteDocumentContext = createContext<{
  breadcrumb: (noteId: string, bubbleId: string | null) => React.ReactNode;
} | null>(null);

/**
 * Report this editor's surface while mounted. Outline and word count are read
 * from the editor on each (idle-throttled) update.
 */
export function useReportNoteSurface({
  noteId,
  title,
  status,
  editorRef,
}: {
  noteId: string;
  title: string;
  status: SaveStatus;
  editorRef: React.MutableRefObject<LexicalEditor | null>;
}) {
  const report = useContext(NoteSurfaceContext);
  const derived = useRef<{ words: number; outline: OutlineItem[] }>({
    words: 0,
    outline: [],
  });
  const latest = useRef({ title, status });
  latest.current = { title, status };

  const push = useRef<() => void>(() => {});
  push.current = () =>
    report?.(
      {
        noteId,
        title: latest.current.title,
        status: latest.current.status,
        words: derived.current.words,
        outline: derived.current.outline,
        editor: editorRef.current,
      },
      noteId,
    );

  // `status` is a fresh object every render; key the report on its content
  // or a re-render of the page would re-report forever.
  useEffect(() => {
    push.current();
  }, [title, status.state, status.retrying, status.failure]);

  useEffect(() => {
    if (!report) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unregister: (() => void) | null = null;
    let tries = 0;
    const read = (editor: LexicalEditor) => {
      editor.getEditorState().read(() => {
        const outline: OutlineItem[] = [];
        for (const node of $getRoot().getChildren()) {
          if ($isHeadingNode(node)) {
            const text = node.getTextContent().trim();
            if (text)
              outline.push({
                key: node.getKey(),
                text,
                level: Number(node.getTag().slice(1)) || 1,
              });
          }
        }
        const text = $getRoot().getTextContent();
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        derived.current = { words, outline };
      });
      push.current();
    };
    // The editor instance arrives via editorRef after Lexical mounts; poll a
    // few frames rather than threading a callback through the editor.
    const attach = () => {
      const editor = editorRef.current;
      if (!editor) {
        if (tries++ < 40) timer = setTimeout(attach, 50);
        return;
      }
      read(editor);
      unregister = editor.registerUpdateListener(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => read(editor), 250);
      });
    };
    attach();
    return () => {
      if (timer) clearTimeout(timer);
      unregister?.();
      report(null, noteId);
    };
  }, [report, noteId, editorRef]);
}

/** Scroll an editor's heading into view and put the caret at its start. */
export function revealHeading(editor: LexicalEditor, key: string) {
  const el = editor.getElementByKey(key);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

"use client";

import { useEffect, useRef } from "react";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { TRANSFORMERS } from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { $getRoot, type EditorState } from "lexical";
import type { Note } from "@/lib/types";
import ToolbarPlugin from "./ToolbarPlugin";

const editorTheme = {
  paragraph: "mb-2",
  quote: "mb-2 border-l-4 border-zinc-300 pl-4 italic text-zinc-600 dark:border-zinc-600 dark:text-zinc-400",
  heading: {
    h1: "mb-3 mt-4 text-3xl font-bold",
    h2: "mb-2 mt-3 text-2xl font-semibold",
    h3: "mb-2 mt-2 text-xl font-semibold",
  },
  list: {
    ul: "mb-2 list-disc pl-6",
    ol: "mb-2 list-decimal pl-6",
    listitem: "mb-1",
    nested: { listitem: "list-none" },
  },
  link: "text-sky-600 underline dark:text-sky-400",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "rounded bg-zinc-100 px-1 py-0.5 font-mono text-sm dark:bg-zinc-800",
  },
  code: "mb-2 block rounded bg-zinc-100 p-3 font-mono text-sm dark:bg-zinc-800",
};

const SAVE_DEBOUNCE_MS = 400;

export default function NoteEditor({
  note,
  onSave,
}: {
  note: Note;
  onSave: (content: string, textContent: string) => void;
}) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush any pending save when unmounting or switching notes.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [note.id]);

  const initialConfig: InitialConfigType = {
    namespace: "notarium",
    theme: editorTheme,
    editorState: note.content || undefined,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode, AutoLinkNode],
    onError(error: Error) {
      console.error(error);
    },
  };

  const handleChange = (editorState: EditorState) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const content = JSON.stringify(editorState.toJSON());
      const textContent = editorState.read(() => $getRoot().getTextContent());
      onSave(content, textContent);
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    // Remount the composer whenever the active note changes so the editor
    // state is rebuilt from that note's stored content.
    <LexicalComposer key={note.id} initialConfig={initialConfig}>
      <div className="flex h-full flex-col">
        <ToolbarPlugin />
        <div className="relative flex-1 overflow-y-auto">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="min-h-full px-6 py-4 outline-none" />
            }
            placeholder={
              <div className="pointer-events-none absolute left-6 top-4 text-zinc-400">
                Dump your brain here…
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      </div>
    </LexicalComposer>
  );
}

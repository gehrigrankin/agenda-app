"use client";

import { CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import {
  LexicalComposer,
  type InitialConfigType,
} from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import type { EditorState } from "lexical";

import { ToolbarPlugin } from "./plugins/ToolbarPlugin";
import { editorTheme } from "./theme";

/**
 * Foundation Lexical editor.
 *
 * Ships the essential rich-text base: headings, paragraphs, quotes, bulleted /
 * numbered / check lists, code blocks, and links — with undo/redo. The
 * remaining MVP nodes (task nodes backed by the `tasks` table, note-links, and
 * images) plug in here as dedicated nodes + plugins. Autosave wires onto
 * `onChange` (debounced) when Note CRUD lands.
 */
const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  LinkNode,
  AutoLinkNode,
];

export interface EditorProps {
  /** Serialized Lexical state JSON (string) to hydrate from, if any. */
  initialStateJSON?: string | null;
  onChange?: (state: EditorState) => void;
}

export function Editor({ initialStateJSON, onChange }: EditorProps) {
  const initialConfig: InitialConfigType = {
    namespace: "agenda-editor",
    theme: editorTheme,
    nodes: EDITOR_NODES,
    editorState: initialStateJSON ?? undefined,
    onError(error: Error) {
      // Surface editor errors loudly in dev; swap for telemetry later.
      console.error("[lexical]", error);
      throw error;
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="flex min-h-0 flex-1 flex-col">
        <ToolbarPlugin />
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="mx-auto min-h-full max-w-3xl px-6 py-6 outline-none"
                aria-placeholder="Start writing…"
                placeholder={
                  <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 px-6 text-neutral-400">
                    Start writing…
                  </div>
                }
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </div>

      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <LinkPlugin />
      <TabIndentationPlugin />
      {onChange ? (
        <OnChangePlugin onChange={onChange} ignoreSelectionChange />
      ) : null}
    </LexicalComposer>
  );
}

"use client";

import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TRANSFORMERS } from "@lexical/markdown";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import {
  LexicalComposer,
  type InitialConfigType,
} from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import type { EditorState } from "lexical";

import { ImageNode } from "./nodes/ImageNode";
import { NoteLinkNode } from "./nodes/NoteLinkNode";
import { TaskNode } from "./nodes/TaskNode";
import { CodeHighlightPlugin } from "./plugins/CodeHighlightPlugin";
import { FloatingToolbarPlugin } from "./plugins/FloatingToolbarPlugin";
import { ImagePlugin } from "./plugins/ImagePlugin";
import { NoteLinkPlugin } from "./plugins/NoteLinkPlugin";
import { SlashCommandsPlugin } from "./plugins/SlashCommandsPlugin";
import { ToolbarPlugin } from "./plugins/ToolbarPlugin";
import { editorTheme } from "./theme";

/**
 * Lexical editor — "writing feel" build.
 *
 * Rich-text base (headings, paragraphs, quotes, lists, checklists, code, links)
 * plus the experience layer: live markdown shortcuts, a `/` slash command menu,
 * and a floating selection toolbar. Custom nodes: task nodes (backed by the
 * `tasks` table), inline `[[note-link]]` chips, and uploaded images.
 */
const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  HorizontalRuleNode,
  TaskNode,
  NoteLinkNode,
  ImageNode,
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
    // Function form so a malformed/legacy serialized state degrades to an
    // empty editor instead of crashing the whole route. The bad content is
    // only overwritten once the user actually edits (NoteEditor skips
    // no-change saves).
    editorState: initialStateJSON
      ? (editor) => {
          try {
            editor.setEditorState(editor.parseEditorState(initialStateJSON));
          } catch (error) {
            console.error("[lexical] failed to hydrate editor state:", error);
          }
        }
      : undefined,
    onError(error: Error) {
      // Log instead of rethrowing so one bad node doesn't take down the page.
      console.error("[lexical]", error);
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
                className="editor-content mx-auto min-h-full max-w-3xl px-6 py-8 text-[15px] leading-7 outline-none"
                aria-placeholder="Write, or press “/” for commands…"
                placeholder={
                  <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 px-6 text-neutral-400">
                    Write, or press “/” for commands…
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
      <CodeHighlightPlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <SlashCommandsPlugin />
      <NoteLinkPlugin />
      <ImagePlugin />
      <FloatingToolbarPlugin />
      {onChange ? (
        <OnChangePlugin onChange={onChange} ignoreSelectionChange />
      ) : null}
    </LexicalComposer>
  );
}

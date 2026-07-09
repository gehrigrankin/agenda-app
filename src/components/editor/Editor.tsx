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
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { ParagraphNode, type EditorState, type LexicalEditor } from "lexical";

import { DailyEditorContext } from "./DailyEditorContext";
import { CollapsibleHeadingNode } from "./nodes/CollapsibleHeadingNode";
import { CollapsibleListItemNode } from "./nodes/CollapsibleListItemNode";
import { ImageNode } from "./nodes/ImageNode";
import { LinkedNoteCardNode } from "./nodes/LinkedNoteCardNode";
import { NoteLinkNode } from "./nodes/NoteLinkNode";
import { TaskNode } from "./nodes/TaskNode";
import { TimedParagraphNode } from "./nodes/TimedParagraphNode";
import { BulletMenuPlugin } from "./plugins/BulletMenuPlugin";
import { CodeHighlightPlugin } from "./plugins/CodeHighlightPlugin";
import { CollapsePlugin } from "./plugins/CollapsePlugin";
import { CrossOffPlugin } from "./plugins/CrossOffPlugin";
import { FloatingToolbarPlugin } from "./plugins/FloatingToolbarPlugin";
import { ImagePlugin } from "./plugins/ImagePlugin";
import { MobileToolbarPlugin } from "./plugins/MobileToolbarPlugin";
import { NoteLinkPlugin } from "./plugins/NoteLinkPlugin";
import { RecallPlugin } from "./plugins/RecallPlugin";
import { NoteLinkTitleSyncPlugin } from "./plugins/NoteLinkTitleSyncPlugin";
import { SlashCommandsPlugin } from "./plugins/SlashCommandsPlugin";
import {
  AT_TASK_TRANSFORMER,
  TASK_TRANSFORMER,
  TaskShortcutsPlugin,
} from "./plugins/TaskShortcutsPlugin";
import { TimestampPlugin } from "./plugins/TimestampPlugin";
import { TrailingBlockPlugin } from "./plugins/TrailingBlockPlugin";
import { ToolbarPlugin } from "./plugins/ToolbarPlugin";
import { editorTheme } from "./theme";

/**
 * Lexical editor — "writing feel" build.
 *
 * Rich-text base (headings, paragraphs, quotes, lists, checklists, code, links)
 * plus the experience layer: live markdown shortcuts, a `/` slash command menu,
 * and a floating selection toolbar. Custom nodes: task nodes (backed by the
 * `tasks` table), inline `[[note-link]]` chips, uploaded images, and timed
 * paragraphs (the daily note's timeline blocks).
 *
 * `variant="daily"` turns the editor into the daily-note surface: paragraphs
 * are node-replaced with TimedParagraphNode at creation (scoped to THIS
 * composer only — each Editor instance gets its own nodes array), the
 * TimestampPlugin stamps/clusters them, and NoteLinkPlugin switches `[[` to
 * block-level linked-note cards.
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
  // Registered everywhere so any surface can RENDER timed blocks and linked
  // cards; only the daily variant CREATES them.
  TimedParagraphNode,
  LinkedNoteCardNode,
  // Collapsible variants replace the stock heading/list-item in EVERY surface
  // (unlike the daily-only paragraph swap): $createHeadingNode /
  // $createListItemNode — markdown shortcuts, slash menu, toolbar, ListPlugin
  // — all route through the replacement, and old docs upgrade on load.
  CollapsibleHeadingNode,
  CollapsibleListItemNode,
  {
    replace: HeadingNode,
    with: (node: HeadingNode) => new CollapsibleHeadingNode(node.getTag()),
    withKlass: CollapsibleHeadingNode,
  },
  {
    replace: ListItemNode,
    // __checked, not getChecked(): the getter is parent-dependent and the
    // node here is unattached, so getChecked() is always undefined — pasted
    // checklist HTML would import with every box cleared.
    with: (node: ListItemNode) =>
      new CollapsibleListItemNode(node.getValue(), node.__checked),
    withKlass: CollapsibleListItemNode,
  },
];

// "[] " → task block, "@name " at line start → assigned action item. (The
// stock set has no CHECK_LIST transformer, so these are the only bracket/at
// shortcuts; checklists come from the slash menu/toolbar.)
const EDITOR_TRANSFORMERS = [TASK_TRANSFORMER, AT_TASK_TRANSFORMER, ...TRANSFORMERS];

const DAILY_NODES = [
  ...EDITOR_NODES,
  {
    replace: ParagraphNode,
    with: () => new TimedParagraphNode(),
    withKlass: TimedParagraphNode,
  },
];

export interface EditorProps {
  /** Serialized Lexical state JSON (string) to hydrate from, if any. */
  initialStateJSON?: string | null;
  onChange?: (state: EditorState) => void;
  /** "daily" = the daily-note timeline surface (timed blocks, linked cards). */
  variant?: "default" | "daily";
  /** Overrides the content column's classes (the daily widget's 770px column). */
  contentClassName?: string;
  /** Receives the LexicalEditor instance (for appending nodes from outside). */
  editorRef?: React.MutableRefObject<LexicalEditor | null>;
  /** Daily split view: linked-note cards collapse to chips in the doc. */
  splitLinks?: boolean;
  /** Hide the block toolbar (compact embeds like in-card editing). */
  hideToolbar?: boolean;
  /**
   * Dock the phone-only formatting bar (md:hidden) at the bottom of the
   * editor pane. Only the full-page note view opts in — dock windows and
   * quick-view overlays must not render it.
   */
  mobileToolbar?: boolean;
}

const DEFAULT_CONTENT_CLASS =
  "editor-content mx-auto min-h-full max-w-3xl px-6 py-8 text-[0.9375rem] leading-7 outline-none 2xl:max-w-[54rem]";

export function Editor({
  initialStateJSON,
  onChange,
  variant = "default",
  contentClassName,
  editorRef,
  splitLinks = false,
  hideToolbar = false,
  mobileToolbar = false,
}: EditorProps) {
  const isDaily = variant === "daily";
  const contentClass = contentClassName ?? DEFAULT_CONTENT_CLASS;
  const placeholderText = isDaily
    ? "Write your day — every block keeps its time…"
    : "Write, or press “/” for commands…";

  const initialConfig: InitialConfigType = {
    namespace: "agenda-editor",
    theme: editorTheme,
    nodes: isDaily ? DAILY_NODES : EDITOR_NODES,
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
    <DailyEditorContext.Provider value={{ isDaily, splitLinks }}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className="flex min-h-0 flex-1 flex-col">
          {!isDaily && !hideToolbar && <ToolbarPlugin />}
          {/* editor-collapse-host: CollapsePlugin portals its gutter chevrons
              into this (position: relative) scroll container. */}
          <div className="editor-collapse-host relative min-h-0 flex-1 overflow-y-auto">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className={contentClass}
                  aria-placeholder={placeholderText}
                  placeholder={
                    <div
                      className={
                        isDaily
                          ? // Mirror the content column so the hint sits on the
                            // first line of the (empty) timeline.
                            `pointer-events-none absolute inset-x-0 top-0 text-ink-600 ${contentClass.replace("editor-content", "")}`
                          : "pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 px-6 text-neutral-400"
                      }
                    >
                      {placeholderText}
                    </div>
                  }
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
          {/* Last in the flex column so the on-screen keyboard (which resizes
              the visual viewport) pushes the bar up above it on phones. */}
          {mobileToolbar && <MobileToolbarPlugin />}
        </div>

        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <TabIndentationPlugin />
        <CodeHighlightPlugin />
        <MarkdownShortcutPlugin transformers={EDITOR_TRANSFORMERS} />
        <SlashCommandsPlugin />
        <TaskShortcutsPlugin />
        <CrossOffPlugin />
        <BulletMenuPlugin />
        <NoteLinkPlugin />
        <NoteLinkTitleSyncPlugin />
        <ImagePlugin />
        <TrailingBlockPlugin />
        <CollapsePlugin />
        <FloatingToolbarPlugin />
        {isDaily && <TimestampPlugin />}
        {isDaily && <RecallPlugin />}
        {editorRef ? <EditorRefPlugin editorRef={editorRef} /> : null}
        {onChange ? (
          <OnChangePlugin onChange={onChange} ignoreSelectionChange />
        ) : null}
      </LexicalComposer>
    </DailyEditorContext.Provider>
  );
}

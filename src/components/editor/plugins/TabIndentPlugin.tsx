"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";

import { tabIntent } from "@/lib/editor-tab";

/**
 * Tab indents the whole row; it never inserts a tab character.
 *
 * Replaces @lexical/react's TabIndentationPlugin, whose `$indentOverTab` only
 * indents when the caret is at offset 0 of the block and drops a literal
 * TabNode anywhere else — tab spacing in the middle of a row, which nothing
 * here wants. INSERT_TAB_COMMAND is deliberately never dispatched.
 *
 * COMMAND_PRIORITY_EDITOR is load-bearing: the typeahead menus (`/`, `[[`) and
 * @lexical/code's code-block handler both register KEY_TAB_COMMAND at
 * COMMAND_PRIORITY_LOW, so they still run first. Tab keeps picking a menu item
 * and keeps inserting a real tab inside a code block — this plugin must not
 * special-case either.
 */
export function TabIndentPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event: KeyboardEvent) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          // Chip inputs (task title, dates) own their keystrokes.
          const target = event.target;
          const intent = tabIntent({
            shiftKey: event.shiftKey,
            inDecoratorInput:
              target instanceof HTMLInputElement ||
              target instanceof HTMLTextAreaElement,
            hasRangeSelection: !selection.isCollapsed(),
          });
          if (intent === "ignore") return false;
          // Swallow the key even when nothing moved (already at depth 0 on
          // Shift+Tab): returning false lets the browser walk focus out of the
          // editor, which is what Tab does by default.
          event.preventDefault();
          editor.dispatchCommand(
            intent === "outdent"
              ? OUTDENT_CONTENT_COMMAND
              : INDENT_CONTENT_COMMAND,
            undefined,
          );
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  );

  return null;
}

"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
} from "lexical";

import { activateInkOnMount } from "../nodes/InkBlock";
import { $createInkNode, InkNode } from "../nodes/InkNode";

/**
 * Inserts an ink block at the caret's top-level position (slash menu "Ink
 * block", the toolbar pen) and opens its tool palette. Entry points check the
 * Labs flag; the command itself doesn't, so a block can always be created
 * programmatically.
 */
export const INSERT_INK_COMMAND: LexicalCommand<void> =
  createCommand("INSERT_INK_COMMAND");

export function InkPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!editor.hasNodes([InkNode])) return;
    return editor.registerCommand(
      INSERT_INK_COMMAND,
      () => {
        const node = $createInkNode();
        $insertNodeToNearestRoot(node);
        activateInkOnMount(node.getKey());
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);
  return null;
}

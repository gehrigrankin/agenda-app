"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $isDecoratorNode, RootNode } from "lexical";

/**
 * Keeps the document endable: when the last block is a decorator (linked-note
 * card, image, horizontal rule) the caret has nowhere to go, so writing below
 * it is impossible. This transform appends an empty paragraph whenever a
 * decorator ends the doc. (In the daily variant the paragraph auto-becomes a
 * TimedParagraphNode via node replacement.)
 */
export function TrailingBlockPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerNodeTransform(RootNode, (root) => {
      const last = root.getLastChild();
      if (last && $isDecoratorNode(last)) {
        root.append($createParagraphNode());
      }
    });
  }, [editor]);

  return null;
}

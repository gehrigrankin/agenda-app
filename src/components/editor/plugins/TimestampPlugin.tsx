"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { mergeRegister } from "@lexical/utils";

import {
  $isTimedParagraphNode,
  formatTimeLabel,
  TimedParagraphNode,
} from "../nodes/TimedParagraphNode";

/**
 * Daily-editor timeline behavior (mounted only for variant="daily", where the
 * paragraph node is replaced by TimedParagraphNode at creation):
 *
 * 1. STAMPING — a block's timestamp is set the moment it first has content,
 *    not when the block was created, so an empty line opened at 8:50 and typed
 *    into at 9:04 says 9:04. Timestamps never change after that.
 *
 * 2. CLUSTER DISPLAY — every stamped block carries `data-time`, but the gutter
 *    label only SHOWS on the first block of each minute cluster. That's a
 *    derived, presentation-only fact, so it's toggled straight on the DOM
 *    (`data-time-visible`) from an update listener and never serialized.
 */
export function TimestampPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const applyClusterVisibility = () => {
      editor.getEditorState().read(() => {
        let prevLabel: string | null = null;
        for (const child of $getRoot().getChildren()) {
          if (!$isTimedParagraphNode(child)) continue;
          const ts = child.getTimestamp();
          const label = ts ? formatTimeLabel(ts) : null;
          const el = editor.getElementByKey(child.getKey());
          if (el) {
            if (label && label !== prevLabel) el.dataset.timeVisible = "1";
            else delete el.dataset.timeVisible;
          }
          if (label) prevLabel = label;
        }
      });
    };

    // Initial pass for hydrated content (migrated jots arrive pre-stamped).
    applyClusterVisibility();

    return mergeRegister(
      editor.registerNodeTransform(TimedParagraphNode, (node) => {
        if (node.getTimestamp() === null && node.getTextContentSize() > 0) {
          node.setTimestamp(new Date().toISOString());
        }
      }),
      editor.registerUpdateListener(applyClusterVisibility),
    );
  }, [editor]);

  return null;
}

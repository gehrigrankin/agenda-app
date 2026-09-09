"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isDecoratorNode,
} from "lexical";

import type { AgendaLineResult } from "@/app/app/actions";
import {
  $createAgendaSectionNode,
  $isAgendaSectionNode,
} from "../nodes/AgendaSectionNode";

/**
 * Prints the agenda's pinned lines (Work, Gym, Errands) onto the daily note as
 * section headings — the day's page arrives ruled with its subjects, and the
 * user writes prose, bullets and tasks underneath them.
 *
 * Daily editor only, and only while editable. Three cases, decided from the
 * document that is already there, because the document is the user's:
 *  1. blank page (no sections, no content) → PRINT: clear it and lay down a
 *     section + an empty block per line, in the pinned order.
 *  2. already printed (any section present) → only APPEND sections for lines
 *     that have none yet, at the end. Nothing is removed or reordered, so
 *     unpinning a tag never deletes what was written under it.
 *  3. free-form writing with no sections → leave it alone entirely.
 * Existing sections also have their name/color refreshed from the lines.
 *
 * The update is tagged "history-merge" so printing the page is never its own
 * undo step, and it never touches the selection — the caret stays wherever the
 * user (or the surface) put it.
 */
export function AgendaSectionsPlugin({
  lines,
}: {
  lines: AgendaLineResult[];
}): null {
  const [editor] = useLexicalComposerContext();

  // The identity of the ORDERED lines, not of the array: the parent re-creates
  // `lines` on every render, and re-running the pass on each of those would
  // fight the user's typing. The ref remembers which version of that identity
  // has already been applied to THIS editor (a new day remounts the plugin, so
  // the guard resets with it).
  const linesKey = useMemo(
    () => lines.map((l) => `${l.id}:${l.name}:${l.color ?? ""}`).join("|"),
    [lines],
  );
  const appliedKey = useRef<string | null>(null);

  useEffect(() => {
    // Nothing pinned: the page has no subjects, so it stays a blank page.
    if (lines.length === 0) return;
    // Read-only surfaces (past days, the book view's facing page) render the
    // document as a record — never write into one.
    if (!editor.isEditable()) return;
    if (appliedKey.current === linesKey) return;
    appliedKey.current = linesKey;

    editor.update(
      () => {
        const root = $getRoot();
        const children = root.getChildren();
        const sections = children.filter($isAgendaSectionNode);
        // A printed label is structure, not content — a page holding only
        // sections is still blank as far as the user is concerned. Task nodes
        // are decorators today, but both are checked so a non-decorator task
        // would still count.
        const hasContent = children.some(
          (child) =>
            !$isAgendaSectionNode(child) &&
            ($isDecoratorNode(child) ||
              child.getType() === "task" ||
              child.getTextContent().trim().length > 0),
        );

        // A section heading plus the block you write in under it. The empty
        // paragraph becomes a TimedParagraphNode through the daily composer's
        // node replacement (that is why it isn't imported here) — it gets its
        // timestamp when content lands in it, not now.
        const print = (line: AgendaLineResult) => {
          const section = $createAgendaSectionNode(
            line.id,
            line.name,
            line.color,
          );
          section.append($createTextNode(line.name));
          root.append(section);
          root.append($createParagraphNode());
        };

        if (sections.length === 0) {
          // Case 3: free-form writing keeps the page it has.
          if (hasContent) return;
          // Case 1: print the whole page.
          root.clear();
          for (const line of lines) print(line);
          return;
        }

        // Case 2: an already-printed page. A newly pinned subject joins it at
        // the end; existing ones only have their label metadata refreshed.
        const byTagId = new Map(sections.map((s) => [s.getTagId(), s]));
        for (const line of lines) {
          const existing = byTagId.get(line.id);
          if (!existing) {
            print(line);
            continue;
          }
          if (existing.getName() !== line.name) existing.setName(line.name);
          if (existing.getColor() !== line.color) existing.setColor(line.color);
        }
      },
      { tag: "history-merge" },
    );
  }, [editor, lines, linesKey]);

  return null;
}

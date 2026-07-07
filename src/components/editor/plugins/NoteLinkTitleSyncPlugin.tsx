"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $nodesOfType, type NodeKey } from "lexical";

import { getNoteTitlesAction } from "@/app/app/actions";
import {
  $isLinkedNoteCardNode,
  LinkedNoteCardNode,
} from "../nodes/LinkedNoteCardNode";
import { $isNoteLinkNode, NoteLinkNode } from "../nodes/NoteLinkNode";

/**
 * Refreshes the CACHED title snapshots on [[note-link]] chips and linked-note
 * cards when an editor opens — the fix for "rename the target, chips go stale
 * everywhere" (ROADMAP "Note-link titles are snapshots").
 *
 * One pass per editor instance, on mount: collect every link node's
 * noteId + snapshot, batch-fetch the current titles (getNoteTitlesAction,
 * owner-scoped), and rewrite only the nodes whose snapshot differs. Notes
 * missing from the response (trashed/deleted/not owned) keep their snapshot —
 * a dead link showing its last-known title beats one showing nothing. The
 * update is tagged "history-merge" so the refresh never becomes an undo step,
 * and the normal autosave persists the corrected titles (the refresh lands
 * after the autosave hook's baseline, so it registers as a real change).
 * Every composer in the app is editable (Editor never sets `editable`), so
 * there's no read-only surface to guard against.
 */
export function NoteLinkTitleSyncPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Guards the async gap: if the editor unmounts before the fetch resolves,
    // skip the update instead of writing into a torn-down composer.
    let cancelled = false;

    // Read pass: every link node's key + target + cached title.
    const found: { key: NodeKey; noteId: string; title: string }[] = [];
    editor.getEditorState().read(() => {
      for (const node of [
        ...$nodesOfType(NoteLinkNode),
        ...$nodesOfType(LinkedNoteCardNode),
      ]) {
        if (node.__noteId) {
          found.push({
            key: node.getKey(),
            noteId: node.__noteId,
            title: node.__title,
          });
        }
      }
    });
    if (found.length === 0) return;

    getNoteTitlesAction([...new Set(found.map((f) => f.noteId))])
      .then((rows) => {
        if (cancelled) return;
        const titles = new Map(rows.map((r) => [r.id, r.title]));
        const stale = found.filter((f) => {
          const fresh = titles.get(f.noteId);
          return fresh !== undefined && fresh !== f.title;
        });
        if (stale.length === 0) return;
        editor.update(
          () => {
            for (const { key, noteId } of stale) {
              const node = $getNodeByKey(key);
              // Re-verify by key: the node may have been deleted (or even
              // replaced) while the fetch was in flight.
              if (
                ($isNoteLinkNode(node) || $isLinkedNoteCardNode(node)) &&
                node.__noteId === noteId
              ) {
                node.setTitle(titles.get(noteId)!);
              }
            }
          },
          { tag: "history-merge" },
        );
      })
      .catch((err) => {
        // Non-fatal: the snapshots just stay stale until the next open.
        console.error("[note-links] title refresh failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [editor]);

  return null;
}

"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestNodeFromDOMNode, $getRoot } from "lexical";

import { linkTaskToNoteAction } from "@/app/app/actions";
import {
  $createTaskNode,
  NoteTaskContext,
  TASK_DRAG_TYPE,
  type TaskDragPayload,
} from "../nodes/TaskNode";

/**
 * Dropping a task chip into this editor — from another note's window, or from
 * somewhere else in this one.
 *
 * The gesture is a MOVE of the block: this side inserts a chip where the
 * pointer is, and the drag source removes its own copy once the browser
 * reports the drop was accepted (see TaskNode's dragend). Both editors then
 * autosave as usual and reconciliation redraws `note_tasks` from the two
 * documents — with one exception, which is why this calls
 * `linkTaskToNoteAction` immediately: the source note might save before the
 * target does, and a task with zero links for even a moment is a task
 * reconciliation deletes. Writing the destination link first closes that
 * window.
 *
 * Only the private TASK_DRAG_TYPE is claimed. Text dragged in from anywhere
 * else still lands as text, in Lexical's own hands.
 */

/** Where the chip will land, in the scroll container's content coordinates. */
type DropLine = { top: number; left: number; width: number };

export function TaskDropPlugin() {
  const [editor] = useLexicalComposerContext();
  const noteCtx = useContext(NoteTaskContext);
  const noteId = noteCtx?.noteId ?? null;
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [line, setLine] = useState<DropLine | null>(null);
  // The block the chip goes after, resolved on dragover and reused on drop so
  // both agree even if the pointer moved a pixel in between.
  const afterKeyRef = useRef<string | null>(null);

  useEffect(
    () =>
      editor.registerRootListener((rootEl) => {
        setPortalEl(rootEl?.parentElement ?? null);
      }),
    [editor],
  );

  /** The top-level block under the pointer, if any. */
  const blockAt = useCallback(
    (x: number, y: number): { key: string; el: HTMLElement } | null => {
      const target = document.elementFromPoint(x, y);
      if (!target) return null;
      const rootEl = editor.getRootElement();
      if (!rootEl || !rootEl.contains(target)) return null;
      // editor.read, not editorState.read: the DOM→node lookup needs an active
      // editor (keys live on DOM props namespaced by the editor).
      const key = editor.read(() => {
        const node = $getNearestNodeFromDOMNode(target);
        return node?.getTopLevelElement()?.getKey() ?? null;
      });
      if (!key) return null;
      const el = editor.getElementByKey(key);
      return el ? { key, el } : null;
    },
    [editor],
  );

  useEffect(() => {
    const rootEl = editor.getRootElement();
    const container = portalEl;
    if (!rootEl || !container) return;

    const carriesTask = (e: DragEvent) =>
      e.dataTransfer?.types.includes(TASK_DRAG_TYPE) === true;

    const onDragOver = (e: DragEvent) => {
      if (!carriesTask(e)) return;
      // Claim the drop: without preventDefault the browser refuses it and the
      // source never learns it was accepted (dropEffect stays "none").
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      const hit = blockAt(e.clientX, e.clientY);
      afterKeyRef.current = hit?.key ?? null;

      const containerRect = container.getBoundingClientRect();
      const rect = (hit?.el ?? rootEl).getBoundingClientRect();
      setLine({
        top: rect.bottom - containerRect.top + container.scrollTop,
        left: rect.left - containerRect.left + container.scrollLeft,
        width: rect.width,
      });
    };

    const clear = () => {
      afterKeyRef.current = null;
      setLine(null);
    };

    const onDragLeave = (e: DragEvent) => {
      // Only when the pointer actually left the editor, not on the constant
      // leave/enter churn between the blocks inside it.
      if (e.relatedTarget instanceof Node && rootEl.contains(e.relatedTarget)) {
        return;
      }
      clear();
    };

    const onDrop = (e: DragEvent) => {
      if (!carriesTask(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const raw = e.dataTransfer?.getData(TASK_DRAG_TYPE);
      const afterKey = afterKeyRef.current;
      clear();
      if (!raw) return;

      let payload: TaskDragPayload;
      try {
        payload = JSON.parse(raw) as TaskDragPayload;
      } catch (err) {
        console.error("[tasks] unreadable drag payload:", err);
        return;
      }
      if (typeof payload?.taskId !== "string" || !payload.taskId) return;

      editor.update(() => {
        const node = $createTaskNode({
          taskId: payload.taskId,
          title: typeof payload.title === "string" ? payload.title : "",
          completed: payload.completed === true,
          dueAt: typeof payload.dueAt === "string" ? payload.dueAt : null,
          important: payload.important === true,
          indent: typeof payload.indent === "number" ? payload.indent : 0,
        });
        const root = $getRoot();
        const after = afterKey
          ? root.getChildren().find((child) => child.getKey() === afterKey)
          : undefined;
        if (after) after.insertAfter(node);
        else root.append(node);
      });

      // Ahead of any autosave — see the header comment.
      if (noteId) {
        linkTaskToNoteAction(noteId, payload.taskId).catch((err) => {
          console.error("[tasks] link on drop failed:", err);
        });
      }
    };

    rootEl.addEventListener("dragover", onDragOver);
    rootEl.addEventListener("dragleave", onDragLeave);
    rootEl.addEventListener("drop", onDrop);
    return () => {
      rootEl.removeEventListener("dragover", onDragOver);
      rootEl.removeEventListener("dragleave", onDragLeave);
      rootEl.removeEventListener("drop", onDrop);
    };
  }, [editor, portalEl, blockAt, noteId]);

  // Belt and braces: a drag that ends anywhere (including outside this editor)
  // clears the indicator, which a missed dragleave would otherwise strand.
  useEffect(() => {
    const onEnd = () => setLine(null);
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
  }, []);

  if (!portalEl || !line) return null;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 h-0.5 rounded-full bg-sage/80"
      style={{ top: line.top, left: line.left, width: line.width }}
    />,
    portalEl,
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  CircleDashed,
  FileText,
  Layers,
  SquareCheck,
} from "lucide-react";

import { createStandaloneTaskAction } from "@/app/app/actions";
import {
  createBoardAction,
  createBubbleNoteAction,
  createSubfolderAction,
} from "@/app/app/bubbles/actions";
import { useNoteDock } from "@/components/notes/NoteDockProvider";
import { QuickNoteComposer } from "@/components/notes/QuickNoteComposer";
import { QuickEventComposer } from "./QuickEventComposer";
import { localDateString } from "@/lib/dates";
import { useOutsideClose } from "@/lib/hooks/use-outside-close";

/**
 * The app's one create menu. It started as the rail's + dropdown; boards and
 * bubble headers had their own single-purpose "new folder" / "add sub-bubble"
 * buttons, so what you could create depended on which + you happened to press.
 * This is that menu, extracted: every surface offers the same set, and each
 * one keeps its old single-purpose action as an ITEM rather than losing it.
 *
 * Nothing here navigates. A note opens as a floating dock tab, a task and an
 * event are written in place — the point of a create menu on a canvas or a
 * board page is that you don't leave the thing you were looking at. Creating a
 * folder is the exception: a new folder is empty, so it opens.
 *
 * The trigger is a render prop because the three call sites look nothing alike
 * (a rail tile, a dashed full-width card, a 9-square icon button); the menu
 * owns only the panel, the open state, and the container ref the outside-close
 * listener needs.
 */

export type CreateMenuKind = "note" | "task" | "event" | "board" | "sub-bubble";

const DEFAULT_ITEMS: CreateMenuKind[] = ["note", "task", "event", "board"];

/** Fired after a task is created outside the widgets, so they can refetch. */
export const TASKS_CHANGED_EVENT = "agenda:tasks-changed";

export function CreateMenu({
  items = DEFAULT_ITEMS,
  bubbleId = null,
  placement = "right",
  onCreateSubBubble,
  onBoardCreated,
  trigger,
}: {
  /** Which rows to offer, in order. */
  items?: CreateMenuKind[];
  /**
   * Target folder. A new note lands inside it instead of the loose notes
   * list, and "New folder" nests a subfolder under it. Pass null (the
   * default) for the global surfaces. Never pass an optimistic id — the
   * bubble doesn't exist on the server yet.
   */
  bubbleId?: string | null;
  placement?: "right" | "below-left" | "below-right";
  /**
   * Handles the "sub-bubble" item. Required for it to render: plain bubbles
   * are created optimistically against the caller's own tree state, so the
   * menu can't do it alone.
   */
  onCreateSubBubble?: (title: string) => void;
  /** Overrides the default "open the new folder" navigation. */
  onBoardCreated?: (id: string) => void;
  trigger: (state: {
    open: boolean;
    busy: boolean;
    toggle: () => void;
  }) => React.ReactNode;
}) {
  const router = useRouter();
  const dock = useNoteDock();
  const [open, setOpen] = useState(false);
  // null = the plain row list; "note"/"event" = a mini composer; anything
  // else = an inline title prompt for that kind.
  const [prompt, setPrompt] = useState<CreateMenuKind | null>(null);
  const [draft, setDraft] = useState("");
  const [isCreating, startCreate] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Set by a composer while it holds typed text — see useOutsideClose below.
  const composerDirtyRef = useRef(false);

  // A note prompt is inline (title only) when it targets a folder: the rich
  // composer writes through `quickCreateNoteAction`, which files a note
  // nowhere, and duplicating it to carry a bubble id would fork the editor.
  const noteIsInline = bubbleId !== null;
  const isComposer =
    (prompt === "note" && !noteIsInline) || prompt === "event";

  const close = () => {
    setOpen(false);
    setPrompt(null);
    setDraft("");
    composerDirtyRef.current = false;
  };

  useOutsideClose(open, containerRef, (via) => {
    // A stray outside click must not nuke a composer with typed text; the
    // composer's X button and Escape still discard it explicitly.
    if (via === "pointer" && isComposer && composerDirtyRef.current) return;
    close();
  });

  useEffect(() => {
    if (prompt !== null && !isComposer) inputRef.current?.focus();
  }, [prompt, isComposer]);

  const submitPrompt = () => {
    if (isCreating || prompt === null || isComposer) return;
    const title = draft.trim();
    if (!title) return;
    const kind = prompt;
    startCreate(async () => {
      try {
        if (kind === "task") {
          await createStandaloneTaskAction(title, localDateString());
          window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
        } else if (kind === "sub-bubble") {
          onCreateSubBubble?.(title);
        } else if (kind === "note") {
          // Only reachable with a target folder (see noteIsInline).
          const id = await createBubbleNoteAction(bubbleId!, title);
          dock?.open(id, title);
        } else {
          const id = bubbleId
            ? await createSubfolderAction(bubbleId, title)
            : await createBoardAction(title);
          if (onBoardCreated) onBoardCreated(id);
          else router.push(`/app/bubbles?b=${id}`);
        }
        close();
      } catch (err) {
        console.error("[create] failed:", err);
        // Leave the prompt open with the draft intact so the user can retry;
        // isCreating already flips back to false once the transition ends.
      }
    });
  };

  const rows = items.filter((k) => k !== "sub-bubble" || onCreateSubBubble);

  const ITEM =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.78125rem] text-ink-200 hover:bg-white/6";

  return (
    <div ref={containerRef} className="relative">
      {trigger({
        open,
        busy: isCreating,
        toggle: () => (open ? close() : setOpen(true)),
      })}

      {open && (
        <div
          className={`animate-pop-in absolute z-50 rounded-xl border border-white/10 bg-panel shadow-2xl ${
            PLACEMENT[placement]
          } ${isComposer ? "w-[19rem] p-2" : "w-48 p-1.5"}`}
        >
          {prompt === null ? (
            rows.map((kind) => {
              const { icon: Icon, label } = describe(kind, bubbleId);
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={isCreating}
                  onClick={() => setPrompt(kind)}
                  className={ITEM}
                >
                  <Icon className="h-3.5 w-3.5 text-sage" />
                  {label}
                </button>
              );
            })
          ) : prompt === "note" && !noteIsInline ? (
            <QuickNoteComposer dirtyRef={composerDirtyRef} onClose={close} />
          ) : prompt === "event" ? (
            <QuickEventComposer dirtyRef={composerDirtyRef} onClose={close} />
          ) : (
            <div className="px-2 py-1.5">
              <p className="pb-1 text-[0.65625rem] font-medium uppercase tracking-wide text-ink-500">
                {prompt === "task"
                  ? "New task (due today)"
                  : describe(prompt, bubbleId).label}
              </p>
              <input
                ref={inputRef}
                value={draft}
                disabled={isCreating}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitPrompt();
                }}
                placeholder={PLACEHOLDER[prompt]}
                className="w-full border-b border-sage/50 bg-transparent px-0.5 py-1 text-[0.78125rem] text-ink-100 outline-none placeholder:text-ink-600 disabled:opacity-60"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PLACEMENT: Record<"right" | "below-left" | "below-right", string> = {
  right: "left-full top-0 ml-2",
  "below-left": "left-0 top-full mt-1.5",
  "below-right": "right-0 top-full mt-1.5",
};

const PLACEHOLDER: Record<CreateMenuKind, string> = {
  note: "Note title…",
  task: "Task title…",
  event: "",
  board: "Folder name…",
  "sub-bubble": "Bubble name…",
};

function describe(kind: CreateMenuKind, bubbleId: string | null) {
  switch (kind) {
    case "note":
      return { icon: FileText, label: "New note" };
    case "task":
      return { icon: SquareCheck, label: "New task" };
    case "event":
      return { icon: CalendarPlus, label: "New event" };
    case "board":
      return {
        icon: Layers,
        label: bubbleId ? "New subfolder" : "New folder",
      };
    case "sub-bubble":
      return { icon: CircleDashed, label: "New sub-bubble" };
  }
}

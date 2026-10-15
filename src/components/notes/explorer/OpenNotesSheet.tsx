"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { BottomSheet } from "@/components/layout/BottomSheet";

/**
 * "Open notes" — the phone's version of tabs (Notes Sidebars design §4i).
 * Cards for every open note across panes; tap to switch, × or swipe a card
 * left to close it.
 */
export interface OpenNoteCard {
  id: string;
  pane: number;
  title: string;
  path: string;
  preview: string;
  active: boolean;
}

export function OpenNotesSheet({
  cards,
  onOpen,
  onClose,
  onCloseAll,
  onNew,
  onDismiss,
}: {
  cards: OpenNoteCard[];
  onOpen: (card: OpenNoteCard) => void;
  onClose: (card: OpenNoteCard) => void;
  onCloseAll: () => void;
  onNew: () => void;
  onDismiss: () => void;
}) {
  return (
    <BottomSheet
      label="Open notes"
      onClose={onDismiss}
      header={
        <div className="flex items-center px-5 pt-1 pb-3">
          <h2 className="flex-1 text-[1.125rem] font-semibold text-ink-100">
            Open notes
          </h2>
          {cards.length > 0 && (
            <button
              type="button"
              onClick={onCloseAll}
              className="h-10 text-[0.9375rem] text-sage"
            >
              Close all
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-2.5 px-4 pb-2">
        {cards.length === 0 && (
          <p className="py-4 text-center text-[0.9375rem] text-ink-500">
            No open notes.
          </p>
        )}
        {cards.map((c) => (
          <SwipeCard key={c.id} card={c} onOpen={onOpen} onClose={onClose} />
        ))}
        <button
          type="button"
          onClick={onNew}
          className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-[0.9375rem] text-ink-300"
        >
          <Plus className="h-4 w-4" /> New note
        </button>
        <p className="pt-1 text-center text-[0.75rem] text-ink-600">
          Swipe a card left to close
        </p>
      </div>
    </BottomSheet>
  );
}

function SwipeCard({
  card,
  onOpen,
  onClose,
}: {
  card: OpenNoteCard;
  onOpen: (c: OpenNoteCard) => void;
  onClose: (c: OpenNoteCard) => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  return (
    <div
      className={`relative touch-pan-y rounded-xl border px-4 py-3 transition-transform ${
        card.active ? "border-sage/45 bg-sage/8" : "border-white/8 bg-white/4"
      }`}
      style={{
        transform: `translateX(${dx}px)`,
        opacity: 1 - Math.min(0.6, Math.abs(dx) / 300),
      }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY };
        swiping.current = false;
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const mx = e.clientX - s.x;
        if (
          !swiping.current &&
          Math.abs(mx) > 10 &&
          Math.abs(mx) > Math.abs(e.clientY - s.y)
        )
          swiping.current = true;
        if (swiping.current) setDx(Math.min(0, mx));
      }}
      onPointerUp={() => {
        start.current = null;
        if (dx < -110) onClose(card);
        else setDx(0);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDx(0);
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!swiping.current) onOpen(card);
        }}
        className="flex w-full flex-col gap-0.5 pr-8 text-left"
      >
        <span className="truncate text-[1rem] font-semibold text-ink-100">
          {card.title || "Untitled"}
        </span>
        {card.path && (
          <span className="truncate text-[0.8125rem] text-ink-500">
            {card.path}
          </span>
        )}
        <span className="truncate text-[0.875rem] text-ink-400">
          {card.preview || "Empty note"}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${card.title || "Untitled"}`}
        onClick={() => onClose(card)}
        className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-lg text-ink-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

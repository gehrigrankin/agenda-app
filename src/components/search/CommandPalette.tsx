"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CircleDashed,
  FileText,
  Loader2,
  Plus,
  Search,
} from "lucide-react";

import {
  createNoteAction,
  searchAction,
  type SearchBubbleResult,
  type SearchNoteResult,
} from "@/app/app/actions";

/**
 * Global search + command palette. Always mounted (inside AppShell) so the
 * ⌘K / Ctrl+K listener is registered app-wide; `open` only controls the
 * overlay. Searching hits the `searchAction` server action (debounced), and
 * a quick-create row turns the current query into a new note.
 */

type SearchResults = {
  notes: SearchNoteResult[];
  bubbles: SearchBubbleResult[];
};

type Row =
  | { kind: "note"; note: SearchNoteResult }
  | { kind: "bubble"; bubble: SearchBubbleResult }
  | { kind: "create" };

const DEBOUNCE_MS = 200;

/** Close the overlay on Escape (only while it's open). */
function useEscapeKey(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlerRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [isCreating, startCreate] = useTransition();

  // Monotonic request id so a slow response can't clobber a newer one.
  const requestIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Refs so the always-on ⌘K listener never needs re-registering.
  const openRef = useRef(open);
  openRef.current = open;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChangeRef.current(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEscapeKey(open, () => onOpenChange(false));

  // Fresh palette on every open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setSearching(false);
      setHighlight(0);
    }
  }, [open]);

  // Debounced search: wait for a pause in typing, then hit the server action.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchAction(q);
        if (requestIdRef.current !== requestId) return;
        setResults(res);
      } catch {
        if (requestIdRef.current !== requestId) return;
        setResults({ notes: [], bubbles: [] });
      }
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query]);

  const trimmed = query.trim();
  const notes = trimmed && results ? results.notes : [];
  const bubbles = trimmed && results ? results.bubbles : [];

  const rows: Row[] = [
    ...notes.map((note): Row => ({ kind: "note", note })),
    ...bubbles.map((bubble): Row => ({ kind: "bubble", bubble })),
    ...(trimmed ? [{ kind: "create" } as Row] : []),
  ];
  const activeIndex = rows.length
    ? Math.min(highlight, rows.length - 1)
    : -1;

  // Keep the keyboard-highlighted row visible while arrowing through.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, rows.length]);

  const close = () => onOpenChange(false);

  const activate = (row: Row) => {
    if (row.kind === "create") {
      const title = trimmed;
      if (!title || isCreating) return;
      startCreate(async () => {
        // The action redirects to the new note server-side.
        await createNoteAction(title);
        onOpenChangeRef.current(false);
      });
      return;
    }
    if (row.kind === "note") {
      router.push(
        row.note.bubbleId
          ? `/app/bubbles?b=${row.note.bubbleId}`
          : `/app/notes/${row.note.id}`,
      );
    } else {
      router.push(`/app/bubbles?b=${row.bubble.id}`);
    }
    close();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length) setHighlight((activeIndex + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) {
        setHighlight((activeIndex - 1 + rows.length) % rows.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) activate(rows[activeIndex]);
    }
  };

  if (!open) return null;

  const noteRowCount = notes.length;
  const noMatches =
    trimmed !== "" && !searching && results !== null &&
    notes.length === 0 && bubbles.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={close}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-white/10 dark:bg-panel">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 dark:border-white/7">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search notes and bubbles…"
            aria-label="Search notes and bubbles"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-neutral-400"
          />
          {searching && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" />
          )}
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {trimmed === "" ? (
            <p className="px-2.5 py-6 text-center text-sm text-neutral-400">
              Type to search notes and bubbles
            </p>
          ) : (
            <>
              {notes.length > 0 && <GroupLabel>Notes</GroupLabel>}
              {notes.map((note, i) => (
                <ResultRow
                  key={note.id}
                  active={activeIndex === i}
                  onHover={() => setHighlight(i)}
                  onSelect={() => activate({ kind: "note", note })}
                  icon={
                    note.dailyDate ? (
                      <CalendarDays className="h-4 w-4 shrink-0 text-neutral-400" />
                    ) : note.bubbleId ? (
                      <CircleDashed className="h-4 w-4 shrink-0 text-neutral-400" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                    )
                  }
                  label={note.title || "Untitled"}
                />
              ))}

              {bubbles.length > 0 && <GroupLabel>Bubbles</GroupLabel>}
              {bubbles.map((bubble, i) => {
                const index = noteRowCount + i;
                return (
                  <ResultRow
                    key={bubble.id}
                    active={activeIndex === index}
                    onHover={() => setHighlight(index)}
                    onSelect={() => activate({ kind: "bubble", bubble })}
                    icon={
                      bubble.emoji ? (
                        <span className="w-4 shrink-0 text-center text-sm leading-none">
                          {bubble.emoji}
                        </span>
                      ) : (
                        <CircleDashed className="h-4 w-4 shrink-0 text-neutral-400" />
                      )
                    }
                    label={bubble.title || "Untitled"}
                  />
                );
              })}

              {noMatches && (
                <p className="px-2.5 py-4 text-center text-sm text-neutral-400">
                  No matches
                </p>
              )}

              <ResultRow
                active={activeIndex === rows.length - 1}
                onHover={() => setHighlight(rows.length - 1)}
                onSelect={() => activate({ kind: "create" })}
                disabled={isCreating}
                icon={
                  isCreating ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-neutral-400" />
                  )
                }
                label={
                  isCreating ? (
                    "Creating…"
                  ) : (
                    <>
                      Create note{" "}
                      <span className="font-medium">“{trimmed}”</span>
                    </>
                  )
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
      {children}
    </div>
  );
}

function ResultRow({
  active,
  disabled,
  onHover,
  onSelect,
  icon,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onHover: () => void;
  onSelect: () => void;
  icon: React.ReactNode;
  label: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-active={active || undefined}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-neutral-700 disabled:opacity-60 dark:text-ink-200 ${
        active ? "bg-neutral-100 dark:bg-white/6" : ""
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

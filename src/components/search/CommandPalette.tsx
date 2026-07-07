"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CircleDashed,
  CornerDownRight,
  FileText,
  ListPlus,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";

import {
  createNoteAction,
  searchAction,
  type SearchBubbleResult,
  type SearchNoteResult,
} from "@/app/app/actions";
import {
  askNotesAction,
  saveAnswerAsNoteAction,
} from "@/app/app/ai/actions";
// Type-only import: erased at compile time, so the server-only module never
// actually loads in the client bundle.
import type { AskResult, AskSource } from "@/server/ai/ask";

/**
 * Global search + command palette. Always mounted (inside AppShell) so the
 * ⌘K / Ctrl+K listener is registered app-wide; `open` only controls the
 * overlay. Searching hits the `searchAction` server action (debounced), and
 * a quick-create row turns the current query into a new note.
 *
 * Second gear — "Ask your notes" (design 13a): when the query reads like a
 * question, an ask row appears above the results. Selecting it (never
 * automatic) calls `askNotesAction`, and the answer view replaces the list:
 * answer paragraph, quoted sources, and a footer with a save-as-note action.
 * A keystroke or Escape returns to plain search.
 */

type SearchResults = {
  notes: SearchNoteResult[];
  bubbles: SearchBubbleResult[];
};

type Row =
  | { kind: "ask" }
  | { kind: "note"; note: SearchNoteResult }
  | { kind: "bubble"; bubble: SearchBubbleResult }
  | { kind: "create" };

type AskState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "answered"; question: string; result: AskResult }
  | { status: "unavailable" }
  | { status: "error" };

const DEBOUNCE_MS = 200;

/** Does the query read like a question rather than a title? */
function isQuestionQuery(q: string): boolean {
  return q.endsWith("?") || q.split(/\s+/).length >= 4;
}

/** "2026-06-24" → "Wednesday, June 24" (UTC so the calendar day never shifts). */
function formatDailyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

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

  const [ask, setAsk] = useState<AskState>({ status: "idle" });
  // Highlight within the answer view: source rows, then the save button.
  const [answerHighlight, setAnswerHighlight] = useState(0);
  const [isSaving, startSave] = useTransition();

  // Monotonic request ids so a slow response can't clobber a newer one.
  const requestIdRef = useRef(0);
  const askIdRef = useRef(0);
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

  /** Leave the ask flow (also invalidates any in-flight ask request). */
  const resetAsk = () => {
    askIdRef.current += 1;
    setAsk({ status: "idle" });
    setAnswerHighlight(0);
  };

  const inAskView = ask.status !== "idle";

  // Escape backs out of the answer view first; a second Escape closes.
  useEscapeKey(open, () => {
    if (ask.status !== "idle") resetAsk();
    else onOpenChange(false);
  });

  // Fresh palette on every open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setSearching(false);
      setHighlight(0);
      askIdRef.current += 1;
      setAsk({ status: "idle" });
      setAnswerHighlight(0);
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
  const isQuestion = trimmed !== "" && isQuestionQuery(trimmed);
  const notes = trimmed && results ? results.notes : [];
  const bubbles = trimmed && results ? results.bubbles : [];

  const rows: Row[] = [
    ...(isQuestion ? [{ kind: "ask" } as Row] : []),
    ...notes.map((note): Row => ({ kind: "note", note })),
    ...bubbles.map((bubble): Row => ({ kind: "bubble", bubble })),
    ...(trimmed ? [{ kind: "create" } as Row] : []),
  ];
  const activeIndex = rows.length
    ? Math.min(highlight, rows.length - 1)
    : -1;

  // Rows the answer view can arrow through: sources, then the save button.
  const sources = ask.status === "answered" ? ask.result.sources : [];
  const answerRowCount = ask.status === "answered" ? sources.length + 1 : 0;
  const answerIndex = answerRowCount
    ? Math.min(answerHighlight, answerRowCount - 1)
    : -1;

  // Keep the keyboard-highlighted row visible while arrowing through.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, answerIndex, rows.length]);

  const close = () => onOpenChange(false);

  const runAsk = () => {
    const question = trimmed;
    if (!question || ask.status === "pending") return;
    askIdRef.current += 1;
    const askId = askIdRef.current;
    setAsk({ status: "pending" });
    setAnswerHighlight(0);
    askNotesAction(question).then(
      (result) => {
        if (askIdRef.current !== askId) return;
        setAsk(
          result
            ? { status: "answered", question, result }
            : { status: "unavailable" },
        );
      },
      () => {
        if (askIdRef.current !== askId) return;
        setAsk({ status: "error" });
      },
    );
  };

  const openSource = (source: AskSource) => {
    router.push(
      source.dailyDate
        ? `/app?d=${source.dailyDate}`
        : `/app/notes/${source.noteId}`,
    );
    close();
  };

  const saveAnswer = () => {
    if (ask.status !== "answered" || isSaving) return;
    const { question, result } = ask;
    startSave(async () => {
      try {
        const { id } = await saveAnswerAsNoteAction(
          question,
          result.answer,
          result.sources.map((s) => s.quote),
        );
        router.push(`/app/notes/${id}`);
        onOpenChangeRef.current(false);
      } catch {
        // Leave the answer view up so the user can retry.
      }
    });
  };

  const activate = (row: Row) => {
    if (row.kind === "ask") {
      runAsk();
      return;
    }
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
    if (inAskView) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (answerRowCount) {
          setAnswerHighlight((answerIndex + 1) % answerRowCount);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (answerRowCount) {
          setAnswerHighlight(
            (answerIndex - 1 + answerRowCount) % answerRowCount,
          );
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (answerIndex < 0) return;
        if (answerIndex < sources.length) openSource(sources[answerIndex]);
        else saveAnswer();
      }
      return;
    }
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

  const askRowCount = isQuestion ? 1 : 0;
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
          {inAskView ? (
            <Sparkles className="h-4 w-4 shrink-0 text-sage" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              // A new keystroke leaves the answer view and resumes search.
              if (ask.status !== "idle") resetAsk();
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search notes and bubbles…"
            aria-label="Search notes and bubbles"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-neutral-400"
          />
          {searching && !inAskView && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" />
          )}
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {ask.status === "pending" ? (
            <div className="flex items-center justify-center gap-2 px-2.5 py-6 text-sm text-ink-500">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              reading your notes…
            </div>
          ) : ask.status === "unavailable" ? (
            <p className="px-2.5 py-6 text-center text-sm text-ink-500">
              Ask isn&rsquo;t set up — add ANTHROPIC_API_KEY to enable it.
            </p>
          ) : ask.status === "error" ? (
            <p className="px-2.5 py-6 text-center text-sm text-ink-500">
              Something went wrong asking your notes — try again.
            </p>
          ) : ask.status === "answered" ? (
            <>
              <p className="px-2.5 pb-2 pt-1.5 text-[13.5px] leading-relaxed text-ink-200">
                {ask.result.answer}
              </p>
              {sources.length > 0 && <GroupLabel>Sources</GroupLabel>}
              {sources.map((source, i) => (
                <button
                  key={`${source.noteId}-${i}`}
                  type="button"
                  data-active={answerIndex === i || undefined}
                  onMouseEnter={() => setAnswerHighlight(i)}
                  onClick={() => openSource(source)}
                  className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left ${
                    answerIndex === i
                      ? "border-steel/35 bg-white/6"
                      : "border-white/7 bg-white/3"
                  }`}
                >
                  {source.dailyDate ? (
                    <Sun className="h-4 w-4 shrink-0 text-sage" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-200">
                      {source.dailyDate
                        ? formatDailyDate(source.dailyDate)
                        : source.title || "Untitled"}
                    </span>
                    <span className="block truncate text-xs text-ink-500">
                      &ldquo;
                      <span className="rounded bg-sage/15 px-0.5 text-ink-300">
                        {source.quote}
                      </span>
                      &rdquo;
                    </span>
                  </span>
                  <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-ink-600" />
                </button>
              ))}
            </>
          ) : trimmed === "" ? (
            <p className="px-2.5 py-6 text-center text-sm text-neutral-400">
              Type to search notes and bubbles
            </p>
          ) : (
            <>
              {isQuestion && (
                <>
                  <GroupLabel>Ask your notes</GroupLabel>
                  <ResultRow
                    active={activeIndex === 0}
                    onHover={() => setHighlight(0)}
                    onSelect={() => activate({ kind: "ask" })}
                    icon={<Sparkles className="h-4 w-4 shrink-0 text-sage" />}
                    label={
                      <>
                        Ask: <span className="font-medium">“{trimmed}”</span>
                      </>
                    }
                  />
                </>
              )}

              {notes.length > 0 && <GroupLabel>Notes</GroupLabel>}
              {notes.map((note, i) => {
                const index = askRowCount + i;
                return (
                  <ResultRow
                    key={note.id}
                    active={activeIndex === index}
                    onHover={() => setHighlight(index)}
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
                );
              })}

              {bubbles.length > 0 && <GroupLabel>Bubbles</GroupLabel>}
              {bubbles.map((bubble, i) => {
                const index = askRowCount + noteRowCount + i;
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

        {ask.status === "answered" && (
          <div className="flex items-center gap-2 border-t border-neutral-200 px-3 py-2 dark:border-white/7">
            <span className="text-[10.5px] text-ink-600">
              answers only from your notes · nothing leaves your library
            </span>
            <button
              type="button"
              disabled={isSaving}
              data-active={answerIndex === sources.length || undefined}
              onMouseEnter={() => setAnswerHighlight(sources.length)}
              onClick={saveAnswer}
              className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-60 ${
                answerIndex === sources.length
                  ? "bg-white/6 text-ink-200"
                  : "text-ink-400"
              }`}
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <ListPlus className="h-3.5 w-3.5 shrink-0" />
              )}
              {isSaving ? "Saving…" : "Save answer as note"}
            </button>
          </div>
        )}
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

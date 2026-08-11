"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState, SerializedEditorState } from "lexical";

import {
  renameNoteAction,
  saveNoteContentAction,
} from "@/app/app/actions";
import { runAutomationsForNoteAction } from "@/app/app/ai/actions";
import { localDateString } from "@/lib/dates";
import { deepEqual } from "@/lib/deep-equal";
import {
  SaveRejected,
  classifySaveError,
  nextRetryDelayMs,
  type SaveFailure,
} from "@/lib/save-failure";
import { useDebouncedCallback } from "./use-debounced-callback";

/**
 * Quiet period after the last content save before the user's automations run
 * against the note. Long enough that a mid-thought pause doesn't fire rules
 * on a half-typed line; the server throttles per note on top of this.
 */
const AUTOMATIONS_IDLE_MS = 20_000;

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * What the editor renders when a save didn't land.
 *
 * A failed save used to be terminal: nothing retried, so a single blip left
 * "save failed" on screen until the user happened to type again — and when the
 * cause was permanent (the session expired, the note was trashed, the tab is
 * older than the deployment) every later save failed too, with no reason given.
 * That is what "it constantly fails after" looks like from the chair. Now a
 * retryable failure comes back on its own (see `nextRetryDelayMs`), a
 * permanent one says what it is and offers the move that fixes it, and either
 * way there is a Retry button rather than a dead red label.
 */
export interface SaveStatus {
  state: SaveState;
  /** Why the last save failed — null unless `state` is "error". */
  failure: SaveFailure | null;
  /** True while an automatic retry is armed (or waiting on the network). */
  retrying: boolean;
  /** Try the failed save again now, resetting the backoff. */
  retryNow: () => void;
}

/** The two things a note autosaves; each supersedes its own kind, not the other. */
type SaveKind = "content" | "title";

interface FailedSave {
  work: () => Promise<void>;
  /**
   * Side effects for the FIRST failure only (stash the words, roll the
   * baseline back). Retries reuse the stash rather than re-stamping its age.
   */
  onFirstFailure?: () => void;
}

const isOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/**
 * Content the server refused, parked in localStorage.
 *
 * A save can fail for reasons the app can't fix from here — the tab is running
 * a bundle older than the current deployment and its server actions 404, the
 * network is gone, the session expired. Whatever the cause, the words are in
 * the browser and nowhere else, and the user's next move (reload) destroys
 * them. So a failed save writes the document here, and the editor offers it
 * back on the next load. localStorage, not session: surviving the reload is
 * the entire point.
 */
export interface UnsavedStash {
  /** Epoch ms of the failed attempt. */
  at: number;
  content: SerializedEditorState;
}

const STASH_PREFIX = "agenda.unsaved.";

export function readUnsavedStash(noteId: string): UnsavedStash | null {
  try {
    const raw = localStorage.getItem(STASH_PREFIX + noteId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UnsavedStash;
    return typeof parsed?.at === "number" && parsed.content
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function clearUnsavedStash(noteId: string): void {
  try {
    localStorage.removeItem(STASH_PREFIX + noteId);
  } catch {
    // Nothing to do — a stash we can't clear is only ever offered, never applied.
  }
}

function writeUnsavedStash(noteId: string, content: SerializedEditorState): void {
  try {
    localStorage.setItem(
      STASH_PREFIX + noteId,
      JSON.stringify({ at: Date.now(), content } satisfies UnsavedStash),
    );
  } catch {
    // Quota or private mode. The in-memory editor still holds the content;
    // this is insurance, not the mechanism.
  }
}

/**
 * The note autosave machinery, extracted verbatim from NoteEditor so the
 * daily-note widget shares identical behavior: debounced title/content saves,
 * an in-flight counter so the indicator only settles once all saves land,
 * no-change skipping keyed on the serialized JSON (including the editor's
 * mount-time normalization fire), and a best-effort pagehide flush.
 */
export function useNoteAutosave(
  noteId: string,
  initialContent: SerializedEditorState | null,
) {
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const initialStateJSON = initialContent
    ? JSON.stringify(initialContent)
    : null;

  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Track in-flight saves so the indicator only shows "saved" once settled.
  const pendingRef = useRef(0);
  // Saves that failed and haven't been superseded, keyed by kind so a newer
  // save of the same kind replaces (rather than races) the one that failed.
  const failedRef = useRef(new Map<SaveKind, FailedSave>());
  const failureRef = useRef<SaveFailure | null>(null);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last content we persisted (or scheduled to persist), serialized. Lets us
  // skip the OnChangePlugin's mount-time fire (which would otherwise bump
  // updatedAt and reorder lists on every open) and other no-change updates.
  // Seeded from the editor's FIRST change fire, not from `initialContent`:
  // Postgres jsonb canonicalizes object key order, so the DB round-trip of
  // the same state stringifies differently than Lexical's serialization and
  // would never match.
  const lastSavedJSONRef = useRef<string | null>(null);
  // Saves are chained so an earlier slow request can't land after (and
  // overwrite) a later one — the server action is a last-write-wins UPDATE.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const cancelRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // runSave arms the retry timer and the retry timer calls runSave, so the
  // cycle is broken through a ref rather than by ordering the definitions.
  const retryRef = useRef<() => void>(() => {});

  const scheduleRetry = useCallback(() => {
    const current = failureRef.current;
    if (failedRef.current.size === 0) {
      setRetrying(false);
      return;
    }
    cancelRetry();
    const online = isOnline();
    const delay = nextRetryDelayMs(current, attemptsRef.current, online);
    if (delay === null) {
      // Offline still counts as "retrying" to the user — the `online`
      // listener below fires the attempt the moment the network is back.
      // Anything else here is a failure no timer can fix.
      setRetrying(Boolean(current?.retryable) && !online);
      return;
    }
    attemptsRef.current += 1;
    setRetrying(true);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      retryRef.current();
    }, delay);
  }, [cancelRetry]);

  /** Called once every batch of in-flight saves has settled. */
  const settle = useCallback(() => {
    if (failedRef.current.size === 0) {
      failureRef.current = null;
      attemptsRef.current = 0;
      cancelRetry();
      setSaveState("saved");
      setFailure(null);
      setRetrying(false);
      return;
    }
    setSaveState("error");
    setFailure(failureRef.current);
    scheduleRetry();
  }, [cancelRetry, scheduleRetry]);

  const runSave = useCallback(
    async (kind: SaveKind, job: FailedSave) => {
      // Every save carries the WHOLE title or document, so this one supersedes
      // any earlier failure of the same kind — and the retry armed for it,
      // which would otherwise land its older copy on top of this one.
      failedRef.current.delete(kind);
      cancelRetry();
      pendingRef.current += 1;
      setSaveState("saving");
      const task = chainRef.current.then(job.work);
      chainRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      try {
        await task;
      } catch (err) {
        const info = classifySaveError(err, isOnline());
        failureRef.current = info;
        // Held for retry — with the first-failure side effects dropped, since
        // they already ran.
        failedRef.current.set(kind, { work: job.work });
        job.onFirstFailure?.();
        console.error(`[notes] save failed (${info.kind}):`, err);
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) settle();
      }
    },
    [cancelRetry, settle],
  );

  /** Re-run everything still outstanding. Shared by the timer and the button. */
  const retry = useCallback(() => {
    cancelRetry();
    const jobs = [...failedRef.current.entries()];
    if (jobs.length === 0) {
      settle();
      return;
    }
    for (const [kind, job] of jobs) void runSave(kind, job);
  }, [cancelRetry, runSave, settle]);

  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  /** The user pressed Retry: start the backoff over rather than resuming it. */
  const retryNow = useCallback(() => {
    attemptsRef.current = 0;
    retry();
  }, [retry]);

  // A real signal that the world changed — the network came back, or the tab
  // was woken up (a closed laptop is the ordinary way a save dies). Worth a
  // fresh attempt immediately, and a fresh backoff.
  useEffect(() => {
    const wake = () => {
      if (failedRef.current.size === 0 || !isOnline()) return;
      if (!failureRef.current?.retryable) return;
      attemptsRef.current = 0;
      retryRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Don't leave a timer running against an unmounted editor.
  useEffect(() => cancelRetry, [cancelRetry]);

  const saveTitle = useDebouncedCallback((next: string) => {
    void runSave("title", {
      work: async () => {
        const res = await renameNoteAction(noteId, next);
        if (!res.ok) throw new SaveRejected(res.failure);
      },
    });
  }, 600);

  // Fire-and-forget: after the note has been quiet for a while, let the
  // user's automations look at it. Returns immediately when no rules exist;
  // failures are silently dropped (automations are additive, never blocking).
  // Actions taken are announced via a window event that AutomationToasts
  // (mounted in AppShell) renders — same literal event name in both files.
  const runAutomations = useDebouncedCallback(() => {
    runAutomationsForNoteAction(noteId, localDateString())
      .then((results) => {
        if (results.length === 0) return;
        window.dispatchEvent(
          new CustomEvent("agenda:automations-ran", { detail: results }),
        );
      })
      .catch(() => {});
  }, AUTOMATIONS_IDLE_MS);

  const saveContent = useDebouncedCallback(
    (json: string, state: SerializedEditorState) => {
      const prev = lastSavedJSONRef.current;
      lastSavedJSONRef.current = json;
      void runSave("content", {
        work: async () => {
          const res = await saveNoteContentAction(noteId, state);
          // The server refused and said why — carry that through so the
          // editor shows the reason instead of a bare "save failed".
          if (!res.ok) throw new SaveRejected(res.failure);
          // Landed — the stash (if any) is now behind the server's copy.
          clearUnsavedStash(noteId);
        },
        // Roll back so the next change retries instead of being skipped, and
        // park the content where a reload can't take it with it.
        onFirstFailure: () => {
          if (lastSavedJSONRef.current === json) lastSavedJSONRef.current = prev;
          writeUnsavedStash(noteId, state);
        },
      });
      runAutomations();
    },
    800,
  );

  // Best-effort flush of pending saves when the tab is hidden/closed. The
  // server-action fetch may still be cut short by the browser, but this
  // narrows the data-loss window considerably.
  useEffect(() => {
    const flushAll = () => {
      saveTitle.flush();
      saveContent.flush();
    };
    window.addEventListener("pagehide", flushAll);
    return () => window.removeEventListener("pagehide", flushAll);
  }, [saveTitle, saveContent]);

  const onTitleChange = useCallback(
    (next: string) => {
      setSaveState("saving");
      saveTitle(next);
    },
    [saveTitle],
  );

  const onEditorChange = useCallback(
    (editorState: EditorState) => {
      const serialized = editorState.toJSON();
      const json = JSON.stringify(serialized);
      if (json === lastSavedJSONRef.current) {
        // Back at the persisted baseline (e.g. the user undid a pending
        // edit): drop any armed save so it can't fire and persist content
        // the editor no longer shows.
        saveContent.cancel();
        if (pendingRef.current === 0) {
          setSaveState((s) => (s === "saving" ? "saved" : s));
        }
        return;
      }
      if (lastSavedJSONRef.current === null) {
        lastSavedJSONRef.current = json;
        // The first fire is USUALLY the editor's mount-time normalization of
        // the loaded content, which must not be saved (it would bump
        // updatedAt and reorder every list on mere opening).
        //
        // Usually — but OnChangePlugin runs with ignoreSelectionChange, so a
        // document that needs NO normalization fires nothing at mount, and
        // then the first fire is a real edit. Absorbing that unconditionally
        // silently dropped it. Typing hid the bug (the next keystroke saves
        // everything), but a one-shot change with no follow-up — folding a
        // task, toggling a card — was lost for good.
        //
        // So absorb it only when it really is the document we loaded. Compared
        // structurally, not by string: jsonb canonicalizes key order, so the
        // round-tripped copy never stringifies identically to Lexical's own
        // serialization.
        //
        // A note with NO stored content is still absorbed unconditionally: the
        // mount fire there is Lexical's empty document, which is not equal to
        // `null` by any comparison and would save on every open.
        if (initialContent === null || deepEqual(serialized, initialContent)) {
          return;
        }
      }
      setSaveState("saving");
      saveContent(json, serialized);
    },
    [saveContent, initialContent],
  );

  const status: SaveStatus = { state: saveState, failure, retrying, retryNow };

  return {
    saveState,
    status,
    initialStateJSON,
    onTitleChange,
    onEditorChange,
  };
}

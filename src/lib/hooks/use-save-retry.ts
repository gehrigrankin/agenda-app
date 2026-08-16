"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  classifySaveError,
  nextRetryDelayMs,
  type SaveFailure,
} from "@/lib/save-failure";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface SaveStatus {
  state: SaveState;
  failure: SaveFailure | null;
  retrying: boolean;
  retryNow: () => void;
}

export interface SaveJob {
  work: () => Promise<void>;
  /** Runs only when this version fails for the first time. */
  onFirstFailure?: () => void;
}

/**
 * Monotonic per-kind versions keep an older queued request from registering a
 * retry after a newer save has already superseded it.
 */
export function beginSaveVersion<Kind extends string>(
  versions: Map<Kind, number>,
  kind: Kind,
): number {
  const version = (versions.get(kind) ?? 0) + 1;
  versions.set(kind, version);
  return version;
}

export function isCurrentSaveVersion<Kind extends string>(
  versions: Map<Kind, number>,
  kind: Kind,
  version: number,
): boolean {
  return versions.get(kind) === version;
}

const isOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/**
 * Shared durable-save coordinator. Jobs are FIFO, a newer job supersedes a
 * failed older job with the same key, retryable failures back off forever,
 * and network/tab wake-up signals retry immediately.
 */
export function useSaveRetry<Kind extends string>() {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [retrying, setRetrying] = useState(false);

  const pendingRef = useRef(0);
  const failedRef = useRef(new Map<Kind, SaveJob>());
  const versionsRef = useRef(new Map<Kind, number>());
  const failureRef = useRef<SaveFailure | null>(null);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const cancelRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

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
    async (kind: Kind, job: SaveJob) => {
      const version = beginSaveVersion(versionsRef.current, kind);
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
        // A newer save of this kind may have been queued while this request
        // was in flight. Retrying this older document after the newer one
        // lands would overwrite the user's latest text.
        if (isCurrentSaveVersion(versionsRef.current, kind, version)) {
          failureRef.current = info;
          failedRef.current.set(kind, { work: job.work });
          job.onFirstFailure?.();
        }
        console.error(`[notes] save failed (${info.kind}):`, err);
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) settle();
      }
    },
    [cancelRetry, settle],
  );

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

  const retryNow = useCallback(() => {
    attemptsRef.current = 0;
    retry();
  }, [retry]);

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

  useEffect(() => cancelRetry, [cancelRetry]);

  const markSaving = useCallback(() => setSaveState("saving"), []);
  const markPendingCancelled = useCallback(() => {
    if (pendingRef.current === 0) {
      setSaveState((state) => (state === "saving" ? "saved" : state));
    }
  }, []);
  const discardFailed = useCallback(
    (kind: Kind) => {
      failedRef.current.delete(kind);
      if (failedRef.current.size === 0 && pendingRef.current === 0) settle();
    },
    [settle],
  );

  const status: SaveStatus = { state: saveState, failure, retrying, retryNow };
  return { status, runSave, markSaving, markPendingCancelled, discardFailed };
}

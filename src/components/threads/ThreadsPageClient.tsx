"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  dismissThreadAction,
  getAiSettingsAction,
  getThreadAction,
  listThreadsAction,
  promoteThreadAction,
  scanThreadsAction,
  type ThreadDetailResult,
  type ThreadListItem,
} from "@/app/app/ai/actions";
import { localDateString } from "@/lib/dates";
import { ThreadsDesktop } from "./ThreadsDesktop";
import { usePhoneParam } from "@/components/phone/use-phone-param";
import { ThreadsPhone } from "./ThreadsPhone";

/**
 * Threads page (design Turn 14b): the app notices when a topic keeps
 * appearing across notes and quietly assembles a chronological thread —
 * every mention, in context, without tagging anything. Left column lists the
 * detected threads; the main panel renders the selected one's timeline.
 *
 * All data loads client-side. On mount a non-forced scan runs in the
 * background (it self-throttles server-side to once per 6h) and the list is
 * refreshed if it turned up anything new.
 */

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function ThreadsPageClient({
  initialThreadId = null,
}: {
  /** `?t=<id>` from the URL — the thread to open first. */
  initialThreadId?: string | null;
}) {
  const router = useRouter();

  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
  }, []);

  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [threads, setThreads] = useState<ThreadListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId);
  const [detail, setDetail] = useState<ThreadDetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState(0);

  // Initial load, plus a background (non-forced, self-throttled) scan.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listThreadsAction(), getAiSettingsAction()])
      .then(([items, settings]) => {
        if (cancelled) return;
        setThreads(items);
        setAiConfigured(settings.aiConfigured);
      })
      .catch((err) => console.error("[threads] load failed:", err));

    scanThreadsAction()
      .then((outcome) => {
        if (cancelled || !outcome.scanned || outcome.threads === 0) return;
        return listThreadsAction().then((items) => {
          if (!cancelled) setThreads(items);
        });
      })
      .catch((err) => console.error("[threads] background scan failed:", err));

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the selection valid as the list changes (initial auto-select, and
  // re-selection if the selected thread is dismissed out from under it).
  useEffect(() => {
    if (threads === null) return;
    setSelectedId((prev) => {
      if (prev && threads.some((t) => t.id === prev)) return prev;
      return threads[0]?.id ?? null;
    });
  }, [threads]);

  // Keep the selection in the URL (?t=<id>) so it survives reload and links.
  // Desktop only: on a phone ?t= means "this thread is open full-screen", set
  // by openPhoneThread, never by the auto-selection.
  useEffect(() => {
    if (!selectedId) return;
    try {
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get("t") === selectedId) return;
      url.searchParams.set("t", selectedId);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* non-critical */
    }
  }, [selectedId]);

  // Load the selected thread's timeline.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getThreadAction(selectedId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setDetailLoading(false);
      })
      .catch((err) => {
        console.error("[threads] detail load failed:", err);
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Phone: the thread open full-screen, mirrored in ?t= (back = the list).
  const {
    id: phoneOpenId,
    open: openPhoneParam,
    close: closePhoneThread,
  } = usePhoneParam("t", initialThreadId);
  const openPhoneThread = useCallback(
    (id: string) => {
      setSelectedId(id);
      openPhoneParam(id);
    },
    [openPhoneParam],
  );

  // A phone thread that no longer exists (dismissed, bad link) → the list.
  useEffect(() => {
    if (threads && phoneOpenId && !threads.some((t) => t.id === phoneOpenId)) {
      closePhoneThread();
    }
  }, [threads, phoneOpenId, closePhoneThread]);

  // Browser back onto a thread link: make it the loaded one.
  useEffect(() => {
    if (phoneOpenId) setSelectedId(phoneOpenId);
  }, [phoneOpenId]);

  const handleRefresh = async (force: boolean) => {
    setRefreshing(true);
    try {
      await scanThreadsAction(force);
      const items = await listThreadsAction();
      setThreads(items);
    } catch (err) {
      console.error("[threads] refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handlePromote = async () => {
    if (!detail || detail.status === "promoted") return;
    setPromoting(true);
    try {
      const result = await promoteThreadAction(detail.id);
      if (!result) return;
      setDetail((prev) =>
        prev
          ? { ...prev, status: "promoted", promotedNoteId: result.noteId }
          : prev,
      );
      setThreads((prev) =>
        prev
          ? prev.map((t) =>
              t.id === detail.id
                ? { ...t, status: "promoted", promotedNoteId: result.noteId }
                : t,
            )
          : prev,
      );
      router.push(`/app/notes/${result.noteId}`);
    } catch (err) {
      console.error("[threads] promote failed:", err);
    } finally {
      setPromoting(false);
    }
  };

  const handleDismiss = (id: string) => {
    const prevThreads = threads;
    setThreads((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
    dismissThreadAction(id)
      .then(() => setDismissedVersion((v) => v + 1))
      .catch((err) => {
        console.error("[threads] dismiss failed:", err);
        setThreads(prevThreads);
      });
  };

  /** After a restore: reload the active list so the thread reappears. */
  const refreshThreads = () => {
    listThreadsAction()
      .then(setThreads)
      .catch((err) => console.error("[threads] reload failed:", err));
  };

  const loadingShell = threads === null || aiConfigured === null;

  const desktop = (
    <div className="hidden h-full min-h-0 md:block">
      <ThreadsDesktop
        loading={loadingShell}
        aiConfigured={aiConfigured}
        threads={threads ?? []}
        selectedId={selectedId}
        onSelect={setSelectedId}
        detail={detail}
        detailLoading={detailLoading}
        today={today}
        refreshing={refreshing}
        onRefresh={() => void handleRefresh(true)}
        promoting={promoting}
        onPromote={() => void handlePromote()}
        onDismiss={handleDismiss}
        dismissedVersion={dismissedVersion}
        onRestored={refreshThreads}
      />
    </div>
  );

  const phone = (
    <ThreadsPhone
      loading={loadingShell}
      aiConfigured={aiConfigured}
      threads={threads ?? []}
      openId={phoneOpenId}
      detail={detail}
      detailLoading={detailLoading}
      today={today}
      refreshing={refreshing}
      onRefresh={() => void handleRefresh(true)}
      promoting={promoting}
      onPromote={() => void handlePromote()}
      onDismiss={(id) => {
        handleDismiss(id);
        closePhoneThread();
      }}
      dismissedVersion={dismissedVersion}
      onRestored={refreshThreads}
      onOpen={openPhoneThread}
      onBack={closePhoneThread}
    />
  );

  return (
    <>
      {phone}
      {desktop}
    </>
  );
}

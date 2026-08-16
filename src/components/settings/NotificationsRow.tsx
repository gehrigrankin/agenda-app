"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

import {
  sendTestNotificationAction,
  syncTimezoneAction,
} from "@/app/app/push/actions";

/**
 * Settings row for web-push task/habit reminders ("Reminders"). Shows one of
 * four states — unsupported / permission denied / off / on — and drives the
 * subscribe flow: Notification permission → subscribe on the registered
 * service worker (registration itself is owned by the SW-registration
 * component; we only await navigator.serviceWorker.ready) → persist via
 * POST /api/push/subscribe. Also syncs the browser's IANA timezone to
 * user_settings on mount, which is what lets the reminder cron place this
 * user's wall-clock reminder times.
 *
 * iPhone note: iOS only exposes the Push API to installed home-screen web
 * apps, so the row reads "unsupported" in plain Safari until the app is
 * added to the Home Screen.
 */

type Status = "loading" | "unsupported" | "denied" | "off" | "on";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** Push API wants the VAPID key as bytes, not the base64url env string. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** navigator.serviceWorker.ready never rejects — cap the wait ourselves. */
function readyRegistration(
  timeoutMs: number,
): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export function NotificationsRow() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // Keep the stored IANA timezone fresh (no-op server-side when unchanged).
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) void syncTimezoneAction(tz);
    } catch {
      // ignore — timezone sync is best-effort
    }

    let cancelled = false;
    (async () => {
      if (!pushSupported() || !VAPID_PUBLIC_KEY) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      // Short wait: on first load the SW may still be registering.
      const reg = await readyRegistration(3_000);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!cancelled) setStatus(sub ? "on" : "off");
    })().catch(() => {
      if (!cancelled) setStatus("off");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    if (!VAPID_PUBLIC_KEY) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await readyRegistration(10_000);
      if (!reg) {
        setMessage("Service worker isn't ready — reload and try again.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setStatus("on");
    } catch (err) {
      console.error("[settings] enabling reminders failed:", err);
      setMessage("Couldn't enable reminders.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await readyRegistration(3_000);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      console.error("[settings] disabling reminders failed:", err);
      setMessage("Couldn't disable reminders.");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendTestNotificationAction();
      setMessage(
        !result.configured
          ? "Push isn't configured on the server."
          : result.sent > 0
            ? `Sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`
            : "No device accepted the push. On Android, allow notifications for this site in Chrome, then disable and re-enable reminders here.",
      );
    } catch {
      setMessage("Couldn't send the test.");
    } finally {
      setBusy(false);
    }
  };

  const stateLabel =
    status === "loading"
      ? "Loading…"
      : status === "unsupported"
        ? "Unavailable"
        : status === "denied"
          ? "Blocked"
          : status === "on"
            ? "On"
            : "Off";

  return (
    <div className="flex min-h-[3.25rem] flex-col gap-2 border-t border-white/6 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <Bell className="h-[1.0625rem] w-[1.0625rem] flex-none text-ink-400" />
        <span className="flex-1 text-[0.875rem] font-medium text-ink-200">
          Reminders
        </span>
        <span className="text-xs text-ink-500">{stateLabel}</span>
      </div>

      {status === "unsupported" && (
        <p className="pl-[1.8125rem] text-[0.71875rem] leading-relaxed text-ink-600">
          Notifications aren&apos;t available in this browser. On iPhone, add
          the app to your Home Screen (Share → Add to Home Screen) and enable
          reminders from there.
        </p>
      )}
      {status === "denied" && (
        <p className="pl-[1.8125rem] text-[0.71875rem] leading-relaxed text-ink-600">
          Notifications are blocked for this site — allow them in your browser
          settings, then reload.
        </p>
      )}

      {(status === "off" || status === "on") && (
        <div className="flex flex-wrap items-center gap-2 pl-[1.8125rem]">
          {status === "off" ? (
            <button
              type="button"
              onClick={() => void enable()}
              disabled={busy}
              className="flex-none rounded-md bg-sage px-2.5 py-1.5 text-[0.71875rem] font-semibold text-sage-ink disabled:opacity-50"
            >
              {busy ? "Enabling…" : "Enable"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void disable()}
                disabled={busy}
                className="flex-none rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-50"
              >
                Disable
              </button>
              <button
                type="button"
                onClick={() => void sendTest()}
                disabled={busy}
                className="flex-none rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[0.71875rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-50"
              >
                Send test notification
              </button>
            </>
          )}
          {message && (
            <span className="text-[0.65625rem] text-ink-500">{message}</span>
          )}
        </div>
      )}
    </div>
  );
}

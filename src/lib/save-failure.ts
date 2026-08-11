/**
 * Why a save didn't land — in words the person who typed the sentence can act
 * on, and with the two facts the autosave loop needs from it: is retrying the
 * same request worth anything, and is a reload the only way out.
 *
 * A save failure used to surface as the bare words "save failed", which is the
 * worst of both worlds: alarming enough to interrupt, useless for deciding what
 * to do. Worse, a failure was terminal — nothing retried, so the first blip
 * left the indicator red until the next keystroke happened to succeed. The
 * kinds below exist so the editor can say the actual reason and so the retry
 * loop can tell a network blip (retry, it heals) from a stale tab (retrying
 * forever accomplishes nothing; reload).
 *
 * Pure module: server actions build failures with the constants and helpers
 * here, the client classifies thrown errors with `classifySaveError`, and both
 * hand the UI the same shape.
 */

export type SaveFailureKind =
  /** The browser says there is no network at all. */
  | "offline"
  /** The request never reached the server (dropped fetch, DNS, proxy). */
  | "connection"
  /** This tab runs a bundle the server no longer serves — its actions 404. */
  | "stale"
  /** The session is gone; the server won't say who the owner is. */
  | "auth"
  /** There is no note to write to — trashed or deleted somewhere else. */
  | "missing"
  /** It reached the server and the server failed. */
  | "server";

export interface SaveFailure {
  kind: SaveFailureKind;
  /** One sentence, shown to the user verbatim. */
  message: string;
  /** Retrying the identical request can't work until the page reloads. */
  needsReload: boolean;
  /** Worth retrying on a timer — network faults heal, a trashed note doesn't. */
  retryable: boolean;
}

/** A save the server explicitly refused, carrying the reason it gave. */
export class SaveRejected extends Error {
  readonly failure: SaveFailure;

  constructor(failure: SaveFailure) {
    super(failure.message);
    this.name = "SaveRejected";
    this.failure = failure;
  }
}

export const AUTH_FAILURE: SaveFailure = {
  kind: "auth",
  message: "Your session expired. Sign in again — your text is kept here until it saves.",
  needsReload: true,
  retryable: false,
};

export const MISSING_NOTE_FAILURE: SaveFailure = {
  kind: "missing",
  message:
    "This note is in Trash or no longer exists, so nothing typed here is being saved.",
  needsReload: false,
  retryable: false,
};

export const OFFLINE_FAILURE: SaveFailure = {
  kind: "offline",
  message: "You're offline. This keeps retrying and saves as soon as you're back.",
  needsReload: false,
  retryable: true,
};

const CONNECTION_FAILURE: SaveFailure = {
  kind: "connection",
  message: "Couldn't reach the server. Retrying — your text is kept here meanwhile.",
  needsReload: false,
  retryable: true,
};

const STALE_FAILURE: SaveFailure = {
  kind: "stale",
  message:
    "This tab is running an older version of the app. Reload — your text is offered back afterwards.",
  needsReload: true,
  retryable: false,
};

/**
 * Backoff for automatic retries. The last delay repeats: an unattended tab
 * should keep trying about once a minute rather than give up while the words
 * are still only in the browser.
 */
export const RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000, 60_000];

/**
 * How long to wait before retrying a failed save, or null when a timer is the
 * wrong answer.
 *
 * Null has two very different causes and the caller distinguishes them by
 * looking at `online`: a failure that no retry can fix (stale tab, expired
 * session, note gone) versus being offline, where the retry comes from the
 * `online` event instead of a timer — burning attempts against a dead radio
 * only walks the backoff out for nothing.
 */
export function nextRetryDelayMs(
  failure: SaveFailure | null,
  attempt: number,
  online: boolean,
): number | null {
  if (!failure?.retryable) return null;
  if (!online) return null;
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

/** Cap on server detail echoed to the UI: enough to recognise, not a stack trace. */
const DETAIL_MAX = 140;

/** The message of an unknown throw, if it has a usable one. */
function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return "";
}

/**
 * A failure for something that broke server-side. The real message rides along
 * — this is the owner's own app, and "say why" is the whole point.
 */
export function serverSaveFailure(err: unknown): SaveFailure {
  const detail = messageOf(err).trim().slice(0, DETAIL_MAX);
  return {
    kind: "server",
    message: detail
      ? `The server couldn't save this: ${detail}`
      : "The server couldn't save this.",
    needsReload: false,
    // A 500 is usually the database having a moment; the next attempt often works.
    retryable: true,
  };
}

/**
 * Classify whatever the save threw. `online` comes from the caller
 * (`navigator.onLine`) so this module stays pure and testable.
 */
export function classifySaveError(err: unknown, online: boolean): SaveFailure {
  // The server already told us exactly what went wrong.
  if (err instanceof SaveRejected) return err.failure;

  const msg = messageOf(err);

  // Next's version-skew errors. Checked before the offline test: a reload is
  // the fix either way, and calling it "offline" would send the user waiting
  // for a network that is fine.
  if (
    /failed to find server action|older or newer deployment|unexpected response was received/i.test(
      msg,
    )
  ) {
    return STALE_FAILURE;
  }

  if (!online) return OFFLINE_FAILURE;

  if (
    /failed to fetch|networkerror|network error|load failed|fetch failed|connection closed|err_network|err_internet/i.test(
      msg,
    )
  ) {
    return CONNECTION_FAILURE;
  }

  if (/unauthorized|\b401\b/i.test(msg)) return AUTH_FAILURE;

  return serverSaveFailure(err);
}

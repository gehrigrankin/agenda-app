import { describe, expect, it } from "vitest";

import {
  AUTH_FAILURE,
  MISSING_NOTE_FAILURE,
  OFFLINE_FAILURE,
  RETRY_DELAYS_MS,
  SaveRejected,
  classifySaveError,
  nextRetryDelayMs,
  serverSaveFailure,
} from "./save-failure";

describe("classifySaveError", () => {
  it("passes a server-stated reason through untouched", () => {
    const err = new SaveRejected(MISSING_NOTE_FAILURE);
    expect(classifySaveError(err, true)).toBe(MISSING_NOTE_FAILURE);
    // Even offline: the server answered, so its reason is the true one.
    expect(classifySaveError(err, false)).toBe(MISSING_NOTE_FAILURE);
  });

  it("calls a dropped request a connection failure, and keeps retrying it", () => {
    const f = classifySaveError(new TypeError("Failed to fetch"), true);
    expect(f.kind).toBe("connection");
    expect(f.retryable).toBe(true);
    expect(f.needsReload).toBe(false);
  });

  it("reports being offline without burning the reason on the network", () => {
    const f = classifySaveError(new TypeError("Load failed"), false);
    expect(f.kind).toBe("offline");
    expect(f.retryable).toBe(true);
  });

  // Version skew outranks offline: reloading is the fix either way, and
  // "you're offline" would leave the user waiting on a network that is fine.
  it("spots a tab left behind by a deployment, even while offline", () => {
    const err = new Error(
      'Failed to find Server Action "abc123". This request might be from an older or newer deployment.',
    );
    for (const online of [true, false]) {
      const f = classifySaveError(err, online);
      expect(f.kind).toBe("stale");
      expect(f.needsReload).toBe(true);
      expect(f.retryable).toBe(false);
    }
  });

  it("treats an expired session as unretryable", () => {
    const f = classifySaveError(new Error("Unauthorized"), true);
    expect(f).toBe(AUTH_FAILURE);
    expect(f.retryable).toBe(false);
  });

  it("falls back to the server's own words", () => {
    const f = classifySaveError(new Error("connect ETIMEDOUT"), true);
    expect(f.kind).toBe("server");
    expect(f.message).toContain("connect ETIMEDOUT");
    expect(f.retryable).toBe(true);
  });

  it("survives a throw that isn't an Error", () => {
    const f = classifySaveError({ weird: true }, true);
    expect(f.kind).toBe("server");
    expect(f.message).toBe("The server couldn't save this.");
  });
});

describe("nextRetryDelayMs", () => {
  const transient = classifySaveError(new TypeError("Failed to fetch"), true);

  it("backs off, then keeps trying at the last interval forever", () => {
    const delays = [0, 1, 2, 3, 4, 5, 40].map((n) =>
      nextRetryDelayMs(transient, n, true),
    );
    expect(delays.slice(0, 5)).toEqual(RETRY_DELAYS_MS);
    // Past the end of the table it holds at the final delay rather than
    // stopping — the words are still only in the browser.
    const last = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    expect(delays[5]).toBe(last);
    expect(delays[6]).toBe(last);
  });

  it("never arms a timer for a failure a retry can't fix", () => {
    expect(nextRetryDelayMs(AUTH_FAILURE, 0, true)).toBeNull();
    expect(nextRetryDelayMs(MISSING_NOTE_FAILURE, 0, true)).toBeNull();
    expect(nextRetryDelayMs(null, 0, true)).toBeNull();
  });

  // Offline waits on the `online` event instead — a timer would just walk the
  // backoff out to a minute while the radio is off.
  it("waits for the network instead of ticking while offline", () => {
    expect(nextRetryDelayMs(OFFLINE_FAILURE, 0, false)).toBeNull();
    expect(nextRetryDelayMs(OFFLINE_FAILURE, 0, true)).toBe(RETRY_DELAYS_MS[0]);
  });
});

describe("serverSaveFailure", () => {
  it("trims a runaway message instead of pasting a stack trace into the UI", () => {
    const f = serverSaveFailure(new Error("x".repeat(500)));
    expect(f.message.length).toBeLessThan(200);
  });
});

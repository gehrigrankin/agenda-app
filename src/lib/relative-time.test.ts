import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

// A fixed "now" instant so every case is deterministic regardless of when the
// suite runs. 2026-07-07T12:00:00.000Z.
const NOW = new Date("2026-07-07T12:00:00.000Z").getTime();

function agoMs(ms: number): Date {
  return new Date(NOW - ms);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe(`relativeTime(_, "long")`, () => {
  // Trash's "deleted X ago" wording.
  it("just now under a minute", () => {
    expect(relativeTime(agoMs(0), "long", NOW)).toBe("just now");
    expect(relativeTime(agoMs(59 * SECOND), "long", NOW)).toBe("just now");
  });

  it("singular/plural minutes", () => {
    expect(relativeTime(agoMs(1 * MINUTE), "long", NOW)).toBe("1 minute ago");
    expect(relativeTime(agoMs(3 * MINUTE), "long", NOW)).toBe("3 minutes ago");
  });

  it("singular/plural hours", () => {
    expect(relativeTime(agoMs(1 * HOUR), "long", NOW)).toBe("1 hour ago");
    expect(relativeTime(agoMs(5 * HOUR), "long", NOW)).toBe("5 hours ago");
  });

  it("singular/plural days, under the 30-day month cutover", () => {
    expect(relativeTime(agoMs(1 * DAY), "long", NOW)).toBe("1 day ago");
    expect(relativeTime(agoMs(3 * DAY), "long", NOW)).toBe("3 days ago");
    expect(relativeTime(agoMs(29 * DAY), "long", NOW)).toBe("29 days ago");
  });

  it("months once past 30 days, while under a year", () => {
    expect(relativeTime(agoMs(30 * DAY), "long", NOW)).toBe("1 month ago");
    expect(relativeTime(agoMs(90 * DAY), "long", NOW)).toBe("3 months ago");
    expect(relativeTime(agoMs(364 * DAY), "long", NOW)).toBe("12 months ago");
  });

  it("years once past 365 days", () => {
    expect(relativeTime(agoMs(365 * DAY), "long", NOW)).toBe("1 year ago");
    expect(relativeTime(agoMs(800 * DAY), "long", NOW)).toBe("2 years ago");
  });

  it("clamps a future date to zero seconds", () => {
    expect(relativeTime(new Date(NOW + 10_000), "long", NOW)).toBe("just now");
  });
});

describe(`relativeTime(_, "short")`, () => {
  // Inbox's "22 min ago" wording — takes an explicit nowMs, never a month/
  // year tier (always falls back to "N days ago").
  it("just now under a minute", () => {
    expect(relativeTime(agoMs(0), "short", NOW)).toBe("just now");
    expect(relativeTime(agoMs(59 * SECOND), "short", NOW)).toBe("just now");
  });

  it("abbreviated minutes, no singular/plural distinction", () => {
    expect(relativeTime(agoMs(1 * MINUTE), "short", NOW)).toBe("1 min ago");
    expect(relativeTime(agoMs(22 * MINUTE), "short", NOW)).toBe("22 min ago");
  });

  it("singular/plural hours, abbreviated", () => {
    expect(relativeTime(agoMs(1 * HOUR), "short", NOW)).toBe("1 hr ago");
    expect(relativeTime(agoMs(3 * HOUR), "short", NOW)).toBe("3 hrs ago");
  });

  it("falls back to days with no month/year tier, however large", () => {
    expect(relativeTime(agoMs(2 * DAY), "short", NOW)).toBe("2 days ago");
    expect(relativeTime(agoMs(1 * DAY), "short", NOW)).toBe("1 day ago");
    expect(relativeTime(agoMs(400 * DAY), "short", NOW)).toBe("400 days ago");
  });

  it("takes nowMs explicitly (hydration-safe usage)", () => {
    const iso = new Date(NOW - 5 * MINUTE).toISOString();
    expect(relativeTime(iso, "short", NOW)).toBe("5 min ago");
  });

  it("clamps a future date to zero ms", () => {
    expect(relativeTime(new Date(NOW + 10_000), "short", NOW)).toBe("just now");
  });
});

describe(`relativeTime(_, "coarse")`, () => {
  // Gardener's lost & found "3 weeks ago" wording — always plural, days only
  // under 14, then weeks, then months.
  it("days under the 14-day cutover, always plural", () => {
    expect(relativeTime(agoMs(0 * DAY), "coarse", NOW)).toBe("0 days ago");
    expect(relativeTime(agoMs(1 * DAY), "coarse", NOW)).toBe("1 days ago");
    expect(relativeTime(agoMs(13 * DAY), "coarse", NOW)).toBe("13 days ago");
  });

  it("weeks from 14 up to (not including) 60 days", () => {
    expect(relativeTime(agoMs(14 * DAY), "coarse", NOW)).toBe("2 weeks ago");
    expect(relativeTime(agoMs(21 * DAY), "coarse", NOW)).toBe("3 weeks ago");
    expect(relativeTime(agoMs(59 * DAY), "coarse", NOW)).toBe("8 weeks ago");
  });

  it("months from 60 days on", () => {
    expect(relativeTime(agoMs(60 * DAY), "coarse", NOW)).toBe("2 months ago");
    expect(relativeTime(agoMs(150 * DAY), "coarse", NOW)).toBe("5 months ago");
  });

  it("defaults nowMs to Date.now() when omitted", () => {
    // Just check it doesn't throw and returns a "days/weeks/months ago"
    // string for a timestamp a few days in the past.
    const iso = new Date(Date.now() - 3 * DAY).toISOString();
    expect(relativeTime(iso, "coarse")).toMatch(/ago$/);
  });
});

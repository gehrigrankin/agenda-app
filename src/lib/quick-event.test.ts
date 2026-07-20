import { describe, expect, it } from "vitest";
import { parseQuickEvent } from "./quick-event";

// Fixed reference day throughout (no Date.now anywhere): 2026-07-08 is a
// Wednesday. Nearby weekdays: Thu 07-09, Fri 07-10, Sat 07-11, Sun 07-12,
// Mon 07-13, Wed (next) 07-15.
const TODAY = "2026-07-08";

describe("parseQuickEvent", () => {
  it("parses the canonical example", () => {
    expect(parseQuickEvent("coffee w/ Sam fri 3pm", TODAY)).toEqual({
      title: "coffee w/ Sam",
      date: "2026-07-10",
      startMin: 900,
      endMin: 960,
    });
  });

  describe("date words", () => {
    it('parses "today" and "tonight" as today', () => {
      expect(parseQuickEvent("pack bags today", TODAY)?.date).toBe("2026-07-08");
      expect(parseQuickEvent("pack bags tonight", TODAY)?.date).toBe("2026-07-08");
    });

    it('parses "tomorrow" and its short forms', () => {
      expect(parseQuickEvent("dentist tomorrow", TODAY)).toEqual({
        title: "dentist",
        date: "2026-07-09",
        startMin: null,
        endMin: null,
      });
      expect(parseQuickEvent("dentist tmrw", TODAY)?.date).toBe("2026-07-09");
      expect(parseQuickEvent("dentist tmr", TODAY)?.date).toBe("2026-07-09");
    });
  });

  describe("weekdays", () => {
    it("resolves a short weekday name to the nearest occurrence after today", () => {
      expect(parseQuickEvent("gym sat", TODAY)?.date).toBe("2026-07-11");
      expect(parseQuickEvent("brunch sun", TODAY)?.date).toBe("2026-07-12");
    });

    it("resolves full weekday names", () => {
      expect(parseQuickEvent("party saturday", TODAY)?.date).toBe("2026-07-11");
      expect(parseQuickEvent("gym thursday", TODAY)?.date).toBe("2026-07-09");
    });

    it("sends today's own weekday to NEXT week (nearest is on or after today+1)", () => {
      // TODAY is a Wednesday, so "wed" means 2026-07-15.
      expect(parseQuickEvent("review wed", TODAY)?.date).toBe("2026-07-15");
    });

    it('adds a week for "next <weekday>"', () => {
      expect(parseQuickEvent("standup next mon", TODAY)?.date).toBe("2026-07-20");
      expect(parseQuickEvent("coffee next fri", TODAY)?.date).toBe("2026-07-17");
    });

    it('strips the "on" in "on fri" forms', () => {
      expect(parseQuickEvent("dentist on fri", TODAY)).toEqual({
        title: "dentist",
        date: "2026-07-10",
        startMin: null,
        endMin: null,
      });
    });
  });

  describe("explicit dates", () => {
    it("parses month-name dates, with and without ordinal suffix", () => {
      expect(parseQuickEvent("flight july 21", TODAY)?.date).toBe("2026-07-21");
      expect(parseQuickEvent("flight jul 21st", TODAY)?.date).toBe("2026-07-21");
    });

    it("parses numeric dates", () => {
      expect(parseQuickEvent("kickoff 7/21", TODAY)?.date).toBe("2026-07-21");
      expect(parseQuickEvent("kickoff 7/21/2026", TODAY)?.date).toBe("2026-07-21");
    });

    it("rolls a yearless past date to next year", () => {
      // 7/4 already passed on 2026-07-08.
      expect(parseQuickEvent("bbq 7/4", TODAY)?.date).toBe("2027-07-04");
    });

    it("keeps a yearless date equal to today in the current year", () => {
      expect(parseQuickEvent("checkin 7/8", TODAY)?.date).toBe("2026-07-08");
    });

    it("removes a mid-title connector left dangling by the strip", () => {
      expect(parseQuickEvent("lunch on jul 21 with Sam", TODAY)).toEqual({
        title: "lunch with Sam",
        date: "2026-07-21",
        startMin: null,
        endMin: null,
      });
    });
  });

  describe("times", () => {
    it("parses meridiem times, defaulting to a one-hour event", () => {
      expect(parseQuickEvent("call mom at 3pm", TODAY)).toEqual({
        title: "call mom",
        date: null,
        startMin: 900,
        endMin: 960,
      });
      expect(parseQuickEvent("standup 9:30am", TODAY)?.startMin).toBe(570);
    });

    it("parses 24-hour times", () => {
      expect(parseQuickEvent("standup 15:00", TODAY)).toEqual({
        title: "standup",
        date: null,
        startMin: 900,
        endMin: 960,
      });
    });

    it('parses "noon" and "midnight"', () => {
      expect(parseQuickEvent("lunch at noon", TODAY)).toEqual({
        title: "lunch",
        date: null,
        startMin: 720,
        endMin: 780,
      });
      expect(parseQuickEvent("launch midnight", TODAY)).toEqual({
        title: "launch",
        date: null,
        startMin: 0,
        endMin: 60,
      });
    });

    it('applies the bare-hour heuristic after "at"', () => {
      expect(parseQuickEvent("review at 4", TODAY)?.startMin).toBe(960); // 1–7 → PM
      expect(parseQuickEvent("review at 4", TODAY)?.endMin).toBe(1020);
      expect(parseQuickEvent("run at 8", TODAY)?.startMin).toBe(480); // 8–11 → AM
      expect(parseQuickEvent("lunch at 12", TODAY)?.startMin).toBe(720); // 12 → noon
    });

    it('never eats bare numbers without "at"', () => {
      expect(parseQuickEvent("review q3 numbers tomorrow", TODAY)).toEqual({
        title: "review q3 numbers",
        date: "2026-07-09",
        startMin: null,
        endMin: null,
      });
      expect(parseQuickEvent("plan 3 things", TODAY)).toEqual({
        title: "plan 3 things",
        date: null,
        startMin: null,
        endMin: null,
      });
    });
  });

  describe("ranges", () => {
    it('parses "3-4:30pm" with the meridiem applied to both sides', () => {
      expect(parseQuickEvent("sync 3-4:30pm", TODAY)).toEqual({
        title: "sync",
        date: null,
        startMin: 900,
        endMin: 990,
      });
    });

    it("parses meridiem-on-both-sides and en dash forms", () => {
      expect(parseQuickEvent("focus 1pm-3pm", TODAY)?.startMin).toBe(780);
      expect(parseQuickEvent("focus 1pm-3pm", TODAY)?.endMin).toBe(900);
      expect(parseQuickEvent("movie 7–9pm", TODAY)?.startMin).toBe(1140);
      expect(parseQuickEvent("movie 7–9pm", TODAY)?.endMin).toBe(1260);
    });

    it('parses "to" between two times', () => {
      expect(parseQuickEvent("dinner 6pm to 8pm", TODAY)).toEqual({
        title: "dinner",
        date: null,
        startMin: 1080,
        endMin: 1200,
      });
    });

    it("parses 24-hour ranges", () => {
      expect(parseQuickEvent("shift 15:00-16:30", TODAY)?.startMin).toBe(900);
      expect(parseQuickEvent("shift 15:00-16:30", TODAY)?.endMin).toBe(990);
    });

    it("forces end = start + 60 when the computed end is not after the start", () => {
      expect(parseQuickEvent("nap 5-5pm", TODAY)?.startMin).toBe(1020);
      expect(parseQuickEvent("nap 5-5pm", TODAY)?.endMin).toBe(1080);
    });

    it("leaves plain number ranges without any time marker alone", () => {
      expect(parseQuickEvent("review items 3-4", TODAY)).toEqual({
        title: "review items 3-4",
        date: null,
        startMin: null,
        endMin: null,
      });
    });
  });

  describe("durations", () => {
    it('parses "for 45 min" after a start time', () => {
      expect(parseQuickEvent("call mom at 3pm for 45 min", TODAY)).toEqual({
        title: "call mom",
        date: null,
        startMin: 900,
        endMin: 945,
      });
    });

    it("parses minute and hour unit variants", () => {
      expect(parseQuickEvent("focus 9am for 30m", TODAY)?.endMin).toBe(570);
      expect(parseQuickEvent("focus 9am for 30 mins", TODAY)?.endMin).toBe(570);
      expect(parseQuickEvent("workshop 10am for 2 hours", TODAY)?.endMin).toBe(720);
      expect(parseQuickEvent("block 1pm for 1hr", TODAY)?.endMin).toBe(840);
    });

    it('parses fractional hours ("for 1.5h")', () => {
      expect(parseQuickEvent("deep work at 2pm for 1.5h", TODAY)).toEqual({
        title: "deep work",
        date: null,
        startMin: 840,
        endMin: 930,
      });
    });

    it("strips a duration with no start time but leaves times null", () => {
      expect(parseQuickEvent("deep work for 45 min", TODAY)).toEqual({
        title: "deep work",
        date: null,
        startMin: null,
        endMin: null,
      });
    });
  });

  describe("titles and null results", () => {
    it("returns a date-less, time-less parse for plain text", () => {
      expect(parseQuickEvent("buy groceries", TODAY)).toEqual({
        title: "buy groceries",
        date: null,
        startMin: null,
        endMin: null,
      });
    });

    it("keeps date null when only a time is given", () => {
      expect(parseQuickEvent("call mom at 3pm", TODAY)?.date).toBeNull();
    });

    it("combines a date, a time range, and a title", () => {
      expect(parseQuickEvent("1:1 with Ana tomorrow 3pm to 4pm", TODAY)).toEqual({
        title: "1:1 with Ana",
        date: "2026-07-09",
        startMin: 900,
        endMin: 960,
      });
    });

    it("strips a trailing comma left behind by a removed phrase", () => {
      expect(parseQuickEvent("tomorrow, call the bank", TODAY)?.title).toBe("call the bank");
    });

    it("returns null for empty or whitespace-only input", () => {
      expect(parseQuickEvent("", TODAY)).toBeNull();
      expect(parseQuickEvent("   ", TODAY)).toBeNull();
    });

    it("returns null when the phrases leave no title", () => {
      expect(parseQuickEvent("tomorrow 3pm", TODAY)).toBeNull();
      expect(parseQuickEvent("at noon", TODAY)).toBeNull();
    });
  });
});

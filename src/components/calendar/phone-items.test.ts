import { describe, expect, it } from "vitest";

import type { RangeCalendarEvent } from "@/server/calendar";
import type { UserEvent } from "@/server/events";

import {
  buildDayItems,
  clockLabel,
  isHappeningNow,
  markedDays,
  nowDividerIndex,
} from "./phone-items";

const ev = (over: Partial<UserEvent>): UserEvent => ({
  id: "e1",
  title: "Standup",
  localDate: "2026-10-09",
  endLocalDate: null,
  startMin: 540,
  endMin: 570,
  tagId: null,
  notes: null,
  ...over,
});

const task = (
  over: Partial<{ id: string; due: string; remindAt: string | null }>,
) => ({
  id: "t1",
  title: "Task",
  due: "2026-10-09",
  completed: false,
  remindAt: null,
  ...over,
});

describe("clockLabel", () => {
  it("formats 12-hour with a/p", () => {
    expect(clockLabel(0)).toBe("12:00a");
    expect(clockLabel(540)).toBe("9:00a");
    expect(clockLabel(750)).toBe("12:30p");
    expect(clockLabel(19 * 60 + 30)).toBe("7:30p");
  });
});

describe("buildDayItems", () => {
  it("sorts timed rows and splits the all-day / untimed block", () => {
    const events = [
      ev({ id: "b", title: "Lunch", startMin: 720, endMin: 780 }),
      ev({ id: "a", title: "Standup" }),
      ev({ id: "c", title: "Birthday", startMin: null, endMin: null }),
      ev({ id: "x", localDate: "2026-10-10" }),
    ];
    const r = buildDayItems(
      "2026-10-09",
      events,
      [],
      [task({ id: "u" }), task({ id: "k", remindAt: "10:15" })],
    );
    expect(r.top.map((i) => i.key)).toEqual(["u:c", "t:u"]);
    expect(r.timed.map((i) => i.key)).toEqual(["u:a", "t:k", "u:b"]);
    expect(r.eventCount).toBe(3);
    expect(r.taskCount).toBe(2);
  });

  it("treats a multi-day event as all-day on every covered day", () => {
    const e = ev({
      localDate: "2026-10-19",
      endLocalDate: "2026-10-20",
      startMin: null,
      endMin: null,
    });
    expect(buildDayItems("2026-10-20", [e], [], []).top).toHaveLength(1);
    expect(buildDayItems("2026-10-21", [e], [], []).top).toHaveLength(0);
  });

  it("places ICS rows by day and clock", () => {
    const base: RangeCalendarEvent = {
      uid: "u1",
      date: "2026-10-09",
      title: "Vocal",
      startIso: new Date(2026, 9, 9, 11, 30).toISOString(),
      endIso: new Date(2026, 9, 9, 12, 30).toISOString(),
      allDay: false,
      spanStart: "2026-10-09",
      spanEnd: "2026-10-09",
    };
    const r = buildDayItems("2026-10-09", [], [base], []);
    expect(r.timed[0].startMin).toBe(690);
    expect(r.timed[0].endMin).toBe(750);
  });
});

describe("now helpers", () => {
  const items = buildDayItems(
    "2026-10-09",
    [
      ev({ id: "a", startMin: 540, endMin: 570 }),
      ev({ id: "b", startMin: 690, endMin: 750 }),
      ev({ id: "c", startMin: 840, endMin: 900 }),
    ],
    [],
    [],
  ).timed;
  it("finds the divider slot", () => {
    expect(nowDividerIndex(items, 500)).toBe(0);
    expect(nowDividerIndex(items, 700)).toBe(2);
    expect(nowDividerIndex(items, 1000)).toBe(3);
  });
  it("flags the row in progress", () => {
    expect(isHappeningNow(items[1], 700)).toBe(true);
    expect(isHappeningNow(items[1], 750)).toBe(false);
  });
});

describe("markedDays", () => {
  it("marks every covered day of a span", () => {
    const s = markedDays(
      [ev({ localDate: "2026-10-19", endLocalDate: "2026-10-21" })],
      [],
      [task({ due: "2026-10-25" })],
      [{ date: "2026-10-26" }],
    );
    expect([...s].sort()).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-25",
      "2026-10-26",
    ]);
  });
});

import { describe, expect, it } from "vitest";

import type { UserEvent } from "@/server/events";

import {
  applyLocalEventPatch,
  eventsAfterDelete,
  eventsAfterServerRow,
  snapshotAfterServerRow,
} from "./calendar-items";

const ev = (over: Partial<UserEvent>): UserEvent => ({
  id: "s",
  title: "Standup",
  localDate: "2026-10-06",
  endLocalDate: null,
  startMin: 540,
  endMin: 570,
  tagId: null,
  notes: null,
  repeat: "weekly",
  repeatUntil: null,
  seriesStart: "2026-10-06",
  ...over,
});

const series = [
  ev({ id: "s@2026-10-06", localDate: "2026-10-06" }),
  ev({ id: "s@2026-10-13", localDate: "2026-10-13" }),
  ev({ id: "s@2026-10-20", localDate: "2026-10-20" }),
];

describe("eventsAfterDelete", () => {
  it("drops only the touched occurrence when scope is one", () => {
    const next = eventsAfterDelete(series, "s@2026-10-13", "one");
    expect(next.map((e) => e.id)).toEqual(["s@2026-10-06", "s@2026-10-20"]);
  });

  it("drops every occurrence of the series when scope is all", () => {
    const mixed = [
      ...series,
      ev({ id: "other", title: "Other", repeat: null, localDate: "2026-10-13" }),
    ];
    const next = eventsAfterDelete(mixed, "s@2026-10-13", "all");
    expect(next.map((e) => e.id)).toEqual(["other"]);
  });

  it("removes a one-off by id", () => {
    const oneOff = ev({ id: "solo", repeat: null });
    expect(eventsAfterDelete([oneOff], "solo").map((e) => e.id)).toEqual([]);
  });
});

describe("applyLocalEventPatch", () => {
  it("applies a title to every occurrence and keeps occurrence ids and days", () => {
    const next = applyLocalEventPatch(series, "s@2026-10-13", {
      title: "Weekly standup",
    });
    expect(next.map((e) => e.id)).toEqual(series.map((e) => e.id));
    expect(next.map((e) => e.localDate)).toEqual(series.map((e) => e.localDate));
    expect(next.every((e) => e.title === "Weekly standup")).toBe(true);
  });

  it("moves only the touched occurrence's day", () => {
    const next = applyLocalEventPatch(series, "s@2026-10-13", {
      localDate: "2026-10-14",
    });
    expect(next.map((e) => e.localDate)).toEqual([
      "2026-10-06",
      "2026-10-14",
      "2026-10-20",
    ]);
    expect(next.map((e) => e.id)).toEqual(series.map((e) => e.id));
  });

  it("shifts a multi-day span with the touched occurrence", () => {
    const span = ev({
      id: "s@2026-10-13",
      localDate: "2026-10-13",
      endLocalDate: "2026-10-15",
    });
    const [next] = applyLocalEventPatch([span], "s@2026-10-13", {
      localDate: "2026-10-14",
    });
    expect(next.localDate).toBe("2026-10-14");
    expect(next.endLocalDate).toBe("2026-10-16");
  });
});

describe("eventsAfterServerRow", () => {
  it("does not replace an occurrence with the stored series row", () => {
    const row = ev({
      id: "s",
      title: "Weekly standup",
      localDate: "2026-10-06",
      seriesStart: "2026-10-06",
    });
    const next = eventsAfterServerRow(series, "s@2026-10-13", row);
    expect(next.map((e) => e.id)).toEqual(series.map((e) => e.id));
    expect(next.map((e) => e.localDate)).toEqual(series.map((e) => e.localDate));
    expect(next.every((e) => e.title === "Weekly standup")).toBe(true);
    expect(next.every((e) => e.seriesStart === "2026-10-06")).toBe(true);
  });

  it("replaces a one-off with the returned row", () => {
    const oneOff = ev({ id: "solo", title: "Old", repeat: null });
    const row = ev({ id: "solo", title: "New", repeat: null });
    const next = eventsAfterServerRow([oneOff], "solo", row);
    expect(next).toEqual([row]);
  });
});

describe("snapshotAfterServerRow", () => {
  it("keeps the occurrence id and day when the server returns the series row", () => {
    const snapshot = series[1];
    const row = ev({
      id: "s",
      title: "Weekly standup",
      localDate: "2026-10-06",
      startMin: 600,
      endMin: 630,
    });
    const next = snapshotAfterServerRow(snapshot, row);
    expect(next.id).toBe("s@2026-10-13");
    expect(next.localDate).toBe("2026-10-13");
    expect(next.title).toBe("Weekly standup");
    expect(next.startMin).toBe(600);
    expect(next.endMin).toBe(630);
  });
});

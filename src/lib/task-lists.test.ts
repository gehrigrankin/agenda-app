import { describe, expect, it } from "vitest";

import {
  groupTasks,
  inSmartList,
  inView,
  isTaskView,
  quickAddDefaults,
  smartListCounts,
  subjectOf,
  type ListTaskLike,
} from "./task-lists";

const TODAY = "2026-10-09";
const MATH = { id: "m", name: "Math", color: "#9CC5AC" };
const URGENT = { id: "u", name: "urgent", color: "#ef4444" };
const PLAIN = { id: "p", name: "calls", color: null };

function task(over: Partial<ListTaskLike> = {}): ListTaskLike {
  return {
    id: Math.random().toString(36).slice(2),
    title: "t",
    due: null,
    time: null,
    important: false,
    someday: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    completedAt: null,
    boardTitle: null,
    tags: [],
    ...over,
  };
}

describe("smart lists", () => {
  it("Inbox is undated, untagged and not parked", () => {
    expect(inSmartList(task(), "inbox", TODAY)).toBe(true);
    expect(inSmartList(task({ tags: [PLAIN] }), "inbox", TODAY)).toBe(false);
    expect(inSmartList(task({ someday: true }), "inbox", TODAY)).toBe(false);
    expect(inSmartList(task({ due: TODAY }), "inbox", TODAY)).toBe(false);
  });

  it("Today holds today and everything overdue; Upcoming the rest", () => {
    expect(inSmartList(task({ due: TODAY }), "today", TODAY)).toBe(true);
    expect(inSmartList(task({ due: "2026-10-01" }), "today", TODAY)).toBe(true);
    expect(inSmartList(task({ due: "2026-10-10" }), "today", TODAY)).toBe(
      false,
    );
    expect(inSmartList(task({ due: "2026-10-10" }), "upcoming", TODAY)).toBe(
      true,
    );
  });

  it("Anytime includes tagged undated tasks but not parked ones", () => {
    expect(inSmartList(task({ tags: [PLAIN] }), "anytime", TODAY)).toBe(true);
    expect(inSmartList(task({ someday: true }), "anytime", TODAY)).toBe(false);
    expect(inSmartList(task({ someday: true }), "someday", TODAY)).toBe(true);
  });

  it("counts each list independently", () => {
    const counts = smartListCounts(
      [task(), task({ due: TODAY }), task({ someday: true, tags: [PLAIN] })],
      TODAY,
    );
    expect(counts).toEqual({
      inbox: 1,
      today: 1,
      upcoming: 0,
      anytime: 1,
      someday: 1,
    });
  });
});

describe("subjects and views", () => {
  it("a subject is the first palette-colored tag", () => {
    expect(subjectOf({ tags: [PLAIN, URGENT, MATH] })).toBe(MATH);
    expect(subjectOf({ tags: [URGENT] })).toBeNull();
  });

  it("subject, tag, folder and range views", () => {
    const t = task({ tags: [MATH], boardTitle: "Q3", due: "2026-10-12" });
    expect(inView(t, { kind: "subject", id: "m" }, TODAY)).toBe(true);
    expect(inView(t, { kind: "tag", id: "p" }, TODAY)).toBe(false);
    expect(inView(t, { kind: "folder", title: "Q3" }, TODAY)).toBe(true);
    expect(
      inView(t, { kind: "range", start: null, end: "2026-10-12" }, TODAY),
    ).toBe(true);
    expect(
      inView(
        t,
        { kind: "range", start: "2026-10-13", end: "2026-10-14" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("validates stored views", () => {
    expect(isTaskView({ kind: "smart", id: "today" })).toBe(true);
    expect(isTaskView({ kind: "smart", id: "nope" })).toBe(false);
    expect(isTaskView({ kind: "range", start: null, end: "2026-10-01" })).toBe(
      true,
    );
    expect(isTaskView(null)).toBe(false);
  });
});

describe("groupTasks", () => {
  it("splits Today into overdue (important / calm), day and evening", () => {
    const groups = groupTasks(
      [
        task({ title: "late!", due: "2026-10-01", important: true }),
        task({ title: "late", due: "2026-10-02" }),
        task({ title: "now", due: TODAY }),
        task({ title: "night", due: TODAY, time: "19:00" }),
        task({ title: "five", due: TODAY, time: "17:00" }),
      ],
      { kind: "smart", id: "today" },
      TODAY,
      "default",
    );
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.title)])).toEqual([
      ["Overdue", ["late!"]],
      ["Carried over", ["late"]],
      ["Today", ["now", "five"]],
      ["This evening", ["night"]],
    ]);
  });

  it("leaves today's first group unlabeled when nothing is overdue", () => {
    const groups = groupTasks(
      [task({ due: TODAY })],
      { kind: "smart", id: "today" },
      TODAY,
      "default",
    );
    expect(groups[0].label).toBeNull();
  });

  it("groups Upcoming by day and flattens on a custom sort", () => {
    const rows = [
      task({ title: "b", due: "2026-10-11" }),
      task({ title: "a", due: "2026-10-10" }),
      task({ title: "c", due: "2026-10-10" }),
    ];
    const view = { kind: "smart", id: "upcoming" } as const;
    const groups = groupTasks(rows, view, TODAY, "default");
    expect(groups.map((g) => g.label)).toEqual(["Tomorrow", "Sun, Oct 11"]);
    const flat = groupTasks(rows, view, TODAY, "title");
    expect(flat).toHaveLength(1);
    expect(flat[0].tasks.map((t) => t.title)).toEqual(["a", "b", "c"]);
  });
});

describe("quickAddDefaults", () => {
  it("lands a new task in the list it was typed into", () => {
    expect(quickAddDefaults({ kind: "smart", id: "today" }, TODAY)).toEqual({
      due: TODAY,
      someday: false,
      tagId: null,
    });
    expect(
      quickAddDefaults({ kind: "smart", id: "someday" }, TODAY)?.someday,
    ).toBe(true);
    expect(quickAddDefaults({ kind: "subject", id: "m" }, TODAY)?.tagId).toBe(
      "m",
    );
    expect(
      quickAddDefaults({ kind: "smart", id: "logbook" }, TODAY),
    ).toBeNull();
  });
});

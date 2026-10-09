import { describe, expect, it } from "vitest";

import {
  buildSpread,
  spreadSubjects,
  type SpreadDay,
  type SpreadSubject,
} from "./agenda-spread";

const math: SpreadSubject = { id: "math", name: "Math", color: "#111" };
const art: SpreadSubject = { id: "art", name: "Art", color: "#222" };
const gym: SpreadSubject = { id: "gym", name: "Gym", color: null };

function task(
  id: string,
  tags: string[],
  extra: Partial<{ done: boolean; late: boolean; carried: boolean }> = {},
) {
  return {
    id,
    title: id,
    done: false,
    late: false,
    carried: false,
    tags: tags.map((t) => ({ id: t })),
    ...extra,
  };
}

function event(key: string, startMin: number | null, tagId: string | null) {
  return { key, title: key, startMin, tagId };
}

describe("spreadSubjects", () => {
  it("prints pinned lines first, then subjects used this week", () => {
    const days: SpreadDay[] = [
      { date: "2026-10-05", events: [event("e", null, "gym")], tasks: [task("t", ["art"])] },
    ];
    expect(spreadSubjects([math], [art, gym, math], days).map((s) => s.id)).toEqual([
      "math",
      "art",
      "gym",
    ]);
  });

  it("falls back to the used subjects when nothing is pinned", () => {
    const days: SpreadDay[] = [
      { date: "2026-10-05", events: [], tasks: [task("t", ["gym"])] },
    ];
    expect(spreadSubjects([], [art, gym, math], days).map((s) => s.id)).toEqual(["gym"]);
  });
});

describe("buildSpread", () => {
  it("puts each item in exactly one cell and drops Other when unused", () => {
    const days: SpreadDay[] = [
      {
        date: "2026-10-05",
        events: [event("standup", 570, null), event("quiz", 840, "math")],
        tasks: [task("hw", ["math"]), task("sketch", ["art", "math"])],
      },
    ];
    const { columns, rows } = buildSpread(days, [math, art]);
    expect(columns.map((c) => c.id)).toEqual(["math", "art", "schedule"]);
    expect(rows[0].cells.map((cell) => cell.map((x) => x.title))).toEqual([
      ["quiz", "hw"],
      ["sketch"],
      ["standup"],
    ]);
  });

  it("prints Other only when a task has no subject, and orders a cell events, open, done", () => {
    const days: SpreadDay[] = [
      {
        date: "2026-10-05",
        events: [event("late-ev", 900, "math"), event("early", 480, "math"), event("allday", null, "math")],
        tasks: [task("done", ["math"], { done: true }), task("open", ["math"]), task("loose", [])],
      },
    ];
    const { columns, rows } = buildSpread(days, [math]);
    expect(columns.map((c) => c.id)).toEqual(["math", "schedule", "other"]);
    expect(rows[0].cells[0].map((x) => x.title)).toEqual([
      "allday",
      "early",
      "late-ev",
      "open",
      "done",
    ]);
    expect(rows[0].cells[2].map((x) => x.title)).toEqual(["loose"]);
  });

  it("marks carried and late tasks late only while open", () => {
    const days: SpreadDay[] = [
      {
        date: "2026-10-05",
        events: [],
        tasks: [
          task("c", ["math"], { carried: true }),
          task("cd", ["math"], { carried: true, done: true }),
          task("l", ["math"], { late: true }),
        ],
      },
    ];
    const { rows } = buildSpread(days, [math]);
    const byTitle = Object.fromEntries(rows[0].cells[0].map((x) => [x.title, x.late]));
    expect(byTitle).toEqual({ c: true, cd: false, l: true });
  });
});

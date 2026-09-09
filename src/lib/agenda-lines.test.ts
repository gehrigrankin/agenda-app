import { describe, expect, it } from "vitest";

import { groupIntoLines, minutesToHHMM } from "./agenda-lines";

type Task = { id: string; tags: { id: string }[] };

const task = (id: string, ...tagIds: string[]): Task => ({
  id,
  tags: tagIds.map((tagId) => ({ id: tagId })),
});

const lines = [{ id: "math" }, { id: "history" }, { id: "gym" }];

describe("groupIntoLines", () => {
  it("returns one group per line plus the trailing untagged group", () => {
    const groups = groupIntoLines([], lines);
    expect(groups.map((g) => g.lineId)).toEqual([
      "math",
      "history",
      "gym",
      null,
    ]);
    expect(groups.every((g) => g.tasks.length === 0)).toBe(true);
  });

  it("keeps empty lines rather than dropping them", () => {
    // The blank ruled line is what the user clicks to add — never collapse it.
    const groups = groupIntoLines([task("a", "gym")], lines);
    expect(groups[0]).toEqual({ lineId: "math", tasks: [] });
    expect(groups[1]).toEqual({ lineId: "history", tasks: [] });
    expect(groups[2].tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("always produces the untagged group, even when it stays empty", () => {
    const groups = groupIntoLines([task("a", "math")], lines);
    expect(groups[groups.length - 1]).toEqual({ lineId: null, tasks: [] });
  });

  it("buckets a task by the tag it carries", () => {
    const groups = groupIntoLines(
      [task("a", "math"), task("b", "history"), task("c", "gym")],
      lines,
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["a"]);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["b"]);
    expect(groups[2].tasks.map((t) => t.id)).toEqual(["c"]);
    expect(groups[3].tasks).toEqual([]);
  });

  it("puts a task with two pinned tags on the FIRST line only", () => {
    const groups = groupIntoLines([task("a", "gym", "history")], lines);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["a"]); // history is earlier
    expect(groups[2].tasks).toEqual([]);
    expect(groups[3].tasks).toEqual([]);
    // Exactly once across the whole agenda day.
    expect(groups.reduce((n, g) => n + g.tasks.length, 0)).toBe(1);
  });

  it("uses line order, not tag order on the task", () => {
    const first = groupIntoLines([task("a", "math", "gym")], lines);
    const second = groupIntoLines([task("a", "gym", "math")], lines);
    expect(first[0].tasks.map((t) => t.id)).toEqual(["a"]);
    expect(second[0].tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("sends untagged tasks and unpinned-tag tasks to the trailing group", () => {
    const groups = groupIntoLines([task("a"), task("b", "errands")], lines);
    expect(groups[3].tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("preserves input order inside a group", () => {
    const groups = groupIntoLines(
      [task("a", "math"), task("b", "math"), task("c", "math")],
      lines,
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("puts everything in the untagged group when there are no lines", () => {
    const groups = groupIntoLines([task("a", "math"), task("b")], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].lineId).toBeNull();
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the tasks it buckets", () => {
    const t = task("a", "math");
    const groups = groupIntoLines([t], lines);
    expect(groups[0].tasks[0]).toBe(t);
    expect(t.tags).toEqual([{ id: "math" }]);
  });
});

describe("minutesToHHMM", () => {
  it("formats minutes since midnight as 24h HH:MM", () => {
    expect(minutesToHHMM(540)).toBe("09:00");
    expect(minutesToHHMM(0)).toBe("00:00");
    expect(minutesToHHMM(5)).toBe("00:05");
    expect(minutesToHHMM(755)).toBe("12:35");
    expect(minutesToHHMM(1439)).toBe("23:59");
  });

  it("zero-pads both halves", () => {
    expect(minutesToHHMM(61)).toBe("01:01");
  });

  it("floors fractional minutes and clamps negatives", () => {
    expect(minutesToHHMM(90.9)).toBe("01:30");
    expect(minutesToHHMM(-30)).toBe("00:00");
  });
});

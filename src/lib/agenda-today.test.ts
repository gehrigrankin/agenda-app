import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_MINUTES,
  buildSchedule,
  dayMetaLine,
  dayRel,
  duePill,
  eventPhases,
  focusSummary,
  foldTasks,
  formatClock,
  formatClockInput,
  formatDuration,
  notesSummary,
  orderDayTasks,
  panelDateText,
  parseDurationInput,
  parseTimeInput,
  relativeDayTag,
  scheduleSummary,
  sortEvents,
  taskBlock,
  tasksSummary,
  weekdayIndex,
  wordCount,
  type EventPhase,
} from "./agenda-today";

const ev = (title: string, startMin: number | null, endMin: number | null = null) => ({
  title,
  startMin,
  endMin,
});

describe("parseTimeInput", () => {
  it.each([
    ["2:30", 870],
    ["9a", 540],
    ["4pm", 960],
    ["12a", 0],
    ["12p", 720],
    ["13:00", 780],
    ["7", 1140],
    ["9", 540],
    ["0:30", 30],
    ["9:30 AM", 570],
    ["  8  ", 480],
  ])("parses %j as %i", (raw, min) => {
    expect(parseTimeInput(raw)).toBe(min);
  });

  it("treats an empty or blank field as all-day", () => {
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("  ")).toBeNull();
  });

  it.each(["25", "9:75", "abc", "13pm", "0am", "9:5"])("rejects %j", (raw) => {
    expect(parseTimeInput(raw)).toBe("invalid");
  });
});

describe("formatClock", () => {
  it("formats the clock face without am/pm", () => {
    expect(formatClock(null)).toBe("—");
    expect(formatClock(870)).toBe("2:30");
    expect(formatClock(0)).toBe("12:00");
    expect(formatClock(720)).toBe("12:00");
    expect(formatClock(570)).toBe("9:30");
  });
});

describe("formatClockInput", () => {
  it("is empty for all-day", () => {
    expect(formatClockInput(null)).toBe("");
  });

  it("round-trips through parseTimeInput for every 5 minutes of the day", () => {
    for (let m = 0; m < 1440; m += 5) {
      expect(parseTimeInput(formatClockInput(m))).toBe(m);
    }
  });

  it("always says am or pm", () => {
    expect(formatClockInput(870)).toBe("2:30pm");
    expect(formatClockInput(570)).toBe("9:30am");
    expect(formatClockInput(1080)).toBe("6:00pm");
    expect(formatClockInput(450)).toBe("7:30am");
    expect(formatClockInput(720)).toBe("12:00pm");
    expect(formatClockInput(1200)).toBe("8:00pm");
    expect(formatClockInput(0)).toBe("12:00am");
  });
});

describe("dayRel / relativeDayTag / panelDateText", () => {
  const today = "2025-07-09";
  it("classifies days against today", () => {
    expect(dayRel("2025-07-08", today)).toBe("past");
    expect(dayRel("2025-07-09", today)).toBe("today");
    expect(dayRel("2025-07-10", today)).toBe("future");
  });

  it("tags yesterday, today, tomorrow only", () => {
    expect(relativeDayTag("2025-07-09", today)).toBe("Today");
    expect(relativeDayTag("2025-07-08", today)).toBe("Yesterday");
    expect(relativeDayTag("2025-07-10", today)).toBe("Tomorrow");
    expect(relativeDayTag("2025-07-11", today)).toBeNull();
  });

  it("writes the panel date", () => {
    expect(panelDateText("2025-07-09", today)).toBe("Today");
    expect(panelDateText("2025-07-10", today)).toBe("Tomorrow");
    expect(panelDateText("2025-07-08", today)).toBe("Tue, Jul 8");
  });
});

describe("dayMetaLine / weekdayIndex", () => {
  it("builds the month, week and day-of-year line", () => {
    expect(dayMetaLine("2025-07-09")).toBe("July · Week 28 · day 190");
  });

  it("indexes weekdays from Monday", () => {
    expect(weekdayIndex("2025-07-07")).toBe(0); // Mon
    expect(weekdayIndex("2025-07-09")).toBe(2); // Wed
    expect(weekdayIndex("2025-07-13")).toBe(6); // Sun
  });
});

describe("sortEvents", () => {
  it("puts all-day events first, then orders by start, ties by title", () => {
    const sorted = sortEvents([
      ev("Lunch", 720),
      ev("B", 540),
      ev("All day", null),
      ev("A", 540),
    ]);
    expect(sorted.map((e) => e.title)).toEqual(["All day", "A", "B", "Lunch"]);
  });

  it("does not mutate its input", () => {
    const input = [ev("Z", 600), ev("Y", 500)];
    sortEvents(input);
    expect(input[0].title).toBe("Z");
  });
});

describe("eventPhases", () => {
  const events = [ev("a", 540, 600), ev("b", 660, 720), ev("c", 780, 840)];

  it("marks a past day all past and a future day all later", () => {
    expect(eventPhases(events, "past", 0)).toEqual(["past", "past", "past"]);
    expect(eventPhases(events, "future", 9999)).toEqual(["later", "later", "later"]);
  });

  it("marks the in-progress event now, earlier ones past, rest later", () => {
    expect(eventPhases(events, "today", 670)).toEqual(["past", "now", "later"]);
  });

  it("marks the first upcoming event next when nothing is in progress", () => {
    expect(eventPhases(events, "today", 620)).toEqual(["past", "next", "later"]);
    expect(eventPhases(events, "today", 0)).toEqual(["next", "later", "later"]);
  });

  it("treats an event ending exactly now as past", () => {
    expect(eventPhases(events, "today", 600)[0]).toBe("past");
  });

  it("marks everything past once the day is over", () => {
    expect(eventPhases(events, "today", 900)).toEqual(["past", "past", "past"]);
  });

  it("keeps all-day events later and never highlights them", () => {
    const phases = eventPhases([ev("x", 540, 600), ev("all", null)], "today", 0);
    expect(phases).toEqual(["next", "later"]);
    expect(eventPhases([ev("all", null)], "today", 0)).toEqual(["later"]);
  });

  it("uses 30 minutes when an event has no end", () => {
    const open = [ev("open", 540, null)];
    expect(eventPhases(open, "today", 569)).toEqual(["now"]);
    expect(eventPhases(open, "today", 570)).toEqual(["past"]);
  });
});

describe("duePill", () => {
  const today = "2025-07-09"; // Wednesday
  it("calls an earlier due date LATE on today's page", () => {
    expect(duePill("2025-07-05", today, today, false)).toEqual({
      text: "LATE",
      tone: "late",
    });
  });

  it("shows Today / Due on the task's own day", () => {
    expect(duePill(today, today, today, false)).toEqual({
      text: "Today",
      tone: "today",
    });
    expect(duePill("2025-07-12", "2025-07-12", today, false)).toEqual({
      text: "Due",
      tone: "due",
    });
  });

  it("reads carried tasks as -> TODAY from yesterday's page", () => {
    expect(duePill("2025-07-08", "2025-07-08", today, true)).toEqual({
      text: "→ TODAY",
      tone: "late",
    });
  });

  it("names today's weekday, uppercase, on older pages", () => {
    expect(duePill("2025-07-05", "2025-07-05", today, true)).toEqual({
      text: "→ WED",
      tone: "late",
    });
  });
});

describe("foldTasks", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("does not fold limit + 1 tasks", () => {
    const r = foldTasks(make(5), 4, false);
    expect(r.foldable).toBe(false);
    expect(r.visible).toHaveLength(5);
    expect(r.hidden).toBe(0);
  });

  it("folds past limit + 1", () => {
    const r = foldTasks(make(6), 4, false);
    expect(r.foldable).toBe(true);
    expect(r.visible).toEqual([0, 1, 2, 3]);
    expect(r.hidden).toBe(2);
  });

  it("shows everything when expanded", () => {
    const r = foldTasks(make(6), 4, true);
    expect(r.foldable).toBe(true);
    expect(r.visible).toHaveLength(6);
    expect(r.hidden).toBe(0);
  });
});

describe("wordCount", () => {
  it("counts whitespace-separated words", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   \n ")).toBe(0);
    expect(wordCount("one")).toBe(1);
    expect(wordCount("  two   words\nhere ")).toBe(3);
  });
});

describe("eventPhases with done items", () => {
  it("never highlights a done item; the next one takes it", () => {
    const items = [
      { ...ev("study", 540, 600), done: true },
      { ...ev("lab", 660, 720), done: false },
    ];
    expect(eventPhases(items, "today", 550)).toEqual(["later", "next"]);
    expect(eventPhases(items, "today", 610)).toEqual(["past", "next"]);
  });
});

describe("taskBlock", () => {
  it("has no block without a time", () => {
    expect(taskBlock({ startMin: null, durationMin: 30 })).toBeNull();
  });

  it("uses the duration, else the default length", () => {
    expect(taskBlock({ startMin: 900, durationMin: 45 })).toEqual({
      startMin: 900,
      endMin: 945,
    });
    expect(taskBlock({ startMin: 900, durationMin: null })).toEqual({
      startMin: 900,
      endMin: 900 + DEFAULT_TASK_MINUTES,
    });
  });

  it("stops at midnight", () => {
    expect(taskBlock({ startMin: 1430, durationMin: 60 })?.endMin).toBe(1440);
  });
});

describe("buildSchedule", () => {
  const block = (title: string, startMin: number, endMin: number, done = false) => ({
    title,
    startMin,
    endMin,
    done,
  });

  it("heads with all-day events, then interleaves events and blocks by start", () => {
    const run = buildSchedule(
      [ev("Lunch", 720, 780), ev("Trip", null), ev("Math", 540, 600)],
      [block("Study", 600, 660), block("Call", 480, 495)],
      "future",
      0,
    );
    expect(run.map((r) => `${r.kind}:${r.item.title}`)).toEqual([
      "event:Trip",
      "task:Call",
      "event:Math",
      "task:Study",
      "event:Lunch",
    ]);
  });

  it("puts the event first on a tie", () => {
    const run = buildSchedule([ev("Math", 540, 600)], [block("Study", 540, 555)], "future", 0);
    expect(run.map((r) => r.kind)).toEqual(["event", "task"]);
  });

  it("lets a block be now or next, but not once it's done", () => {
    const events = [ev("Lunch", 720, 780)];
    const open = buildSchedule(events, [block("Study", 600, 660)], "today", 610);
    expect(open.map((r) => r.phase)).toEqual(["now", "later"]);
    const done = buildSchedule(events, [block("Study", 600, 660, true)], "today", 610);
    expect(done.map((r) => r.phase)).toEqual(["later", "next"]);
  });

  it("marks a past day's blocks past", () => {
    const run = buildSchedule([], [block("Study", 600, 660)], "past", 0);
    expect(run[0].phase).toBe("past");
  });
});

describe("parseDurationInput", () => {
  it.each([
    ["45", 45],
    ["45m", 45],
    ["45 min", 45],
    ["90 minutes", 90],
    ["1h", 60],
    ["2 hours", 120],
    ["1.5h", 90],
    ["1h30", 90],
    ["1h 30m", 90],
    ["1:30", 90],
    ["  20M ", 20],
  ])("%s → %d", (raw, mins) => {
    expect(parseDurationInput(raw)).toBe(mins);
  });

  it("reads empty as the default length", () => {
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("   ")).toBeNull();
  });

  it.each(["0", "abc", "h", "1:75", "25h", "-5", "m"])("rejects %s", (raw) => {
    expect(parseDurationInput(raw)).toBe("invalid");
  });
});

describe("formatDuration", () => {
  it("prints minutes, hours, or both", () => {
    expect(formatDuration(15)).toBe("15m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
  });

  it("round-trips through the parser", () => {
    for (const m of [15, 45, 60, 90, 135]) {
      expect(parseDurationInput(formatDuration(m))).toBe(m);
    }
  });
});

describe("orderDayTasks", () => {
  const t = (title: string, startMin: number | null, late = false) => ({
    title,
    startMin,
    late,
  });

  it("puts timed tasks first in time order, the rest as they came", () => {
    const ordered = orderDayTasks([
      t("late", null, true),
      t("untimed", null),
      t("4pm", 960),
      t("9am", 540),
    ]);
    expect(ordered.map((x) => x.title)).toEqual(["9am", "4pm", "late", "untimed"]);
  });

  it("treats a late task's old time as untimed", () => {
    const ordered = orderDayTasks([t("a", null), t("late, was 9am", 540, true)]);
    expect(ordered.map((x) => x.title)).toEqual(["a", "late, was 9am"]);
  });
});

describe("scheduleSummary", () => {
  it("says so when nothing is scheduled", () => {
    expect(scheduleSummary([], [])).toEqual([
      { text: "Nothing scheduled", tone: "muted" },
    ]);
  });

  it("counts events and pluralizes", () => {
    const one = [ev("Math", 540, 600)];
    expect(scheduleSummary(one, ["past"])[0].text).toBe("1 event");
    const four = [1, 2, 3, 4].map((i) => ev(`e${i}`, i * 60, i * 60 + 30));
    expect(scheduleSummary(four, ["past", "past", "past", "past"])[0].text).toBe(
      "4 events",
    );
  });

  it("points at the event on now", () => {
    const sorted = [ev("Math", 540, 600)];
    expect(scheduleSummary(sorted, ["now"])).toEqual([
      { text: "1 event", tone: "neutral" },
      { text: "Now · Math", tone: "now" },
    ]);
  });

  it("points at the next event with its clock time", () => {
    const sorted = [ev("Math", 540, 600)];
    expect(scheduleSummary(sorted, ["next"])[1]).toEqual({
      text: "9:00 Math",
      tone: "now",
    });
  });

  it("falls back to the first later event, bare for all-day", () => {
    expect(scheduleSummary([ev("Trip", null)], ["later"])[1].text).toBe("Trip");
    expect(scheduleSummary([ev("Math", 540)], ["later"])[1].text).toBe("9:00 Math");
  });

  it("counts task blocks separately from events", () => {
    const run = [ev("Math", 540, 600), { ...ev("Study", 600, 660), kind: "task" as const }];
    expect(scheduleSummary(run, ["past", "past"]).map((c) => c.text)).toEqual([
      "1 event",
      "1 task",
    ]);
    const blocksOnly = [{ ...ev("Study", 600, 660), kind: "task" as const }];
    expect(scheduleSummary(blocksOnly, ["next"]).map((c) => c.text)).toEqual([
      "1 task",
      "10:00 Study",
    ]);
  });

  it("adds no highlight chip when every event is past", () => {
    expect(scheduleSummary([ev("Math", 540)], ["past"])).toHaveLength(1);
  });
});

describe("tasksSummary", () => {
  const t = (title: string, done = false, late = false) => ({ title, done, late });

  it("handles an empty day", () => {
    expect(tasksSummary([], "today")).toEqual([
      { text: "Nothing due", tone: "muted" },
    ]);
    expect(tasksSummary([], "past")[0].text).toBe("Nothing was due");
  });

  it("counts done out of total", () => {
    const chips = tasksSummary([t("a", false, false)], "today");
    expect(chips[0]).toEqual({ text: "0/1 done", tone: "neutral" });
    expect(tasksSummary([t("a"), t("b"), t("c")], "today")[0].text).toBe("0/3 done");
  });

  it("counts open late tasks as late, or carried on past days", () => {
    const tasks = [t("a", false, true), t("b", true, true)];
    expect(tasksSummary(tasks, "today")[1]).toEqual({ text: "1 late", tone: "late" });
    expect(tasksSummary(tasks, "past")[1]).toEqual({ text: "1 carried", tone: "late" });
  });

  it("names the first open non-late task", () => {
    const chips = tasksSummary([t("late", false, true), t("done", true), t("next")], "today");
    expect(chips[chips.length - 1]).toEqual({ text: "next", tone: "text" });
  });

  it("omits the title chip when every open task is late", () => {
    const chips = tasksSummary([t("late", false, true)], "today");
    expect(chips.map((c) => c.tone)).toEqual(["neutral", "late"]);
  });
});

describe("notesSummary", () => {
  it("is Empty for blank text", () => {
    expect(notesSummary("  ")).toEqual([{ text: "Empty", tone: "muted" }]);
  });

  it("shows the word count and the trimmed text", () => {
    const words = Array.from({ length: 19 }, (_, i) => `w${i}`).join(" ");
    expect(notesSummary(` ${words} `)).toEqual([
      { text: "19 words", tone: "neutral" },
      { text: words, tone: "text" },
    ]);
    expect(notesSummary("hello")[0].text).toBe("1 word");
  });
});

describe("focusSummary", () => {
  const t = (title: string, done = false, late = false) => ({ title, done, late });
  const sorted = [ev("Math", 540, 600)];

  it("says Nothing on for an empty day", () => {
    expect(focusSummary([], [], [], "today")).toEqual([
      { text: "Nothing on", tone: "muted" },
    ]);
  });

  it("lists event, late and due chips in order", () => {
    const chips = focusSummary(
      sorted,
      ["next"] as EventPhase[],
      [t("a", false, true), t("b"), t("c"), t("d", true)],
      "today",
    );
    expect(chips.map((c) => c.text)).toEqual(["9:00 Math", "1 late", "2 due"]);
  });

  it("hides the event chip on past days and says carried", () => {
    const chips = focusSummary(sorted, ["later"], [t("a", false, true)], "past");
    expect(chips.map((c) => c.text)).toEqual(["1 carried"]);
  });

  it("falls back to Nothing on when everything is done", () => {
    expect(focusSummary([], [], [t("a", true)], "today")[0].text).toBe("Nothing on");
  });
});

import { describe, expect, it } from "vitest";
import {
  dayMetaLine,
  dayRel,
  duePill,
  eventPhases,
  focusSummary,
  foldTasks,
  formatClock,
  formatClockInput,
  notesSummary,
  panelDateText,
  parseTimeInput,
  relativeDayTag,
  scheduleSummary,
  sortEvents,
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

  it("adds a suffix only where the bare face would misparse", () => {
    expect(formatClockInput(870)).toBe("2:30");
    expect(formatClockInput(570)).toBe("9:30");
    expect(formatClockInput(450)).toBe("7:30am");
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
  it("orders by start with all-day events last, ties by title", () => {
    const sorted = sortEvents([
      ev("All day", null),
      ev("Lunch", 720),
      ev("B", 540),
      ev("A", 540),
    ]);
    expect(sorted.map((e) => e.title)).toEqual(["A", "B", "Lunch", "All day"]);
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

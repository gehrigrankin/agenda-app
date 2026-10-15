import { describe, expect, it } from "vitest";

import {
  domainOf,
  folderLabel,
  inSourceView,
  matchPerson,
  receivedLabel,
  snoozePresets,
} from "./inbox-triage";

describe("inSourceView", () => {
  it("maps sources to the sidebar views", () => {
    expect(inSourceView("email", "email")).toBe(true);
    expect(inSourceView("link", "clips")).toBe(true);
    expect(inSourceView("photo", "shared")).toBe(true);
    expect(inSourceView("text", "shared")).toBe(true);
    expect(inSourceView("voice", "voice")).toBe(true);
    expect(inSourceView("voice", "email")).toBe(false);
    expect(inSourceView("voice", "all")).toBe(true);
    expect(inSourceView("email", "filed")).toBe(false);
  });
});

describe("snoozePresets", () => {
  it("snoozes to tomorrow 8:00 local", () => {
    const now = new Date(2026, 9, 9, 14, 30);
    const tomorrow = snoozePresets(now).find((p) => p.id === "tomorrow")!;
    expect(tomorrow.until).toEqual(new Date(2026, 9, 10, 8, 0));
  });
  it("lands next week on a Monday at 8:00", () => {
    for (let day = 4; day <= 11; day++) {
      const now = new Date(2026, 9, day, 10, 0);
      const week = snoozePresets(now).find((p) => p.id === "week")!.until;
      expect(week.getDay()).toBe(1);
      expect(week.getHours()).toBe(8);
      expect(week.getTime()).toBeGreaterThan(now.getTime());
      expect(week.getTime() - now.getTime()).toBeLessThanOrEqual(
        7 * 86_400_000,
      );
    }
  });
  it("later today is three hours out", () => {
    const now = new Date(2026, 9, 9, 9, 0);
    expect(snoozePresets(now)[0].until.getTime() - now.getTime()).toBe(
      3 * 3_600_000,
    );
  });
});

describe("receivedLabel", () => {
  const now = new Date(2026, 9, 9, 15, 0);
  it("is a clock time for today", () => {
    expect(
      receivedLabel(new Date(2026, 9, 9, 8, 12).toISOString(), now),
    ).toMatch(/8:12/);
  });
  it("says Yesterday and then the date", () => {
    expect(
      receivedLabel(new Date(2026, 9, 8, 8, 12).toISOString(), now),
    ).toMatch(/^Yesterday/);
    expect(
      receivedLabel(new Date(2026, 9, 3, 8, 12).toISOString(), now),
    ).toMatch(/^Oct 3/);
  });
});

describe("matchPerson", () => {
  const people = [{ name: "Sam" }, { name: "Priya" }];
  it("matches whole words only", () => {
    expect(matchPerson("Fwd: same time Sam?", people)?.name).toBe("Sam");
    expect(matchPerson("the same old story", people)).toBeNull();
    expect(matchPerson("lunch with priya", people)?.name).toBe("Priya");
  });
});

describe("domainOf / folderLabel", () => {
  it("extracts the host", () => {
    expect(domainOf("https://www.jazzadvice.com/x")).toBe("jazzadvice.com");
    expect(domainOf("nope")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });
  it("strips the legacy verb", () => {
    expect(folderLabel(null, "File to Reading list")).toBe("Reading list");
    expect(folderLabel("Music", "File to Music")).toBe("Music");
    expect(folderLabel(null, null)).toBeNull();
  });
});

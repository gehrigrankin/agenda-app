import { describe, expect, it } from "vitest";
import {
  SUBJECT_COLORS,
  SUBJECT_FALLBACK,
  isSubjectColor,
  nextSubjectColor,
  subjectColor,
} from "./subjects";

describe("isSubjectColor", () => {
  it("accepts palette colors only", () => {
    expect(isSubjectColor(SUBJECT_COLORS[0])).toBe(true);
    expect(isSubjectColor("#000000")).toBe(false);
    expect(isSubjectColor(null)).toBe(false);
    expect(isSubjectColor(42)).toBe(false);
  });
});

describe("nextSubjectColor", () => {
  it("starts with the first palette color", () => {
    expect(nextSubjectColor([])).toBe(SUBJECT_COLORS[0]);
  });

  it("takes the first unused color, ignoring nulls", () => {
    expect(nextSubjectColor([SUBJECT_COLORS[0], null, SUBJECT_COLORS[2]])).toBe(
      SUBJECT_COLORS[1],
    );
  });

  it("matches used colors case-insensitively", () => {
    expect(nextSubjectColor([SUBJECT_COLORS[0].toLowerCase()])).toBe(
      SUBJECT_COLORS[1],
    );
  });

  it("cycles by count once every color is used", () => {
    const all = [...SUBJECT_COLORS];
    expect(nextSubjectColor(all)).toBe(SUBJECT_COLORS[0]);
    expect(nextSubjectColor([...all, "#123456"])).toBe(SUBJECT_COLORS[1]);
  });
});

describe("subjectColor", () => {
  it("falls back when there is no color", () => {
    expect(subjectColor(null)).toBe(SUBJECT_FALLBACK);
    expect(subjectColor(undefined)).toBe(SUBJECT_FALLBACK);
    expect(subjectColor("")).toBe(SUBJECT_FALLBACK);
    expect(subjectColor("#abcdef")).toBe("#abcdef");
  });
});

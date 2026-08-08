import { describe, expect, it } from "vitest";
import { isValidTagName, normalizeTagName, parseHashtags } from "./hashtags";

// "café" written out as e + U+0301, i.e. the decomposed form a keyboard or a
// paste from another app can easily produce.
const CAFE_NFD = "café";

describe("parseHashtags", () => {
  it("leaves a tagless title alone", () => {
    expect(parseHashtags("call the dentist")).toEqual({
      title: "call the dentist",
      tags: [],
    });
  });

  it("pulls a trailing tag off the title", () => {
    expect(parseHashtags("call the dentist #health")).toEqual({
      title: "call the dentist",
      tags: ["health"],
    });
  });

  it("pulls multiple trailing tags, in order", () => {
    expect(parseHashtags("call the dentist #health #errands")).toEqual({
      title: "call the dentist",
      tags: ["health", "errands"],
    });
  });

  it("pulls tags from the middle and the front", () => {
    expect(parseHashtags("book #travel flights for June")).toEqual({
      title: "book flights for June",
      tags: ["travel"],
    });
    expect(parseHashtags("#work draft the deck")).toEqual({
      title: "draft the deck",
      tags: ["work"],
    });
    expect(parseHashtags("#work draft the #q3 deck #urgent")).toEqual({
      title: "draft the deck",
      tags: ["work", "q3", "urgent"],
    });
  });

  it("accepts digits, hyphens and underscores in names", () => {
    expect(parseHashtags("ship it #v2 #side-project #deep_work")).toEqual({
      title: "ship it",
      tags: ["v2", "side-project", "deep_work"],
    });
  });

  it("dedupes tags differing only in case, keeping first appearance order", () => {
    expect(parseHashtags("email #Work then call #home again #work")).toEqual({
      title: "email then call again",
      tags: ["work", "home"],
    });
  });

  it("ignores a # that does not open a word", () => {
    // The boundary rule: only start-of-input or post-whitespace "#" counts.
    expect(parseHashtags("learn C#")).toEqual({ title: "learn C#", tags: [] });
    expect(parseHashtags("fix issue#42")).toEqual({
      title: "fix issue#42",
      tags: [],
    });
  });

  it("ignores a markdown-style ##heading entirely", () => {
    // The first "#" has an empty body (the next char is "#"), and the second
    // "#" isn't preceded by whitespace — so neither one is a tag.
    expect(parseHashtags("##heading")).toEqual({
      title: "##heading",
      tags: [],
    });
    expect(parseHashtags("write ##heading today")).toEqual({
      title: "write ##heading today",
      tags: [],
    });
  });

  it("ignores a bare # with no name", () => {
    expect(parseHashtags("rank the # of items")).toEqual({
      title: "rank the # of items",
      tags: [],
    });
    expect(parseHashtags("#")).toEqual({ title: "#", tags: [] });
  });

  it("accepts unicode letters in names", () => {
    expect(parseHashtags("meet Ana #café")).toEqual({
      title: "meet Ana",
      tags: ["café"],
    });
    expect(parseHashtags("study #日本語 tonight")).toEqual({
      title: "study tonight",
      tags: ["日本語"],
    });
    // A decomposed name keeps its combining mark instead of being cut at the
    // base letter.
    expect(parseHashtags(`meet Ana #${CAFE_NFD}`)).toEqual({
      title: "meet Ana",
      tags: [CAFE_NFD],
    });
  });

  it("does not treat emoji as a tag name", () => {
    expect(parseHashtags("party #🎉")).toEqual({
      title: "party #🎉",
      tags: [],
    });
  });

  it("keeps punctuation that follows a tag, with no stray space", () => {
    expect(parseHashtags("pay rent #home, then relax")).toEqual({
      title: "pay rent, then relax",
      tags: ["home"],
    });
    expect(parseHashtags("call mom #family. then sleep")).toEqual({
      title: "call mom. then sleep",
      tags: ["family"],
    });
  });

  it("stops a name at punctuation stuck to its end", () => {
    expect(parseHashtags("done #home.")).toEqual({
      title: "done.",
      tags: ["home"],
    });
    expect(parseHashtags("wrap up #home!")).toEqual({
      title: "wrap up!",
      tags: ["home"],
    });
  });

  it("returns an empty title for a tags-only input", () => {
    expect(parseHashtags("#health")).toEqual({ title: "", tags: ["health"] });
    expect(parseHashtags("#health #errands")).toEqual({
      title: "",
      tags: ["health", "errands"],
    });
    expect(parseHashtags("  #health  ")).toEqual({
      title: "",
      tags: ["health"],
    });
  });

  it("handles the empty string", () => {
    expect(parseHashtags("")).toEqual({ title: "", tags: [] });
    expect(parseHashtags("   ")).toEqual({ title: "", tags: [] });
  });

  it("collapses extra internal whitespace in the title", () => {
    expect(parseHashtags("  call   the  dentist   #health  ")).toEqual({
      title: "call the dentist",
      tags: ["health"],
    });
    expect(parseHashtags("call\tthe\ndentist #health")).toEqual({
      title: "call the dentist",
      tags: ["health"],
    });
    expect(parseHashtags("book  #travel  flights")).toEqual({
      title: "book flights",
      tags: ["travel"],
    });
  });

  it("parses a tag opened by a newline, not just a space", () => {
    expect(parseHashtags("notes\n#ideas")).toEqual({
      title: "notes",
      tags: ["ideas"],
    });
  });

  it("parses an over-length name rather than dropping it (callers validate)", () => {
    const long = "a".repeat(40);
    expect(parseHashtags(`plan #${long}`)).toEqual({
      title: "plan",
      tags: [long],
    });
    expect(isValidTagName(long)).toBe(false);
  });
});

describe("normalizeTagName", () => {
  it("strips a leading #", () => {
    expect(normalizeTagName("#health")).toBe("health");
    expect(normalizeTagName("health")).toBe("health");
  });

  it("strips only the first #", () => {
    expect(normalizeTagName("##health")).toBe("#health");
  });

  it("trims and lowercases", () => {
    expect(normalizeTagName("  #Health  ")).toBe("health");
    expect(normalizeTagName("DEEP_WORK")).toBe("deep_work");
    expect(normalizeTagName("CafÉ")).toBe("café");
  });

  it("collapses internal whitespace to hyphens", () => {
    expect(normalizeTagName("side project")).toBe("side-project");
    expect(normalizeTagName("#Deep  Work  Time")).toBe("deep-work-time");
    expect(normalizeTagName("deep\twork")).toBe("deep-work");
  });

  it("is idempotent", () => {
    for (const s of ["#Health", "  side project ", "日本語", "v2"]) {
      const once = normalizeTagName(s);
      expect(normalizeTagName(once)).toBe(once);
    }
  });

  it("returns an empty string for empty-ish input", () => {
    expect(normalizeTagName("")).toBe("");
    expect(normalizeTagName("   ")).toBe("");
    expect(normalizeTagName("#")).toBe("");
  });
});

describe("isValidTagName", () => {
  it("accepts letters, digits, hyphens and underscores", () => {
    expect(isValidTagName("health")).toBe(true);
    expect(isValidTagName("v2")).toBe(true);
    expect(isValidTagName("side-project")).toBe(true);
    expect(isValidTagName("deep_work")).toBe(true);
  });

  it("accepts names it can normalize into shape", () => {
    expect(isValidTagName("#Health")).toBe(true);
    expect(isValidTagName("  Side Project ")).toBe(true);
  });

  it("accepts unicode names, composed or decomposed", () => {
    expect(isValidTagName("café")).toBe(true);
    expect(isValidTagName("日本語")).toBe(true);
    expect(isValidTagName(CAFE_NFD)).toBe(true);
  });

  it("rejects empty-ish names", () => {
    expect(isValidTagName("")).toBe(false);
    expect(isValidTagName("   ")).toBe(false);
    expect(isValidTagName("#")).toBe(false);
  });

  it("rejects punctuation, stray hashes and emoji", () => {
    expect(isValidTagName("home.work")).toBe(false);
    expect(isValidTagName("a,b")).toBe(false);
    expect(isValidTagName("a/b")).toBe(false);
    expect(isValidTagName("a(b)")).toBe(false);
    expect(isValidTagName("a'b")).toBe(false);
    expect(isValidTagName("##health")).toBe(false);
    expect(isValidTagName("🎉")).toBe(false);
  });

  it("caps the name at 32 characters", () => {
    expect(isValidTagName("a".repeat(32))).toBe(true);
    expect(isValidTagName("a".repeat(33))).toBe(false);
    // Measured after normalizing: the "#" and the outer spaces don't count,
    // but the hyphen an internal space becomes does.
    expect(isValidTagName(`#  ${"a".repeat(32)}  `)).toBe(true);
    expect(isValidTagName(`${"a".repeat(31)} b`)).toBe(false);
  });

  it("agrees with parseHashtags on the tags it produces", () => {
    const { tags } = parseHashtags(
      "ship #v2 #side-project #café #日本語",
    );
    expect(tags).toEqual(["v2", "side-project", "café", "日本語"]);
    expect(tags.every(isValidTagName)).toBe(true);
  });
});

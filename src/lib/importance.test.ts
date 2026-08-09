import { describe, expect, it } from "vitest";
import { parseImportantMark } from "./importance";

describe("parseImportantMark", () => {
  it("leaves a plain title alone", () => {
    expect(parseImportantMark("call the dentist")).toEqual({
      title: "call the dentist",
      important: false,
    });
  });

  it("flags a trailing marker and cuts it out", () => {
    expect(parseImportantMark("call the dentist !")).toEqual({
      title: "call the dentist",
      important: true,
    });
  });

  it("flags a leading marker", () => {
    expect(parseImportantMark("! call the dentist")).toEqual({
      title: "call the dentist",
      important: true,
    });
  });

  it("flags a marker mid-string and closes the gap", () => {
    expect(parseImportantMark("pay rent ! before friday")).toEqual({
      title: "pay rent before friday",
      important: true,
    });
  });

  it("treats repeated markers as one flag", () => {
    expect(parseImportantMark("! call mom !")).toEqual({
      title: "call mom",
      important: true,
    });
  });

  it("ignores punctuation attached to a word", () => {
    expect(parseImportantMark("ship it!")).toEqual({
      title: "ship it!",
      important: false,
    });
    expect(parseImportantMark("!important css")).toEqual({
      title: "!important css",
      important: false,
    });
    expect(parseImportantMark("wat!?")).toEqual({
      title: "wat!?",
      important: false,
    });
  });

  it("ignores a doubled bang token", () => {
    expect(parseImportantMark("hurry !! now")).toEqual({
      title: "hurry !! now",
      important: false,
    });
  });

  it("leaves an empty title for a marker-only input", () => {
    expect(parseImportantMark("!")).toEqual({ title: "", important: true });
  });

  it("composes with hashtag text left in place", () => {
    // parseHashtags runs separately; the marker parser must not eat "#tag".
    expect(parseImportantMark("call the dentist #health !")).toEqual({
      title: "call the dentist #health",
      important: true,
    });
  });
});

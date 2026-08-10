import type { SerializedEditorState, SerializedLexicalNode } from "lexical";
import { describe, expect, it } from "vitest";

import {
  CARD_ANCHOR_TYPE,
  appendCardAnchor,
  cardAnchorSectionBlocks,
  cardAnchorSectionRange,
  findCardAnchorIndex,
  isBlankBlocks,
  pruneEmptyCardAnchor,
  replaceCardAnchorSection,
} from "./card-anchors";

// Serialized trees built by hand — the module only reads `type`, `anchorId`
// and `children`, so plain objects are enough.

type Node = {
  type: string;
  anchorId?: unknown;
  text?: string;
  children?: Node[];
};

const text = (t: string): Node => ({ type: "text", text: t });
const para = (t: string): Node => ({ type: "paragraph", children: [text(t)] });
const heading = (t: string): Node => ({ type: "heading", children: [text(t)] });
const anchor = (id: unknown): Node => ({ type: CARD_ANCHOR_TYPE, anchorId: id });

function doc(children: Node[]): SerializedEditorState {
  return {
    root: {
      type: "root",
      children,
      direction: null,
      format: "",
      indent: 0,
      version: 1,
    },
  } as unknown as SerializedEditorState;
}

const blocks = (state: SerializedEditorState): Node[] =>
  (state as unknown as { root: { children: Node[] } }).root.children;

describe("findCardAnchorIndex", () => {
  it("finds an anchor by id", () => {
    const state = doc([para("intro"), anchor("a1"), para("under a1")]);
    expect(findCardAnchorIndex(state, "a1")).toBe(1);
  });

  it("returns -1 for an id that isn't there", () => {
    expect(findCardAnchorIndex(doc([anchor("a1")]), "nope")).toBe(-1);
  });

  // A blank id is how a broken anchor serializes; matching "" against "" would
  // scope one broken card to another broken card's section.
  it("never matches a blank or non-string id", () => {
    const state = doc([anchor(""), anchor("   "), anchor(undefined)]);
    expect(findCardAnchorIndex(state, "")).toBe(-1);
    expect(findCardAnchorIndex(state, "   ")).toBe(-1);
    expect(findCardAnchorIndex(state, undefined as unknown as string)).toBe(-1);
  });

  it("tolerates malformed states rather than throwing", () => {
    expect(findCardAnchorIndex(null, "a1")).toBe(-1);
    expect(findCardAnchorIndex(undefined, "a1")).toBe(-1);
    expect(findCardAnchorIndex({} as SerializedEditorState, "a1")).toBe(-1);
    expect(
      findCardAnchorIndex(
        { root: { children: "not an array" } } as unknown as SerializedEditorState,
        "a1",
      ),
    ).toBe(-1);
  });
});

describe("cardAnchorSectionRange", () => {
  it("owns every block up to the next anchor", () => {
    const state = doc([
      para("before"),
      anchor("a1"),
      para("mine 1"),
      para("mine 2"),
      anchor("a2"),
      para("theirs"),
    ]);
    expect(cardAnchorSectionRange(state, "a1")).toEqual({ start: 2, end: 4 });
    expect(cardAnchorSectionRange(state, "a2")).toEqual({ start: 5, end: 6 });
  });

  it("runs to the end of the document when no anchor follows", () => {
    const state = doc([anchor("a1"), para("x"), para("y")]);
    expect(cardAnchorSectionRange(state, "a1")).toEqual({ start: 1, end: 3 });
  });

  // Headings do NOT close a section — only the next anchor does, so two cards
  // can never claim the same paragraph.
  it("does not let a heading end the section", () => {
    const state = doc([anchor("a1"), para("x"), heading("H"), para("y")]);
    expect(cardAnchorSectionRange(state, "a1")).toEqual({ start: 1, end: 4 });
  });

  it("reports an empty-but-real section as start === end", () => {
    const state = doc([anchor("a1"), anchor("a2"), para("theirs")]);
    expect(cardAnchorSectionRange(state, "a1")).toEqual({ start: 1, end: 1 });
  });

  it("returns null when the anchor isn't in this note", () => {
    expect(cardAnchorSectionRange(doc([para("x")]), "a1")).toBeNull();
  });

  // A malformed anchor still renders as a divider, so it must still stop the
  // previous section — otherwise one card swallows blocks that visibly belong
  // to the next.
  it("lets an id-less anchor end the section it meets", () => {
    const state = doc([anchor("a1"), para("mine"), anchor(""), para("theirs")]);
    expect(cardAnchorSectionRange(state, "a1")).toEqual({ start: 1, end: 2 });
  });

  it("only sees top-level anchors", () => {
    const nested: Node = { type: "quote", children: [anchor("a1")] };
    expect(cardAnchorSectionRange(doc([para("x"), nested]), "a1")).toBeNull();
  });
});

describe("isBlankBlocks", () => {
  it("calls no blocks and whitespace-only blocks blank", () => {
    expect(isBlankBlocks([])).toBe(true);
    expect(isBlankBlocks(asNodes([para("")]))).toBe(true);
    expect(isBlankBlocks(asNodes([para("   "), para("\n")]))).toBe(true);
  });

  it("calls any real text non-blank", () => {
    expect(isBlankBlocks(asNodes([para("hi")]))).toBe(false);
  });

  // Text alone would call a dropped screenshot or a task chip "empty".
  it("treats textless-but-meaningful blocks as content", () => {
    for (const type of [
      "image",
      "task",
      "horizontalrule",
      "linked-note-card",
      CARD_ANCHOR_TYPE,
    ]) {
      expect(isBlankBlocks(asNodes([{ type }]))).toBe(false);
    }
  });

  it("finds a meaningful block nested inside a paragraph", () => {
    const withImage: Node = { type: "paragraph", children: [{ type: "image" }] };
    expect(isBlankBlocks(asNodes([withImage]))).toBe(false);
  });

  it("tolerates a non-array", () => {
    expect(isBlankBlocks(null as unknown as SerializedLexicalNode[])).toBe(true);
  });
});

describe("pruneEmptyCardAnchor", () => {
  it("removes an anchor whose section was never written in", () => {
    const state = doc([para("keep"), anchor("a1"), para("  ")]);
    const next = pruneEmptyCardAnchor(state, "a1")!;
    expect(next).not.toBeNull();
    expect(blocks(next).map((b) => b.type)).toEqual(["paragraph"]);
    expect(blocks(next)[0].children?.[0].text).toBe("keep");
  });

  it("removes a bare anchor with nothing after it", () => {
    const state = doc([para("keep"), anchor("a1")]);
    expect(blocks(pruneEmptyCardAnchor(state, "a1")!)).toHaveLength(1);
  });

  // Never take words with it.
  it("keeps an anchor whose section has content", () => {
    const state = doc([anchor("a1"), para("real words")]);
    expect(pruneEmptyCardAnchor(state, "a1")).toBeNull();
  });

  it("returns null when the anchor isn't there", () => {
    expect(pruneEmptyCardAnchor(doc([para("x")]), "a1")).toBeNull();
  });

  it("stops at the next anchor and leaves it alone", () => {
    const state = doc([anchor("a1"), anchor("a2"), para("theirs")]);
    const next = pruneEmptyCardAnchor(state, "a1")!;
    expect(blocks(next).map((b) => b.type)).toEqual([
      CARD_ANCHOR_TYPE,
      "paragraph",
    ]);
    expect(blocks(next)[0].anchorId).toBe("a2");
  });

  // A childless root is not a document Lexical will reopen.
  it("leaves an empty paragraph rather than an empty root", () => {
    const next = pruneEmptyCardAnchor(doc([anchor("a1")]), "a1")!;
    expect(blocks(next)).toHaveLength(1);
    expect(blocks(next)[0].type).toBe("paragraph");
  });

  it("does not mutate the input state", () => {
    const state = doc([para("keep"), anchor("a1")]);
    const before = JSON.stringify(state);
    pruneEmptyCardAnchor(state, "a1");
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("cardAnchorSectionBlocks", () => {
  it("returns just the owned blocks", () => {
    const state = doc([para("before"), anchor("a1"), para("mine"), anchor("a2")]);
    const got = cardAnchorSectionBlocks(state, "a1") as unknown as Node[];
    expect(got).toHaveLength(1);
    expect(got[0].children?.[0].text).toBe("mine");
  });

  // An existing-but-empty section and a missing anchor must not look alike.
  it("distinguishes an empty section from a missing anchor", () => {
    expect(cardAnchorSectionBlocks(doc([anchor("a1")]), "a1")).toEqual([]);
    expect(cardAnchorSectionBlocks(doc([para("x")]), "a1")).toBeNull();
  });
});

describe("replaceCardAnchorSection", () => {
  it("swaps the section and leaves the rest of the note alone", () => {
    const state = doc([
      para("keep above"),
      anchor("a1"),
      para("old"),
      anchor("a2"),
      para("keep below"),
    ]);
    const next = replaceCardAnchorSection(state, "a1", asNodes([para("new")]))!;
    expect(blocks(next).map((b) => b.type)).toEqual([
      "paragraph",
      CARD_ANCHOR_TYPE,
      "paragraph",
      CARD_ANCHOR_TYPE,
      "paragraph",
    ]);
    expect(blocks(next)[0].children?.[0].text).toBe("keep above");
    expect(blocks(next)[2].children?.[0].text).toBe("new");
    expect(blocks(next)[4].children?.[0].text).toBe("keep below");
  });

  it("can grow and empty a section", () => {
    const state = doc([anchor("a1"), para("old")]);
    const grown = replaceCardAnchorSection(
      state,
      "a1",
      asNodes([para("1"), para("2"), para("3")]),
    )!;
    expect(blocks(grown)).toHaveLength(4);
    expect(blocks(replaceCardAnchorSection(state, "a1", [])!)).toHaveLength(1);
  });

  // An anchor arriving in the payload would redraw the note's boundaries and
  // silently reassign another card's blocks.
  it("drops incoming card-anchor blocks", () => {
    const state = doc([anchor("a1"), para("old")]);
    const next = replaceCardAnchorSection(
      state,
      "a1",
      asNodes([para("mine"), anchor("sneaky")]),
    )!;
    expect(blocks(next).map((b) => b.type)).toEqual([
      CARD_ANCHOR_TYPE,
      "paragraph",
    ]);
    expect(blocks(next)[0].anchorId).toBe("a1");
  });

  it("returns null when the anchor isn't there", () => {
    expect(replaceCardAnchorSection(doc([para("x")]), "a1", [])).toBeNull();
  });

  it("does not mutate the input state", () => {
    const state = doc([anchor("a1"), para("old")]);
    const before = JSON.stringify(state);
    replaceCardAnchorSection(state, "a1", asNodes([para("new")]));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("appendCardAnchor", () => {
  const fields = {
    anchorId: "a1",
    sourceNoteId: "note-a",
    sourceTitle: "Sunday",
  };

  it("appends at the end, carrying its source", () => {
    const next = appendCardAnchor(doc([para("existing")]), fields)!;
    expect(blocks(next).map((b) => b.type)).toEqual([
      "paragraph",
      CARD_ANCHOR_TYPE,
    ]);
    expect(blocks(next)[1]).toMatchObject({
      anchorId: "a1",
      sourceNoteId: "note-a",
      sourceTitle: "Sunday",
    });
  });

  // The end is the only safe position: a boundary dropped mid-document would
  // re-scope whichever card already owned the blocks below it.
  it("never splits an existing section", () => {
    const state = doc([anchor("old"), para("theirs")]);
    const next = appendCardAnchor(state, fields)!;
    expect(cardAnchorSectionRange(next, "old")).toEqual({ start: 1, end: 2 });
  });

  it("synthesizes a root for a note that has none", () => {
    for (const empty of [null, undefined, {} as SerializedEditorState]) {
      const next = appendCardAnchor(empty, fields)!;
      expect(blocks(next).map((b) => b.type)).toEqual([CARD_ANCHOR_TYPE]);
    }
  });

  // An anchor findCardAnchorIndex can never match again is an unreachable
  // divider, so refuse to write one.
  it("refuses a blank id", () => {
    expect(appendCardAnchor(doc([]), { ...fields, anchorId: "" })).toBeNull();
    expect(appendCardAnchor(doc([]), { ...fields, anchorId: "  " })).toBeNull();
  });

  it("round-trips with the readers", () => {
    const next = appendCardAnchor(doc([para("x")]), fields)!;
    expect(cardAnchorSectionBlocks(next, "a1")).toEqual([]);
    const written = replaceCardAnchorSection(
      next,
      "a1",
      asNodes([para("written from the card")]),
    )!;
    const got = cardAnchorSectionBlocks(written, "a1") as unknown as Node[];
    expect(got[0].children?.[0].text).toBe("written from the card");
  });

  it("does not mutate the input state", () => {
    const state = doc([para("x")]);
    const before = JSON.stringify(state);
    appendCardAnchor(state, fields);
    expect(JSON.stringify(state)).toBe(before);
  });
});

function asNodes(nodes: Node[]): SerializedLexicalNode[] {
  return nodes as unknown as SerializedLexicalNode[];
}

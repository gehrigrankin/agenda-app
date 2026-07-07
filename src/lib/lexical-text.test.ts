import type { SerializedEditorState } from "lexical";
import { describe, expect, it } from "vitest";
import { lexicalToPlainText } from "./lexical-text";

// Serialized node trees built by hand as plain objects — lexicalToPlainText
// only looks at `type`, `text`, and `children`.

type Node = { type: string; text?: string; children?: Node[] };

function text(t: string): Node {
  return { type: "text", text: t };
}

function el(type: string, children: Node[]): Node {
  return { type, children };
}

function state(children: Node[]): SerializedEditorState {
  return { root: el("root", children) } as unknown as SerializedEditorState;
}

describe("lexicalToPlainText", () => {
  it("returns empty string for null/undefined/malformed states", () => {
    expect(lexicalToPlainText(null)).toBe("");
    expect(lexicalToPlainText(undefined)).toBe("");
    expect(lexicalToPlainText({} as unknown as SerializedEditorState)).toBe("");
    expect(lexicalToPlainText("nope" as unknown as SerializedEditorState)).toBe("");
  });

  it("returns empty string for an empty document", () => {
    expect(lexicalToPlainText(state([]))).toBe("");
    expect(lexicalToPlainText(state([el("paragraph", [])]))).toBe("");
  });

  it("extracts text from a single paragraph", () => {
    expect(lexicalToPlainText(state([el("paragraph", [text("Hello world")])]))).toBe("Hello world");
  });

  it("joins sibling text nodes without extra spaces", () => {
    expect(lexicalToPlainText(state([el("paragraph", [text("Hel"), text("lo")])]))).toBe("Hello");
  });

  it("joins paragraphs with a single space", () => {
    const s = state([el("paragraph", [text("Hello")]), el("paragraph", [text("world")])]);
    expect(lexicalToPlainText(s)).toBe("Hello world");
  });

  it("turns linebreaks into spaces", () => {
    const s = state([el("paragraph", [text("line one"), { type: "linebreak" }, text("line two")])]);
    expect(lexicalToPlainText(s)).toBe("line one line two");
  });

  it("separates items in nested lists", () => {
    // Lexical serializes a nested list as its own listitem wrapping a list,
    // a sibling of the text-bearing item.
    const s = state([
      el("list", [
        el("listitem", [text("first")]),
        el("listitem", [text("second")]),
        el("listitem", [el("list", [el("listitem", [text("nested")])])]),
        el("listitem", [text("third")]),
      ]),
    ]);
    expect(lexicalToPlainText(s)).toBe("first second nested third");
  });

  it("does not insert spaces around inline link elements", () => {
    const s = state([
      el("paragraph", [text("foo"), el("link", [text("bar")]), text("baz")]),
    ]);
    expect(lexicalToPlainText(s)).toBe("foobarbaz");
  });

  it("treats autolink and note-link as inline too", () => {
    const auto = state([
      el("paragraph", [text("go to "), el("autolink", [text("example.com")]), text(" now")]),
    ]);
    expect(lexicalToPlainText(auto)).toBe("go to example.com now");

    const noteLink = state([
      el("paragraph", [text("see"), el("note-link", [text("My Note")]), text("s")]),
    ]);
    expect(lexicalToPlainText(noteLink)).toBe("seeMy Notes");
  });

  it("still separates blocks that follow a link", () => {
    const s = state([
      el("paragraph", [el("link", [text("one")])]),
      el("paragraph", [text("two")]),
    ]);
    expect(lexicalToPlainText(s)).toBe("one two");
  });

  it("collapses runs of whitespace", () => {
    const s = state([
      el("paragraph", [text("a  "), { type: "linebreak" }, text(" b")]),
      el("paragraph", [text("c")]),
    ]);
    expect(lexicalToPlainText(s)).toBe("a b c");
  });

  it("truncates to max characters", () => {
    const s = state([el("paragraph", [text("abcdefghij")])]);
    expect(lexicalToPlainText(s, 5)).toBe("abcde");
  });

  it("truncates across multiple blocks", () => {
    const s = state([
      el("paragraph", [text("one")]),
      el("paragraph", [text("two")]),
      el("paragraph", [text("three")]),
    ]);
    expect(lexicalToPlainText(s, 7)).toBe("one two");
  });

  it("defaults max to 140", () => {
    const long = "x".repeat(300);
    const s = state([el("paragraph", [text(long)])]);
    expect(lexicalToPlainText(s)).toHaveLength(140);
  });

  it("never returns leading or trailing whitespace", () => {
    const s = state([el("paragraph", [{ type: "linebreak" }, text("word"), { type: "linebreak" }])]);
    expect(lexicalToPlainText(s)).toBe("word");
  });
});

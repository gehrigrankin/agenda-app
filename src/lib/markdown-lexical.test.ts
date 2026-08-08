import type { SerializedEditorState, SerializedLexicalNode } from "lexical";
import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown,
  docToMarkdown,
  markdownToBlocks,
  markdownToDoc,
  type LexicalBlocks,
} from "./markdown-lexical";

// Serialized node trees are read as plain JSON, so tests build them by hand
// and read the parser's output the same way.

type Node = Record<string, unknown>;

function nodes(blocks: LexicalBlocks): Node[] {
  return blocks as unknown as Node[];
}

function text(t: string): Node {
  return { type: "text", text: t };
}

function el(type: string, children: Node[], extra: Node = {}): Node {
  return { type, children, ...extra };
}

function state(children: Node[]): SerializedEditorState {
  return { root: el("root", children) } as unknown as SerializedEditorState;
}

function blocks(children: Node[]): LexicalBlocks {
  return children as unknown as SerializedLexicalNode[];
}

/** The text a block ended up carrying, for readable assertions. */
function textOf(block: Node): string {
  const children = (block.children ?? []) as Node[];
  return children
    .map((c) => (typeof c.text === "string" ? c.text : c.type === "linebreak" ? "\n" : ""))
    .join("");
}

describe("markdownToBlocks — headings", () => {
  it("maps # through ###### to the matching tag", () => {
    for (let level = 1; level <= 6; level++) {
      const [block] = nodes(markdownToBlocks(`${"#".repeat(level)} Title`));
      expect(block.type).toBe("heading");
      expect(block.tag).toBe(`h${level}`);
      expect(textOf(block)).toBe("Title");
    }
  });

  it("does not treat seven hashes or a space-less hash as a heading", () => {
    expect(nodes(markdownToBlocks("####### Deep"))[0].type).toBe("paragraph");
    expect(nodes(markdownToBlocks("#NoSpace"))[0].type).toBe("paragraph");
    expect(nodes(markdownToBlocks("#"))[0].type).toBe("paragraph");
  });

  it("trims the heading text", () => {
    expect(textOf(nodes(markdownToBlocks("##   Spaced   "))[0])).toBe("Spaced");
  });
});

describe("markdownToBlocks — paragraphs", () => {
  it("makes one paragraph per blank-line-separated run", () => {
    const out = nodes(markdownToBlocks("first\n\nsecond"));
    expect(out.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(out.map(textOf)).toEqual(["first", "second"]);
  });

  it("keeps a multi-line run as one paragraph with linebreaks", () => {
    const [block] = nodes(markdownToBlocks("one\ntwo\nthree"));
    expect(block.type).toBe("paragraph");
    expect(textOf(block)).toBe("one\ntwo\nthree");
  });

  it("ignores leading, trailing and repeated blank lines", () => {
    const out = nodes(markdownToBlocks("\n\n  \nhello\n\n\n\nworld\n\n"));
    expect(out.map(textOf)).toEqual(["hello", "world"]);
  });

  it("normalizes CRLF and lone CR line endings", () => {
    expect(nodes(markdownToBlocks("a\r\n\r\nb")).map(textOf)).toEqual(["a", "b"]);
    expect(nodes(markdownToBlocks("a\r\rb")).map(textOf)).toEqual(["a", "b"]);
  });

  it("keeps inline markdown as plain text, not formatted nodes", () => {
    const [block] = nodes(markdownToBlocks("**bold** and _em_ and [a](b) and [[Note]]"));
    const children = block.children as Node[];
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("text");
    expect(children[0].text).toBe("**bold** and _em_ and [a](b) and [[Note]]");
  });
});

describe("markdownToBlocks — lists", () => {
  it("groups consecutive bullets into one list", () => {
    const [list] = nodes(markdownToBlocks("- one\n- two"));
    expect(list.type).toBe("list");
    expect(list.listType).toBe("bullet");
    expect(list.tag).toBe("ul");
    const items = list.children as Node[];
    expect(items.map((i) => i.type)).toEqual(["listitem", "listitem"]);
    expect(items.map(textOf)).toEqual(["one", "two"]);
  });

  it("accepts * as a bullet marker", () => {
    const [list] = nodes(markdownToBlocks("* one\n* two"));
    expect(list.listType).toBe("bullet");
    expect((list.children as Node[]).map(textOf)).toEqual(["one", "two"]);
  });

  it("does not mistake emphasis or a bare dash for a bullet", () => {
    expect(nodes(markdownToBlocks("*emphasis*"))[0].type).toBe("paragraph");
    expect(nodes(markdownToBlocks("**bold**"))[0].type).toBe("paragraph");
    expect(nodes(markdownToBlocks("---"))[0].type).toBe("paragraph");
  });

  it("builds a numbered list carrying each item's written value", () => {
    const [list] = nodes(markdownToBlocks("1. one\n2. two\n3. three"));
    expect(list.listType).toBe("number");
    expect(list.tag).toBe("ol");
    expect(list.start).toBe(1);
    expect((list.children as Node[]).map((i) => i.value)).toEqual([1, 2, 3]);
  });

  it("honors a numbered list that does not start at 1", () => {
    const [list] = nodes(markdownToBlocks("3. three\n4. four"));
    expect(list.start).toBe(3);
    expect((list.children as Node[]).map((i) => i.value)).toEqual([3, 4]);
  });

  it("starts a new list when the marker type changes", () => {
    const out = nodes(markdownToBlocks("- bullet\n1. number"));
    expect(out.map((b) => b.listType)).toEqual(["bullet", "number"]);
  });

  it("ends the list at a blank line", () => {
    const out = nodes(markdownToBlocks("- one\n\n- two"));
    expect(out).toHaveLength(2);
    expect(out.every((b) => b.type === "list")).toBe(true);
  });

  it("flattens indented items into the parent list", () => {
    const out = nodes(markdownToBlocks("- one\n  - nested\n- two"));
    expect(out).toHaveLength(1);
    expect((out[0].children as Node[]).map(textOf)).toEqual(["one", "nested", "two"]);
  });

  it("keeps task markers as ordinary list-item text (never a task node)", () => {
    const [list] = nodes(markdownToBlocks("- [ ] open\n- [x] done"));
    expect(list.type).toBe("list");
    const items = list.children as Node[];
    expect(items.every((i) => i.type === "listitem")).toBe(true);
    expect(items.map(textOf)).toEqual(["[ ] open", "[x] done"]);
    expect(JSON.stringify(list)).not.toContain('"task"');
  });
});

describe("markdownToBlocks — quotes and code", () => {
  it("makes one quote block per run of > lines", () => {
    const [block] = nodes(markdownToBlocks("> one\n> two"));
    expect(block.type).toBe("quote");
    expect(textOf(block)).toBe("one\ntwo");
  });

  it("separates quote runs split by a blank line", () => {
    const out = nodes(markdownToBlocks("> one\n\n> two"));
    expect(out.map((b) => b.type)).toEqual(["quote", "quote"]);
  });

  it("strips exactly one space after the > marker", () => {
    expect(textOf(nodes(markdownToBlocks(">  padded"))[0])).toBe(" padded");
    expect(textOf(nodes(markdownToBlocks(">tight"))[0])).toBe("tight");
  });

  it("turns fenced code into one verbatim paragraph per line", () => {
    const out = nodes(markdownToBlocks("```ts\nconst a = 1;\n  indented\n```"));
    expect(out.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(out.map(textOf)).toEqual(["const a = 1;", "  indented"]);
  });

  it("runs an unterminated fence to the end without throwing", () => {
    const out = nodes(markdownToBlocks("```\nstill code\nmore"));
    expect(out.map(textOf)).toEqual(["still code", "more"]);
  });
});

describe("markdownToBlocks / markdownToDoc — empty input", () => {
  it("returns no blocks for empty or whitespace-only markdown", () => {
    expect(markdownToBlocks("")).toEqual([]);
    expect(markdownToBlocks("   \n\n \t ")).toEqual([]);
  });

  it("tolerates a non-string input", () => {
    expect(markdownToBlocks(null as unknown as string)).toEqual([]);
    expect(markdownToBlocks(undefined as unknown as string)).toEqual([]);
  });

  it("wraps blocks in a root document", () => {
    const doc = markdownToDoc("# Title") as unknown as { root: Node };
    expect(doc.root.type).toBe("root");
    expect((doc.root.children as Node[])[0].type).toBe("heading");
    expect(markdownToDoc("").root.children).toEqual([]);
  });
});

describe("blocksToMarkdown", () => {
  it("renders paragraphs separated by a blank line", () => {
    const md = blocksToMarkdown(
      blocks([el("paragraph", [text("one")]), el("paragraph", [text("two")])]),
    );
    expect(md).toBe("one\n\ntwo");
  });

  it("renders linebreaks inside a paragraph as newlines", () => {
    const md = blocksToMarkdown(
      blocks([el("paragraph", [text("one"), { type: "linebreak" }, text("two")])]),
    );
    expect(md).toBe("one\ntwo");
  });

  it("renders timed paragraphs like paragraphs", () => {
    const md = blocksToMarkdown(
      blocks([el("timed-paragraph", [text("logged")], { timestamp: 1 })]),
    );
    expect(md).toBe("logged");
  });

  it("skips empty paragraphs (the editor's trailing block)", () => {
    const md = blocksToMarkdown(
      blocks([el("paragraph", [text("only")]), el("paragraph", [])]),
    );
    expect(md).toBe("only");
  });

  it("renders every heading flavor at its tag's level", () => {
    const md = blocksToMarkdown(
      blocks([
        el("heading", [text("Plain")], { tag: "h1" }),
        el("collapsible-heading", [text("Folded")], { tag: "h3", collapsed: true }),
        el("log-heading", [text("Logged")], { tag: "h2", logId: "l", noteId: "n" }),
      ]),
    );
    expect(md).toBe("# Plain\n\n### Folded\n\n## Logged");
  });

  it("falls back to a log heading's title snapshot when it has no text", () => {
    const md = blocksToMarkdown(
      blocks([el("log-heading", [], { tag: "h2", title: "Target note" })]),
    );
    expect(md).toBe("## Target note");
  });

  it("renders a heading with an unusable tag as #", () => {
    expect(blocksToMarkdown(blocks([el("heading", [text("x")])]))).toBe("# x");
    expect(blocksToMarkdown(blocks([el("heading", [text("x")], { tag: "h9" })]))).toBe("# x");
  });

  it("prefixes every quote line, including empty ones", () => {
    const md = blocksToMarkdown(
      blocks([
        el("quote", [text("one"), { type: "linebreak" }, { type: "linebreak" }, text("two")]),
      ]),
    );
    expect(md).toBe("> one\n>\n> two");
  });

  it("renders bullet and numbered lists", () => {
    const bullet = blocksToMarkdown(
      blocks([
        el("list", [el("listitem", [text("a")]), el("listitem", [text("b")])], {
          listType: "bullet",
        }),
      ]),
    );
    expect(bullet).toBe("- a\n- b");

    const numbered = blocksToMarkdown(
      blocks([
        el(
          "list",
          [
            el("listitem", [text("a")], { value: 1 }),
            el("listitem", [text("b")], { value: 2 }),
          ],
          { listType: "number" },
        ),
      ]),
    );
    expect(numbered).toBe("1. a\n2. b");
  });

  it("renders the editor's collapsible-listitem replacement", () => {
    const md = blocksToMarkdown(
      blocks([
        el("list", [el("collapsible-listitem", [text("a")], { collapsed: true })], {
          listType: "bullet",
        }),
      ]),
    );
    expect(md).toBe("- a");
  });

  it("renders a check list as markdown task lines", () => {
    const md = blocksToMarkdown(
      blocks([
        el(
          "list",
          [
            el("listitem", [text("open")], { checked: false }),
            el("listitem", [text("done")], { checked: true }),
          ],
          { listType: "check" },
        ),
      ]),
    );
    expect(md).toBe("- [ ] open\n- [x] done");
  });

  it("indents a nested sublist under its row", () => {
    // Lexical wraps the sublist in its own textless item after the parent row.
    const md = blocksToMarkdown(
      blocks([
        el(
          "list",
          [
            el("listitem", [text("one")]),
            el("listitem", [
              el("list", [el("listitem", [text("nested")])], { listType: "bullet" }),
            ]),
            el("listitem", [text("two")]),
          ],
          { listType: "bullet" },
        ),
      ]),
    );
    expect(md).toBe("- one\n  - nested\n- two");
  });

  it("renders task nodes as checkbox lines, kept tight together", () => {
    const md = blocksToMarkdown(
      blocks([
        { type: "task", taskId: "t1", title: "Buy milk", completed: false },
        { type: "task", taskId: "t2", title: "Call mom", completed: true },
        el("paragraph", [text("after")]),
      ]),
    );
    expect(md).toBe("- [ ] Buy milk\n- [x] Call mom\n\nafter");
  });

  it("renders inline note-link chips as [[Title]]", () => {
    const md = blocksToMarkdown(
      blocks([
        el("paragraph", [
          text("see "),
          { type: "note-link", noteId: "n1", title: "My Note" },
          text(" today"),
        ]),
      ]),
    );
    expect(md).toBe("see [[My Note]] today");
  });

  it("renders a top-level note-link on its own line", () => {
    const md = blocksToMarkdown(blocks([{ type: "note-link", noteId: "n1", title: "Solo" }]));
    expect(md).toBe("[[Solo]]");
  });

  it("falls back to plain text for unknown block types", () => {
    const md = blocksToMarkdown(
      blocks([
        el("some-future-node", [text("kept")], { weird: true }),
        el("paragraph", [text("after")]),
      ]),
    );
    expect(md).toBe("kept\n\nafter");
  });

  it("drops blocks that carry no text at all", () => {
    const md = blocksToMarkdown(
      blocks([
        { type: "image", src: "/a.png", altText: "" },
        el("paragraph", [text("only")]),
      ]),
    );
    expect(md).toBe("only");
  });

  it("returns an empty string for empty or non-array input", () => {
    expect(blocksToMarkdown([])).toBe("");
    expect(blocksToMarkdown(null as unknown as LexicalBlocks)).toBe("");
    expect(blocksToMarkdown("nope" as unknown as LexicalBlocks)).toBe("");
  });

  it("does not throw on malformed or nonsense nodes", () => {
    const junk = blocks([
      null as unknown as Node,
      "string" as unknown as Node,
      { type: "paragraph", children: "not an array" } as unknown as Node,
      { type: "list", children: [null, 7, { type: "listitem" }] } as unknown as Node,
      { type: "heading", tag: 42 } as unknown as Node,
      { type: "task" } as unknown as Node,
      { type: "note-link" } as unknown as Node,
    ]);
    expect(() => blocksToMarkdown(junk)).not.toThrow();
    expect(blocksToMarkdown(junk)).toContain("- [ ]");
  });

  it("survives a deeply self-nested list without throwing", () => {
    let inner: Node = el("list", [el("listitem", [text("deep")])], { listType: "bullet" });
    for (let i = 0; i < 20; i++) {
      inner = el("list", [el("listitem", [inner])], { listType: "bullet" });
    }
    expect(() => blocksToMarkdown(blocks([inner]))).not.toThrow();
    expect(blocksToMarkdown(blocks([inner])).trim().endsWith("- deep")).toBe(true);
  });
});

describe("docToMarkdown", () => {
  it("renders a whole document", () => {
    expect(
      docToMarkdown(state([el("heading", [text("Title")], { tag: "h1" }), el("paragraph", [text("Body")])])),
    ).toBe("# Title\n\nBody");
  });

  it("returns an empty string for null, undefined or malformed states", () => {
    expect(docToMarkdown(null)).toBe("");
    expect(docToMarkdown(undefined)).toBe("");
    expect(docToMarkdown({} as unknown as SerializedEditorState)).toBe("");
    expect(docToMarkdown("nope" as unknown as SerializedEditorState)).toBe("");
    expect(
      docToMarkdown({ root: { type: "root" } } as unknown as SerializedEditorState),
    ).toBe("");
  });
});

describe("round trips", () => {
  const cases: [string, string][] = [
    ["a heading and a paragraph", "# Title\n\nHello world."],
    ["every heading level", "# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six"],
    ["a bullet list", "- one\n- two\n- three"],
    ["a numbered list", "1. one\n2. two"],
    ["a numbered list that starts high", "5. five\n6. six"],
    ["task lines", "- [ ] open\n- [x] done"],
    ["a blockquote", "> quoted"],
    ["a multi-line blockquote", "> one\n> two"],
    ["a soft-wrapped paragraph", "one\ntwo\nthree"],
    ["two lists of different types", "- bullet\n\n1. number"],
    [
      "a mixed document",
      "# Notes\n\nSome intro text.\n\n## Todo\n\n- [ ] first\n- [x] second\n\n> a quote\n\n1. step one\n2. step two\n\nClosing line.",
    ],
  ];

  for (const [name, md] of cases) {
    it(`is stable for ${name}`, () => {
      expect(blocksToMarkdown(markdownToBlocks(md))).toBe(md);
    });
  }

  it("normalizes * bullets to - and trims paragraph indentation", () => {
    expect(blocksToMarkdown(markdownToBlocks("* one\n* two"))).toBe("- one\n- two");
    expect(blocksToMarkdown(markdownToBlocks("  padded  "))).toBe("padded");
  });

  it("collapses extra blank lines between blocks", () => {
    expect(blocksToMarkdown(markdownToBlocks("one\n\n\n\ntwo"))).toBe("one\n\ntwo");
  });

  it("loses only the fences of a code block, never its lines", () => {
    expect(blocksToMarkdown(markdownToBlocks("```js\nlet a = 1;\n```"))).toBe("let a = 1;");
  });

  it("round-trips through the doc form too", () => {
    const md = "# Title\n\n- one\n- two";
    expect(docToMarkdown(markdownToDoc(md))).toBe(md);
  });
});

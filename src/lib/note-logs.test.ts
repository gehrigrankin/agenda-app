import type { SerializedEditorState, SerializedLexicalNode } from "lexical";
import { describe, expect, it } from "vitest";
import {
  LOG_HEADING_TYPE,
  collectLogSections,
  logSectionText,
} from "./note-logs";

// Serialized node trees built by hand as plain objects — collectLogSections
// only looks at `type`, `tag`, `logId`, `noteId`, `title` and `children`.

type Node = {
  type: string;
  tag?: unknown;
  logId?: unknown;
  noteId?: unknown;
  title?: unknown;
  text?: string;
  children?: Node[];
};

function text(t: string): Node {
  return { type: "text", text: t };
}

function el(type: string, children: Node[]): Node {
  return { type, children };
}

function para(t: string): Node {
  return el("paragraph", [text(t)]);
}

/** A plain (non-log) heading. */
function heading(tag: unknown, t = "H"): Node {
  return { type: "heading", tag, children: [text(t)] };
}

/** A `[[+` heading; `props` overrides any field (including with undefined). */
function logHeading(tag: unknown, t: string, props: Partial<Node> = {}): Node {
  return {
    type: LOG_HEADING_TYPE,
    tag,
    logId: "log1",
    noteId: "note1",
    children: t ? [text(t)] : [],
    ...props,
  };
}

function state(children: Node[]): SerializedEditorState {
  return { root: el("root", children) } as unknown as SerializedEditorState;
}

function blocksOf(nodes: Node[]): SerializedLexicalNode[] {
  return nodes as unknown as SerializedLexicalNode[];
}

describe("LOG_HEADING_TYPE", () => {
  it("is the serialized type LogHeadingNode exports", () => {
    expect(LOG_HEADING_TYPE).toBe("log-heading");
  });
});

describe("collectLogSections", () => {
  it("returns [] for null/undefined/malformed states", () => {
    expect(collectLogSections(null)).toEqual([]);
    expect(collectLogSections(undefined)).toEqual([]);
    expect(collectLogSections({} as unknown as SerializedEditorState)).toEqual([]);
    expect(
      collectLogSections({ root: {} } as unknown as SerializedEditorState),
    ).toEqual([]);
    expect(
      collectLogSections({
        root: { children: "nope" },
      } as unknown as SerializedEditorState),
    ).toEqual([]);
  });

  it("returns [] for a document with no log headings", () => {
    expect(collectLogSections(state([]))).toEqual([]);
    expect(
      collectLogSections(state([heading("h1", "Plain"), para("body")])),
    ).toEqual([]);
  });

  it("collects the blocks that follow a log heading", () => {
    const p1 = para("one");
    const p2 = para("two");
    const s = collectLogSections(state([logHeading("h2", "Weekly sync"), p1, p2]));
    expect(s).toHaveLength(1);
    expect(s[0].logId).toBe("log1");
    expect(s[0].noteId).toBe("note1");
    expect(s[0].heading).toBe("Weekly sync");
    // Blocks are the original nodes, in document order.
    expect(s[0].blocks).toEqual([p1, p2]);
    expect(s[0].blocks[0]).toBe(p1);
  });

  it("ignores blocks before the first log heading", () => {
    const after = para("after");
    const s = collectLogSections(
      state([para("before"), heading("h1", "Intro"), logHeading("h1", "Log"), after]),
    );
    expect(s).toHaveLength(1);
    expect(s[0].blocks).toEqual([after]);
  });

  it("yields blocks: [] for a log heading with nothing under it", () => {
    const s = collectLogSections(state([logHeading("h1", "Empty")]));
    expect(s).toHaveLength(1);
    expect(s[0].blocks).toEqual([]);
  });

  it("ends the section at a heading of the same level", () => {
    const inside = para("inside");
    const s = collectLogSections(
      state([
        logHeading("h2", "Log"),
        inside,
        heading("h2", "Next"),
        para("outside"),
      ]),
    );
    expect(s).toHaveLength(1);
    // The closing heading itself is not part of the log.
    expect(s[0].blocks).toEqual([inside]);
  });

  it("ends the section at a shallower heading", () => {
    const inside = para("inside");
    const s = collectLogSections(
      state([logHeading("h3", "Log"), inside, heading("h1", "Top"), para("out")]),
    );
    expect(s[0].blocks).toEqual([inside]);
  });

  it("keeps a DEEPER heading and its content inside the section", () => {
    const sub = heading("h2", "Sub");
    const body = para("body");
    const s = collectLogSections(
      state([logHeading("h1", "Log"), sub, body, heading("h1", "Top"), para("out")]),
    );
    expect(s).toHaveLength(1);
    expect(s[0].blocks).toEqual([sub, body]);
  });

  it("treats collapsible headings as headings too", () => {
    const inside = para("inside");
    const closed = collectLogSections(
      state([
        logHeading("h2", "Log"),
        inside,
        { type: "collapsible-heading", tag: "h1", children: [text("Top")] },
        para("out"),
      ]),
    );
    expect(closed[0].blocks).toEqual([inside]);

    // ...and a deeper collapsible heading stays in the log.
    const deeper = { type: "collapsible-heading", tag: "h3", children: [text("Sub")] };
    const kept = collectLogSections(state([logHeading("h2", "Log"), deeper]));
    expect(kept[0].blocks).toEqual([deeper]);
  });

  it("ignores non-heading blocks when deciding where a section ends", () => {
    const list = el("list", [el("listitem", [text("item")])]);
    const quote = el("quote", [text("quoted")]);
    const s = collectLogSections(state([logHeading("h1", "Log"), list, quote]));
    expect(s[0].blocks).toEqual([list, quote]);
  });

  it("collects multiple independent sections in document order", () => {
    const a = para("a");
    const b = para("b");
    const s = collectLogSections(
      state([
        logHeading("h1", "First", { logId: "l1", noteId: "n1" }),
        a,
        heading("h1", "Break"),
        para("neither"),
        logHeading("h2", "Second", { logId: "l2", noteId: "n2" }),
        b,
      ]),
    );
    expect(s.map((x) => x.logId)).toEqual(["l1", "l2"]);
    expect(s[0].blocks).toEqual([a]);
    expect(s[1].blocks).toEqual([b]);
    expect(s[1].noteId).toBe("n2");
  });

  it("lets a same-level log heading close the previous section and open its own", () => {
    const a = para("a");
    const b = para("b");
    const s = collectLogSections(
      state([
        logHeading("h2", "First", { logId: "l1" }),
        a,
        logHeading("h2", "Second", { logId: "l2" }),
        b,
      ]),
    );
    expect(s.map((x) => x.logId)).toEqual(["l1", "l2"]);
    expect(s[0].blocks).toEqual([a]);
    expect(s[1].blocks).toEqual([b]);
  });

  it("logs a DEEPER log heading as content instead of opening its own section", () => {
    // One block of text can't belong to two logs, so the nested call is just
    // part of the open one.
    const nested = logHeading("h2", "Nested", { logId: "l2", noteId: "n2" });
    const body = para("body");
    const s = collectLogSections(
      state([logHeading("h1", "Outer", { logId: "l1" }), nested, body]),
    );
    expect(s).toHaveLength(1);
    expect(s[0].logId).toBe("l1");
    expect(s[0].blocks).toEqual([nested, body]);
  });

  it("ignores a log heading nested inside a list or quote", () => {
    const nested = state([
      el("list", [el("listitem", [logHeading("h1", "Nested")])]),
      el("quote", [logHeading("h1", "Quoted")]),
    ]);
    expect(collectLogSections(nested)).toEqual([]);
  });

  it("does not let a nested log heading split an open section", () => {
    const list = el("list", [el("listitem", [logHeading("h1", "Nested")])]);
    const after = para("after");
    const s = collectLogSections(state([logHeading("h1", "Outer"), list, after]));
    expect(s).toHaveLength(1);
    expect(s[0].blocks).toEqual([list, after]);
  });

  it("requires a non-empty string logId", () => {
    expect(
      collectLogSections(state([logHeading("h1", "x", { logId: undefined })])),
    ).toEqual([]);
    expect(collectLogSections(state([logHeading("h1", "x", { logId: "" })]))).toEqual([]);
    expect(collectLogSections(state([logHeading("h1", "x", { logId: 7 })]))).toEqual([]);
  });

  it("requires a non-empty string noteId", () => {
    expect(
      collectLogSections(state([logHeading("h1", "x", { noteId: undefined })])),
    ).toEqual([]);
    expect(collectLogSections(state([logHeading("h1", "x", { noteId: "" })]))).toEqual([]);
    expect(collectLogSections(state([logHeading("h1", "x", { noteId: null })]))).toEqual([]);
  });

  it("still treats an id-less log heading as a section-closing heading", () => {
    const inside = para("inside");
    const s = collectLogSections(
      state([
        logHeading("h1", "Log"),
        inside,
        logHeading("h1", "Broken", { logId: "" }),
        para("out"),
      ]),
    );
    expect(s).toHaveLength(1);
    expect(s[0].blocks).toEqual([inside]);
  });

  it("uses the heading's own text as the label", () => {
    const s = collectLogSections(
      state([
        {
          type: LOG_HEADING_TYPE,
          tag: "h1",
          logId: "l1",
          noteId: "n1",
          title: "Snapshot",
          children: [text("Live "), text("text")],
        },
      ]),
    );
    expect(s[0].heading).toBe("Live text");
  });

  it("falls back to the title snapshot when the heading has no text", () => {
    const s = collectLogSections(
      state([logHeading("h1", "", { title: "Target note" })]),
    );
    expect(s[0].heading).toBe("Target note");

    // Whitespace-only text counts as no text.
    const blank = collectLogSections(
      state([logHeading("h1", "", { title: "Target", children: [text("   ")] })]),
    );
    expect(blank[0].heading).toBe("Target");
  });

  it("yields an empty heading when there is neither text nor a string title", () => {
    expect(collectLogSections(state([logHeading("h1", "")]))[0].heading).toBe("");
    expect(
      collectLogSections(state([logHeading("h1", "", { title: 42 })]))[0].heading,
    ).toBe("");
  });

  it("caps the heading label at 200 characters", () => {
    const s = collectLogSections(state([logHeading("h1", "y".repeat(300))]));
    expect(s[0].heading).toHaveLength(200);
  });

  it("sorts an unparseable heading tag as level 6, so it closes nothing above it", () => {
    const bogus = heading("nope", "Bogus");
    const missing = { type: "heading", children: [text("No tag")] };
    const s = collectLogSections(
      state([logHeading("h1", "Log"), bogus, missing, para("body")]),
    );
    expect(s).toHaveLength(1);
    expect(s[0].blocks).toEqual([bogus, missing, para("body")]);
  });

  it("opens an unparseable-tag log heading at level 6, so any heading closes it", () => {
    const inside = para("inside");
    const s = collectLogSections(
      state([
        logHeading(undefined, "Log"),
        inside,
        heading("h6", "Deepest"),
        para("out"),
      ]),
    );
    expect(s).toHaveLength(1);
    expect(s[0].blocks).toEqual([inside]);
  });
});

describe("logSectionText", () => {
  it("returns an empty string for no blocks", () => {
    expect(logSectionText([])).toBe("");
  });

  it("returns the whitespace-collapsed text of the blocks", () => {
    expect(
      logSectionText(blocksOf([para("Ship the  thing"), para("then rest")])),
    ).toBe("Ship the thing then rest");
  });

  it("reads the same blocks collectLogSections hands back", () => {
    const s = collectLogSections(
      state([logHeading("h1", "Log"), para("one"), para("two")]),
    );
    expect(logSectionText(s[0].blocks)).toBe("one two");
  });

  it("truncates to max characters", () => {
    expect(logSectionText(blocksOf([para("abcdefghij")]), 5)).toBe("abcde");
  });

  it("defaults max to 2000", () => {
    expect(logSectionText(blocksOf([para("z".repeat(3000))]))).toHaveLength(2000);
  });
});

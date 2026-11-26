import { describe, expect, it } from "vitest";

import {
  cardSectionStashId,
  editorDocumentHasUserContent,
  firstEditorChangeDecision,
  initialSaveBaseline,
  isHydrateFallbackChange,
  isLoadedEditorContent,
} from "./editor-save-baseline";

describe("isLoadedEditorContent", () => {
  it("absorbs a structurally identical mount normalization", () => {
    const loaded = {
      root: { type: "root", children: [{ type: "paragraph", version: 1 }] },
    };
    const normalized = {
      root: { children: [{ version: 1, type: "paragraph" }], type: "root" },
    };

    expect(isLoadedEditorContent(normalized, loaded)).toBe(true);
  });

  it("does not swallow a structurally different first real edit", () => {
    const loaded = [{ type: "paragraph", children: [] }];
    const firstEdit = [
      { type: "paragraph", children: [{ type: "text", text: "first edit" }] },
    ];

    expect(isLoadedEditorContent(firstEdit, loaded)).toBe(false);
  });

  it("absorbs Lexical's empty mount state for a note with null content", () => {
    expect(
      isLoadedEditorContent(
        { root: { type: "root", children: [{ type: "paragraph" }] } },
        null,
      ),
    ).toBe(true);
  });
});

describe("initialSaveBaseline", () => {
  it("keeps the loaded document when the first event is already an edit", () => {
    const loaded = [{ type: "paragraph", children: [] }];
    const firstEdit = [
      { type: "paragraph", children: [{ type: "text", text: "new" }] },
    ];

    expect(initialSaveBaseline(firstEdit, loaded)).toBe(JSON.stringify(loaded));
  });
});

const emptyDoc = {
  root: {
    type: "root",
    children: [{ type: "paragraph", children: [], version: 1 }],
  },
};

const writtenDoc = {
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", text: "keep this" }],
        version: 1,
      },
    ],
  },
};

const rulingOnlyDoc = {
  root: {
    type: "root",
    children: [
      { type: "agenda-section", children: [{ type: "text", text: "Work" }] },
      { type: "paragraph", children: [], version: 1 },
    ],
  },
};

describe("editorDocumentHasUserContent", () => {
  it("treats empty paragraphs and printed agenda sections as no writing", () => {
    expect(editorDocumentHasUserContent(emptyDoc)).toBe(false);
    expect(editorDocumentHasUserContent(rulingOnlyDoc)).toBe(false);
    expect(editorDocumentHasUserContent(null)).toBe(false);
  });

  it("counts text, tasks, and images as writing", () => {
    expect(editorDocumentHasUserContent(writtenDoc)).toBe(true);
    expect(
      editorDocumentHasUserContent([{ type: "task", title: "Buy milk" }]),
    ).toBe(true);
    expect(editorDocumentHasUserContent([{ type: "image", src: "x" }])).toBe(
      true,
    );
  });
});

describe("isHydrateFallbackChange", () => {
  it("detects an empty live editor replacing stored writing", () => {
    expect(isHydrateFallbackChange(emptyDoc, writtenDoc)).toBe(true);
    expect(isHydrateFallbackChange(rulingOnlyDoc, writtenDoc)).toBe(true);
  });

  it("is not a fallback when the loaded note was already empty", () => {
    expect(isHydrateFallbackChange(emptyDoc, null)).toBe(false);
    expect(isHydrateFallbackChange(emptyDoc, emptyDoc)).toBe(false);
  });

  it("is not a fallback when the user actually typed", () => {
    expect(isHydrateFallbackChange(writtenDoc, emptyDoc)).toBe(false);
  });
});

describe("firstEditorChangeDecision", () => {
  it("absorbs a failed-hydrate empty editor and keeps the loaded baseline", () => {
    const decision = firstEditorChangeDecision(emptyDoc, writtenDoc);
    expect(decision.absorb).toBe(true);
    expect(decision.hydrateFallback).toBe(true);
    expect(decision.baseline).toBe(JSON.stringify(writtenDoc));
  });

  it("absorbs a structurally identical mount normalization", () => {
    const loaded = {
      root: { type: "root", children: [{ type: "paragraph", version: 1 }] },
    };
    const normalized = {
      root: { children: [{ version: 1, type: "paragraph" }], type: "root" },
    };
    const decision = firstEditorChangeDecision(normalized, loaded);
    expect(decision.absorb).toBe(true);
    expect(decision.hydrateFallback).toBe(false);
  });

  it("saves a structurally different first real edit", () => {
    const loaded = [{ type: "paragraph", children: [] }];
    const firstEdit = [
      { type: "paragraph", children: [{ type: "text", text: "first edit" }] },
    ];
    const decision = firstEditorChangeDecision(firstEdit, loaded);
    expect(decision.absorb).toBe(false);
    expect(decision.hydrateFallback).toBe(false);
    expect(decision.baseline).toBe(JSON.stringify(loaded));
  });
});

describe("cardSectionStashId", () => {
  it("isolates each card section from the full note and other anchors", () => {
    expect(cardSectionStashId("note-1", "anchor-1")).toBe(
      "card.note-1.anchor-1",
    );
    expect(cardSectionStashId("note-1", "anchor-1")).not.toBe(
      cardSectionStashId("note-1", "anchor-2"),
    );
  });
});

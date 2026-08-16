import { describe, expect, it } from "vitest";

import {
  cardSectionStashId,
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

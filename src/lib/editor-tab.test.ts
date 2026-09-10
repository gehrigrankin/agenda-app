import { describe, expect, it } from "vitest";
import { tabIntent } from "./editor-tab";

describe("tabIntent", () => {
  // The ticket: Tab must never fall through to inserting a tab character
  // mid-row — every plain-Tab-in-editor press has to become an indent.
  it("mid-row caret with a collapsed selection still indents, not inserts a tab", () => {
    expect(
      tabIntent({ shiftKey: false, inDecoratorInput: false, hasRangeSelection: false })
    ).toBe("indent");
  });

  it("shift+Tab outdents regardless of caret position", () => {
    expect(
      tabIntent({ shiftKey: true, inDecoratorInput: false, hasRangeSelection: false })
    ).toBe("outdent");
  });

  it("Tab inside a decorator's own input (e.g. a task row's input) is left alone", () => {
    expect(
      tabIntent({ shiftKey: false, inDecoratorInput: true, hasRangeSelection: false })
    ).toBe("ignore");
  });
});

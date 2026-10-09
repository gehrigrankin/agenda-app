/**
 * What the Tab key means inside the note editor.
 *
 * Tab moves the whole row, never inserts a tab character. @lexical/react's
 * stock TabIndentationPlugin only indents when the caret sits at offset 0 of
 * the block (`$indentOverTab`) and falls through to INSERT_TAB_COMMAND
 * everywhere else — which is the literal tab dropped mid-row that this
 * replaces. There is no case where tab spacing in the middle of a row is
 * wanted, so the decision here ignores where the caret is entirely.
 *
 * Pure so it can be unit-tested: the repo's Vitest setup is node-only, with no
 * DOM and no headless Lexical, so the plugin wrapper itself
 * (`src/components/editor/plugins/TabIndentPlugin.tsx`) is covered by hand.
 */

export type TabIntent = "indent" | "outdent" | "ignore";

export interface TabIntentInput {
  /** Shift was held: move the row out a level instead of in. */
  shiftKey: boolean;
  /**
   * The key landed in a decorator's own `<input>`/`<textarea>` — the task
   * chip's title field, which handles Tab itself (see TaskNode's `onIndent`).
   * It calls preventDefault but not stopPropagation, so the event still
   * reaches the editor root and would otherwise indent the row a second time.
   */
  inDecoratorInput: boolean;
  /**
   * The selection spans a range rather than sitting collapsed at a caret.
   * Deliberately not read: the whole point of the ticket is that neither the
   * caret's offset nor the shape of the selection changes the answer. Kept in
   * the input so call sites say that out loud.
   */
  hasRangeSelection: boolean;
}

/** Tab indents the row, Shift+Tab outdents it, chip inputs keep their own. */
export function tabIntent(input: TabIntentInput): TabIntent {
  if (input.inDecoratorInput) return "ignore";
  return input.shiftKey ? "outdent" : "indent";
}

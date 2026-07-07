import {
  $createParagraphNode,
  $createTextNode,
  type LexicalNode,
} from "lexical";

/**
 * The row ↔ task toggle hotkey: Mod+Shift+X ("x" as in `[x]`). Shared between
 * TaskShortcutsPlugin (editor-level keydown) and the task chip's inputs, which
 * swallow keystrokes before Lexical sees them. Matched on `code` so it works
 * on any keyboard layout; Alt excluded so AltGr combos still type.
 */
export function isTaskToggleHotkey(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyX";
}

/**
 * Replace a block node with a paragraph carrying `text`, caret at the end.
 * (In the daily editor the paragraph auto-becomes a TimedParagraphNode via
 * the composer's node replacement.)
 */
export function $replaceBlockWithParagraph(
  node: LexicalNode,
  text: string,
): void {
  const paragraph = $createParagraphNode();
  const trimmed = text.trim();
  if (trimmed) paragraph.append($createTextNode(trimmed));
  node.replace(paragraph);
  paragraph.selectEnd();
}

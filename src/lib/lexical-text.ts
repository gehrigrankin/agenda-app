import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

interface MaybeText {
  text?: unknown;
  children?: unknown;
  type?: unknown;
}

/**
 * Best-effort plain-text extraction from a serialized Lexical state, for note
 * previews. Walks the node tree, concatenating text nodes and inserting spaces
 * at block boundaries. Returns up to `max` characters.
 */
export function lexicalToPlainText(
  state: SerializedEditorState | null | undefined,
  max = 140,
): string {
  if (!state || typeof state !== "object") return "";
  const root = (state as { root?: SerializedLexicalNode }).root;
  if (!root) return "";

  let out = "";

  const walk = (node: SerializedLexicalNode & MaybeText) => {
    if (out.length >= max) return;
    if (typeof node.text === "string") {
      out += node.text;
    }
    if (node.type === "linebreak") {
      out += " ";
    }
    const children = node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (out.length >= max) break;
        walk(child as SerializedLexicalNode & MaybeText);
      }
      // Separate block-level nodes so words don't run together.
      if (out.length > 0 && !out.endsWith(" ")) out += " ";
    }
  };

  walk(root as SerializedLexicalNode & MaybeText);
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

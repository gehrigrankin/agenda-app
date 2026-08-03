import type { SerializedEditorState, SerializedLexicalNode } from "lexical";

interface MaybeText {
  text?: unknown;
  children?: unknown;
  type?: unknown;
  title?: unknown;
}

/**
 * Best-effort plain-text extraction from a serialized Lexical state, for note
 * previews and the search mirror. Walks the node tree, concatenating text
 * nodes (and the `title` props of decorator nodes that carry their text there)
 * and inserting spaces at block boundaries. Returns up to `max` characters of
 * the whitespace-collapsed output.
 */
export function lexicalToPlainText(
  state: SerializedEditorState | null | undefined,
  max = 140,
): string {
  if (!state || typeof state !== "object") return "";
  const root = (state as { root?: SerializedLexicalNode }).root;
  if (!root) return "";

  // `out` is kept in already-whitespace-collapsed form so `max` measures the
  // final output. Counting raw pre-collapse whitespace against the cap used to
  // truncate whitespace-heavy notes far before `max` characters of content.
  let out = "";
  const append = (raw: string) => {
    if (raw.length === 0) return;
    let s = raw.replace(/\s+/g, " ");
    if ((out === "" || out.endsWith(" ")) && s.startsWith(" ")) s = s.slice(1);
    out += s;
  };

  // Inline elements that carry children — a space after these would split
  // words around links ("foo[link]bar" → "foo link bar").
  const INLINE_TYPES = new Set(["link", "autolink", "note-link"]);

  // Decorator nodes whose text lives in a `title` prop instead of children
  // (task chips, note-link chips) — without this they are invisible to
  // search/previews. Serialized type names match the editor nodes'
  // exportJSON (TaskNode -> "task", NoteLinkNode -> "note-link").
  const TITLE_TYPES = new Set(["task", "note-link"]);

  const walk = (node: SerializedLexicalNode & MaybeText) => {
    if (out.length >= max) return;
    if (typeof node.text === "string") {
      append(node.text);
    }
    if (
      TITLE_TYPES.has(node.type as string) &&
      typeof node.title === "string"
    ) {
      append(node.title);
      // Task chips are block-level; separate them from what follows.
      // note-link chips are inline and must not split surrounding words.
      if (node.type === "task") append(" ");
    }
    if (node.type === "linebreak") {
      append(" ");
    }
    const children = node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (out.length >= max) break;
        walk(child as SerializedLexicalNode & MaybeText);
      }
      // Separate block-level nodes so words don't run together.
      if (
        out.length > 0 &&
        !out.endsWith(" ") &&
        !INLINE_TYPES.has(node.type as string)
      )
        append(" ");
    }
  };

  walk(root as SerializedLexicalNode & MaybeText);
  return out.trimEnd().slice(0, max);
}

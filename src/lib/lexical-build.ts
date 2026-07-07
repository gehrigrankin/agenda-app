import type { SerializedEditorState } from "lexical";

/**
 * Minimal builders for serialized Lexical content, for server code that
 * creates notes programmatically (thread promotion, saved answers). Emits the
 * stock node shapes the editor already parses; no Lexical runtime needed.
 */

interface SerializedNode {
  [key: string]: unknown;
}

export function textNode(text: string): SerializedNode {
  return {
    type: "text",
    version: 1,
    text,
    detail: 0,
    format: 0,
    mode: "normal",
    style: "",
  };
}

export function paragraph(text: string): SerializedNode {
  return {
    type: "paragraph",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children: text.length > 0 ? [textNode(text)] : [],
  };
}

export function heading(text: string, tag: "h1" | "h2" | "h3" = "h2"): SerializedNode {
  return {
    type: "heading",
    version: 1,
    tag,
    direction: null,
    format: "",
    indent: 0,
    children: [textNode(text)],
  };
}

export function quote(text: string): SerializedNode {
  return {
    type: "quote",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children: [textNode(text)],
  };
}

export function docFromBlocks(blocks: SerializedNode[]): SerializedEditorState {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: blocks,
    },
  } as unknown as SerializedEditorState;
}

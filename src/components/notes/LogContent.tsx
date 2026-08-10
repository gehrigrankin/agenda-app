import type { ReactNode } from "react";
import type { SerializedLexicalNode } from "lexical";
import { FileText } from "lucide-react";

/**
 * Read-only renderer for the serialized blocks a log carries.
 *
 * `note_logs.content` stores the actual Lexical nodes under the `[[+` heading,
 * not just their text — so the panel can show the section the way it was
 * written: bullets stay bullets, nesting stays nested, a checked box stays
 * checked. The plain-text mirror (`note_logs.text`) exists for search and as
 * the fallback here for rows written before content was stored.
 *
 * A plain React walk rather than a nested Lexical instance on purpose: the
 * panel is a SERVER component and a log is never editable in it (editing
 * belongs in the note that wrote it). One read-only tree per card costs
 * nothing; a live editor per card would mount a composer per log.
 *
 * Scaled down for a 17rem rail — this is a faithful reduction of the editor's
 * shapes, not a copy of `editorTheme`, whose sizes are built for a full page.
 * Unknown node types render their children rather than disappearing: a node
 * added later shows its text until it gets a case here.
 */

// Lexical's TextNode format bitmask (see lexical's IS_* constants).
const IS_BOLD = 1;
const IS_ITALIC = 2;
const IS_STRIKETHROUGH = 4;
const IS_UNDERLINE = 8;
const IS_CODE = 16;
const IS_SUBSCRIPT = 32;
const IS_SUPERSCRIPT = 64;
const IS_HIGHLIGHT = 128;

/** Serialized nodes are read defensively — this is JSONB written by any version. */
type Node = SerializedLexicalNode & Record<string, unknown>;

function childrenOf(node: Node): Node[] {
  return Array.isArray(node.children) ? (node.children as Node[]) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function Children({ node }: { node: Node }) {
  return (
    <>
      {childrenOf(node).map((child, i) => (
        <RenderNode key={i} node={child} />
      ))}
    </>
  );
}

/**
 * The `color` out of a serialized text node's inline style, if it looks like
 * one. Only color is honoured — the style string is document data, and piping
 * all of it into a style attribute would let a note restyle the panel.
 */
function colorOf(node: Node): string | undefined {
  const style = str(node.style);
  const match = /(?:^|;)\s*color:\s*([^;]+)/i.exec(style);
  const value = match?.[1]?.trim();
  return value && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|[a-z]+)$/i.test(value)
    ? value
    : undefined;
}

function TextRun({ node }: { node: Node }) {
  const text = str(node.text);
  if (text.length === 0) return null;
  const format = typeof node.format === "number" ? node.format : 0;

  let out: ReactNode = text;
  const color = colorOf(node);
  if (color) out = <span style={{ color }}>{out}</span>;
  if (format & IS_CODE) {
    out = (
      <code className="rounded bg-white/8 px-1 font-mono text-[0.9em]">
        {out}
      </code>
    );
  }
  if (format & IS_BOLD) out = <strong className="font-semibold text-ink-300">{out}</strong>;
  if (format & IS_ITALIC) out = <em>{out}</em>;
  if (format & IS_UNDERLINE) out = <u className="underline underline-offset-2">{out}</u>;
  if (format & IS_STRIKETHROUGH) out = <s className="text-ink-600">{out}</s>;
  if (format & IS_HIGHLIGHT) out = <mark className="rounded bg-sage/20 text-ink-200">{out}</mark>;
  if (format & IS_SUBSCRIPT) out = <sub>{out}</sub>;
  if (format & IS_SUPERSCRIPT) out = <sup>{out}</sup>;
  return <>{out}</>;
}

/** A list item that holds nothing but a nested list — Lexical's sublist wrapper. */
function isSublistWrapper(node: Node): boolean {
  const kids = childrenOf(node);
  return kids.length > 0 && kids.every((k) => k.type === "list");
}

function ListItem({
  node,
  listType,
  index,
}: {
  node: Node;
  listType: string;
  /** 1-based position among the items that actually take a marker. */
  index: number;
}) {
  // The wrapper <li> carries no content of its own; showing a marker for it
  // would draw an empty bullet above every nested group. The indent is the
  // marker for a nested level.
  if (isSublistWrapper(node)) {
    return (
      <li className="ml-3">
        <Children node={node} />
      </li>
    );
  }
  if (listType === "check" || typeof node.checked === "boolean") {
    const checked = node.checked === true;
    return (
      <li className="flex items-start gap-1.5">
        <span
          aria-hidden
          className={`mt-[0.3em] h-2.5 w-2.5 flex-none rounded-[0.1875rem] border ${
            checked ? "border-sage/70 bg-sage/70" : "border-ink-600"
          }`}
        />
        <span className={checked ? "min-w-0 flex-1 text-ink-600 line-through" : "min-w-0 flex-1"}>
          <Children node={node} />
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-1.5">
      <span aria-hidden className="flex-none select-none text-ink-500">
        {listType === "number" ? `${index}.` : "•"}
      </span>
      <span className="min-w-0 flex-1">
        <Children node={node} />
      </span>
    </li>
  );
}

/**
 * Markers are DRAWN, not left to `list-style`. Browser markers depend on
 * padding the reset strips, sit outside the item's box, and can't be recoloured
 * per level — in a 17rem rail that reads as "the bullets are missing". An
 * explicit glyph in a flex row also guarantees each item is its own block.
 */
function List({ node }: { node: Node }) {
  const listType = str(node.listType) || "bullet";
  const start = typeof node.start === "number" ? node.start : 1;

  // Sublist wrappers take no number, so numbering counts only real items.
  let counter = start - 1;
  const items = childrenOf(node).map((item) => {
    if (!isSublistWrapper(item)) counter += 1;
    return { item, index: counter };
  });

  return (
    <ul className="my-1 flex list-none flex-col gap-1">
      {items.map(({ item, index }, i) => (
        <ListItem key={i} node={item} listType={listType} index={index} />
      ))}
    </ul>
  );
}

function RenderNode({ node }: { node: Node }): ReactNode {
  switch (node.type) {
    case "text":
      return <TextRun node={node} />;

    case "linebreak":
      return <br />;

    case "tab":
      return <span className="inline-block w-4" />;

    case "link":
    case "autolink": {
      const url = str(node.url);
      if (!url) return <Children node={node} />;
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-steel underline underline-offset-2 hover:text-steel/80"
        >
          <Children node={node} />
        </a>
      );
    }

    // Chips carry their label in a prop, not in children.
    case "note-link":
      return (
        <span className="mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-full bg-white/8 px-1.5 align-baseline text-ink-300">
          <FileText className="h-2.5 w-2.5 shrink-0 self-center text-ink-500" />
          <span className="truncate">{str(node.title) || "Untitled"}</span>
        </span>
      );

    case "task": {
      const completed = node.completed === true;
      return (
        <div className="my-1 flex items-start gap-1.5">
          <span
            aria-hidden
            className={`mt-[0.3em] h-2.5 w-2.5 flex-none rounded-[0.1875rem] border ${
              completed ? "border-sage/70 bg-sage/70" : "border-ink-600"
            }`}
          />
          <span className={completed ? "min-w-0 text-ink-600 line-through" : "min-w-0"}>
            {str(node.title) || "Untitled task"}
          </span>
        </div>
      );
    }

    case "image": {
      const src = str(node.src);
      if (!src) return null;
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={str(node.altText)}
          className="my-1 max-h-40 max-w-full rounded-lg border border-white/8"
        />
      );
    }

    case "horizontalrule":
      return <hr className="my-2 border-t border-white/8" />;

    case "quote":
      return (
        <blockquote className="my-1 border-l-2 border-white/12 pl-2 italic">
          <Children node={node} />
        </blockquote>
      );

    case "code":
      return (
        <pre className="my-1 overflow-x-auto rounded-md bg-white/6 p-2 font-mono text-[0.6875rem] leading-[1.45]">
          <Children node={node} />
        </pre>
      );

    case "list":
      return <List node={node} />;

    // Only reachable for a stray item outside a list — a real one is rendered
    // by its List, which is what knows the marker style and the numbering.
    case "listitem":
      return <ListItem node={node} listType="bullet" index={1} />;

    case "heading":
    case "collapsible-heading":
    case "log-heading":
      // Rendered as an emphasized line, not an <h*>: inside a log card the
      // note's own heading levels have no relationship to the page's.
      return (
        <p className="mt-2 font-semibold text-ink-200 first:mt-0">
          <Children node={node} />
        </p>
      );

    case "paragraph":
    case "timed-paragraph": {
      // Blank paragraphs are spacing in a full-width editor; in a rail they
      // are just gaps between the lines that matter.
      if (childrenOf(node).length === 0) return null;
      return (
        <p>
          <Children node={node} />
        </p>
      );
    }

    default:
      return childrenOf(node).length > 0 ? <Children node={node} /> : null;
  }
}

/**
 * The blocks of one log, styled for the panel. Falls back to `text` when the
 * row has no stored content (logs written before the column existed), and
 * renders nothing at all when there is neither.
 */
export function LogContent({
  content,
  text,
}: {
  content: SerializedLexicalNode[];
  text: string;
}) {
  if (!Array.isArray(content) || content.length === 0) {
    if (!text) return null;
    return (
      <p className="mt-1 whitespace-pre-wrap text-[0.75rem] leading-[1.5] text-ink-400">
        {text}
      </p>
    );
  }

  return (
    <div className="mt-1 space-y-1 break-words text-[0.75rem] leading-[1.5] text-ink-400">
      {content.map((node, i) => (
        <RenderNode key={i} node={node as Node} />
      ))}
    </div>
  );
}

/**
 * Which agenda line a task written on a note belongs to.
 *
 * The daily note prints the owner's pinned tags as `agenda-section` headings —
 * the ruled lines of a paper agenda, drawn on the page instead of in the rail —
 * and whatever you write under one belongs to that subject, up to the next
 * heading. This reads that structure back out of the serialized document so a
 * task jotted under "Math" can pick up the Math tag when the note saves.
 *
 * Pure: no DB, no Lexical runtime. Sections are a TOP-LEVEL affair (a heading
 * nested inside a list neither opens nor closes one), and the input is
 * client-supplied JSON, so every shape here is checked rather than assumed.
 */

/** Serialized type of the heading that opens a section (AgendaSectionNode). */
const AGENDA_SECTION_TYPE = "agenda-section";

/** The other headings in this editor — each one ENDS the section in progress. */
const HEADING_TYPES = new Set(["heading", "collapsible-heading", "log-heading"]);

interface MaybeNode {
  type?: unknown;
  tagId?: unknown;
  taskId?: unknown;
  children?: unknown;
}

function asNode(value: unknown): MaybeNode | null {
  return value !== null && typeof value === "object"
    ? (value as MaybeNode)
    : null;
}

/** Any heading, section-opening or not. */
function isHeading(node: MaybeNode): boolean {
  return (
    node.type === AGENDA_SECTION_TYPE ||
    (typeof node.type === "string" && HEADING_TYPES.has(node.type))
  );
}

/** The agenda line this heading opens, or null if it opens none. */
function sectionTagId(node: MaybeNode): string | null {
  if (node.type !== AGENDA_SECTION_TYPE) return null;
  return typeof node.tagId === "string" && node.tagId ? node.tagId : null;
}

/**
 * Map every `task` node at or below `node` to `tagId`. Recurses because a task
 * can be nested — inside a list, a quote, a collapsible — and still sits under
 * the section heading as far as the reader is concerned.
 */
function collectTasks(
  node: unknown,
  tagId: string,
  out: Map<string, string>,
): void {
  const n = asNode(node);
  if (!n) return;
  if (n.type === "task" && typeof n.taskId === "string" && n.taskId) {
    // First mention wins, matching "first line wins" for a multi-tag task:
    // one task appears on one line, and document order decides which.
    if (!out.has(n.taskId)) out.set(n.taskId, tagId);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectTasks(child, tagId, out);
  }
}

/** Task ids → the agenda line (tag id) of the section they sit in. */
export function collectTaskSectionTags(root: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const r = asNode(root);
  if (!r || !Array.isArray(r.children)) return out;

  let current: string | null = null;
  for (const child of r.children) {
    const node = asNode(child);
    if (!node) continue;
    if (isHeading(node)) {
      // A new heading always ends the section in progress; only an
      // agenda-section carrying a tag id opens another. (A malformed one
      // opens nothing — its content belongs to no line rather than to the
      // previous subject.)
      current = sectionTagId(node);
      continue;
    }
    if (current) collectTasks(node, current, out);
  }
  return out;
}

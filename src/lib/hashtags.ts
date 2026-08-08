/**
 * Hashtag parsing for the task quick-add: typing "call the dentist #health"
 * files the task under a tag without ever leaving the input. Pure string work
 * — no DB, no auth; the caller resolves the returned names to tag rows.
 *
 * A tag is "#" followed by one or more letters, digits, "-" or "_", and only
 * counts when the "#" OPENS a word (start of the input, or straight after
 * whitespace). That boundary rule is the whole reason "C#", "issue#42" and a
 * markdown "##heading" don't quietly become tags.
 */

/** A task title split from the #tags typed into it. */
export type ParsedHashtags = { title: string; tags: string[] };

// Letters, digits, "-" and "_". \p{M} keeps combining marks attached to their
// letter so a decomposed "café" tags the same as a precomposed "café";
// the trailing "-" is literal (last position in the class).
const TAG_CHARS = String.raw`\p{L}\p{M}\p{N}_-`;

/** `(^|\s)#name` — group 1 is the opening boundary, group 2 the tag name. */
const TAG_RE = new RegExp(`(^|\\s)#([${TAG_CHARS}]+)`, "gu");

const TAG_NAME_RE = new RegExp(`^[${TAG_CHARS}]+$`, "u");

/** Past this a "tag" is a sentence, not a label. */
const MAX_TAG_NAME_LENGTH = 32;

/**
 * Split `input` into the title the user meant and the tags they typed.
 * Tags may sit anywhere in the string, are normalized and deduped (first
 * appearance wins), and are cut out of the title along with the whitespace
 * that introduced them — so "pay rent #home, then relax" closes up to
 * "pay rent, then relax" rather than stranding a space before the comma.
 * Remaining whitespace is collapsed and trimmed, which leaves an empty title
 * for a tags-only input like "#health"; what to do about that is the caller's
 * call. Length isn't enforced here either — run `isValidTagName` over the
 * result before persisting.
 */
export function parseHashtags(input: string): ParsedHashtags {
  const tags: string[] = [];
  const seen = new Set<string>();
  const stripped = input.replace(TAG_RE, (_match, _boundary: string, name: string) => {
    const tag = normalizeTagName(name);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
    return "";
  });
  return { title: stripped.replace(/\s+/g, " ").trim(), tags };
}

/** Normalized form used to compare/dedupe tag names. */
export function normalizeTagName(name: string): string {
  return name
    .trim()
    .replace(/^#/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** True when `name` is usable as a tag name. */
export function isValidTagName(name: string): boolean {
  const normalized = normalizeTagName(name);
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_TAG_NAME_LENGTH &&
    TAG_NAME_RE.test(normalized)
  );
}

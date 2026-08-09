/**
 * The "!" marker for the task quick-add: typing "call the plumber !" flags the
 * task important without leaving the input, the same way "#health" files it
 * under a tag (see `./hashtags`). Pure string work — no DB, no auth.
 *
 * A marker is a "!" standing alone as its own word: it must OPEN a word (start
 * of the input or straight after whitespace) and CLOSE one (end of the input or
 * straight before whitespace). That both-sides boundary is deliberately
 * stricter than the hashtag rule, because "!" is ordinary punctuation — it is
 * the only thing keeping "ship it!", "wat!?" and "!important" out of the flag.
 */

/** A task title split from the "!" marker typed into it. */
export type ParsedImportance = { title: string; important: boolean };

/** `(^|\s)!(?=\s|$)` — a lone "!" token, anywhere in the string. */
const BANG_RE = /(^|\s)!(?=\s|$)/g;

/**
 * Split `input` into the title the user meant and whether they flagged it.
 * The marker may sit anywhere and may repeat ("! call mom !" is one flag); it
 * is cut out along with the whitespace that introduced it, and the remaining
 * whitespace is collapsed and trimmed. A marker-only input like "!" leaves an
 * empty title — what to do about that is the caller's call, matching
 * `parseHashtags`.
 */
export function parseImportantMark(input: string): ParsedImportance {
  let important = false;
  const stripped = input.replace(BANG_RE, () => {
    important = true;
    return "";
  });
  return { title: stripped.replace(/\s+/g, " ").trim(), important };
}

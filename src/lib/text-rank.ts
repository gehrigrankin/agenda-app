/**
 * Tiny lexical ranking used by the AI features to pick candidate notes before
 * (or instead of) calling the model: ask-your-notes narrows the corpus with
 * it, and ambient recall runs on it alone. Deliberately dependency-free and
 * personal-scale — no index, just term overlap with title and recency boosts.
 */

const STOPWORDS = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as",
  "at", "be", "because", "been", "before", "but", "by", "can", "could", "did",
  "do", "does", "for", "from", "get", "got", "had", "has", "have", "he", "her",
  "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just",
  "like", "me", "my", "no", "not", "of", "on", "one", "or", "our", "out",
  "she", "should", "so", "some", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "to", "up", "us", "was", "we",
  "were", "what", "when", "where", "which", "who", "will", "with", "would",
  "you", "your",
]);

/** Meaningful lowercase terms from free text, longest-first, capped. */
export function keywords(text: string, max = 12): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return [...seen].sort((a, b) => b.length - a.length).slice(0, max);
}

/**
 * Overlap score of `terms` against a note. Title hits weigh 3x body hits;
 * multiple occurrences of a term add diminishing returns (counted once plus a
 * small repeat bonus).
 */
export function scoreText(
  terms: string[],
  body: string,
  title: string,
): number {
  if (terms.length === 0) return 0;
  const lowerBody = body.toLowerCase();
  const lowerTitle = title.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lowerTitle.includes(term)) score += 3;
    const first = lowerBody.indexOf(term);
    if (first >= 0) {
      score += 1;
      if (lowerBody.indexOf(term, first + term.length) >= 0) score += 0.5;
    }
  }
  return score;
}

/**
 * The sentence (or line) of `body` that matches `terms` best — used as the
 * snippet shown on recall cards and thread mentions. Returns "" when nothing
 * matches.
 */
export function bestSnippet(terms: string[], body: string, max = 160): string {
  const pieces = body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let best = "";
  let bestScore = 0;
  for (const piece of pieces) {
    const lower = piece.toLowerCase();
    let score = 0;
    for (const term of terms) if (lower.includes(term)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = piece;
    }
  }
  if (best.length > max) best = `${best.slice(0, max - 1)}…`;
  return best;
}

/** Days between two dates, non-negative. */
export function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/**
 * Recency boost in [0, 1]: 1 for touched today decaying to ~0 after 90 days.
 */
export function recencyBoost(updatedAt: Date, now = new Date()): number {
  const days = daysBetween(updatedAt, now);
  return Math.max(0, 1 - days / 90);
}

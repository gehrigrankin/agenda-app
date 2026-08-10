/**
 * Structural equality for parsed JSON, insensitive to object key order.
 *
 * Exists for one specific comparison: "is this serialized editor state the
 * same document I loaded?" `JSON.stringify` can't answer that, because note
 * content round-trips through Postgres `jsonb`, which canonicalizes key order
 * — the same document comes back stringifying differently than Lexical wrote
 * it. Key order is not information here, so it is not compared.
 *
 * Arrays ARE order-sensitive: block order is the document.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  // NaN !== NaN, and neither is a value note content should contain, but a
  // comparison that silently reports "different" forever would cause an
  // unexplained save on every mount.
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b);
  }

  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    return x.every((v, i) => deepEqual(v, y[i]));
  }

  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const xKeys = Object.keys(x);
  const yKeys = Object.keys(y);
  if (xKeys.length !== yKeys.length) return false;
  // Own-property check, not `in`: an inherited key would otherwise let a
  // shorter object match a longer one.
  return xKeys.every(
    (k) => Object.prototype.hasOwnProperty.call(y, k) && deepEqual(x[k], y[k]),
  );
}

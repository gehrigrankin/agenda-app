import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
const home = readFileSync(
  resolve(root, "src/components/home/HomeClient.tsx"),
  "utf8",
);
const loading = readFileSync(resolve(root, "src/app/app/loading.tsx"), "utf8");

// Brace-balanced parsing, not a lazy-star regex against the raw text: a
// regex like /\.foo\s*{[\s\S]*?bar/ is happy to match across an unrelated
// rule's closing brace into the next one. This is still only a check of the
// CSS *source* — there's no jsdom/Playwright wired into vitest here to
// assert the computed layout, so the boundary was eyeballed in a real
// browser (see /verify) rather than asserted in this suite.
function extractBalancedBlock(source: string, openBraceIndex: number) {
  let depth = 1;
  let i = openBraceIndex + 1;
  while (depth > 0 && i < source.length) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(openBraceIndex + 1, i - 1);
}

function parseRules(block: string) {
  const rules: { selectors: string[]; declarations: Record<string, string> }[] = [];
  let i = 0;
  while (i < block.length) {
    const braceIdx = block.indexOf("{", i);
    if (braceIdx === -1) break;
    const selectors = block
      .slice(i, braceIdx)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const body = extractBalancedBlock(block, braceIdx);
    const declarations: Record<string, string> = {};
    for (const stmt of body.split(";")) {
      const colonIdx = stmt.indexOf(":");
      if (colonIdx === -1) continue;
      declarations[stmt.slice(0, colonIdx).trim()] = stmt
        .slice(colonIdx + 1)
        .trim();
    }
    rules.push({ selectors, declarations });
    i = braceIdx + body.length + 2; // past the matching close brace
  }
  return rules;
}

const MEDIA_PRELUDE =
  "@media (min-width: 768px) and (max-width: 1279px) and (max-aspect-ratio: 4/5)";
const preludeIdx = css.indexOf(MEDIA_PRELUDE);
const mediaOpenBrace = css.indexOf("{", preludeIdx);
const portraitBlock =
  preludeIdx === -1 ? "" : extractBalancedBlock(css, mediaOpenBrace);
const portraitRules = parseRules(portraitBlock);

// A selector can recur across separate rule blocks (e.g. .home-grid-daily
// picks up grid-column from the grouped rule and grid-row/min-height from
// its own) — merge in source order, same as the cascade would for equal
// specificity, rather than returning only the first block's declarations.
function declarationsFor(selector: string) {
  const matches = portraitRules.filter((r) => r.selectors.includes(selector));
  if (matches.length === 0) {
    throw new Error(`no rule for "${selector}" in the portrait media block`);
  }
  return matches.reduce<Record<string, string>>(
    (acc, r) => ({ ...acc, ...r.declarations }),
    {},
  );
}

describe("home portrait layout", () => {
  it("is bounded to portrait tablets — 768-1279px, tall enough that aspect-ratio <= 4/5", () => {
    expect(preludeIdx).toBeGreaterThan(-1);
    // Decoupled from the string match above so a boundary typo (e.g. 769,
    // 1278, 3/5) fails on its own assertion instead of silently passing
    // because the literal-string test already covers it.
    const [, minWidth, maxWidth, aspectNum, aspectDenom] =
      MEDIA_PRELUDE.match(
        /min-width: (\d+)px.*max-width: (\d+)px.*max-aspect-ratio: (\d+)\/(\d+)/,
      ) ?? [];
    expect(minWidth).toBe("768");
    expect(maxWidth).toBe("1279");
    expect(aspectNum).toBe("4");
    expect(aspectDenom).toBe("5");
  });

  it("collapses to a single column", () => {
    expect(declarationsFor(".home-grid")["grid-template-columns"]).toBe(
      "minmax(0, 1fr)",
    );
    expect(declarationsFor(".home-grid")["grid-template-rows"]).toBe(
      "auto auto auto",
    );
  });

  it("stacks daily note, then rail, then secondary widgets, each with a floor that stops it collapsing", () => {
    const daily = declarationsFor(".home-grid-daily");
    expect(daily["grid-row"]).toBe("1");
    expect(daily["min-height"]).toBe("26.25rem");

    const rail = declarationsFor(".home-grid-rail");
    expect(rail["grid-row"]).toBe("2");
    expect(rail["min-height"]).toBe("22rem");

    const secondary = declarationsFor(".home-grid-secondary");
    expect(secondary["grid-row"]).toBe("3");
    expect(secondary["flex-direction"]).toBe("column");

    const secondaryItems = declarationsFor(".home-grid-secondary > *");
    expect(secondaryItems["width"]).toBe("100%");
    expect(secondaryItems["min-height"]).toBe("10rem");
  });

  it("does not force the daily note to eat the full viewport before the rail appears", () => {
    // Regression guard: an earlier draft sized row one to
    // max(30rem, calc(100dvh - 4.5rem)) — copied from the base two-column
    // rule, where a full-viewport row one keeps a side-by-side rail from
    // collapsing. Single-column, that just pushes the rail a screen-height
    // down the page for no reason; the daily note only needs its own floor.
    expect(css).not.toMatch(/calc\(100dvh - 4\.5rem\)\) auto auto;/);
  });

  it.each([home, loading])(
    "marks each home region so the loaded and loading layouts stay aligned",
    (source) => {
      expect(source).toContain("home-grid-daily");
      expect(source).toContain("home-grid-rail");
      expect(source).toContain("home-grid-secondary");
    },
  );
});

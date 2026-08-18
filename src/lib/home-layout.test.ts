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

describe("home portrait layout", () => {
  it("is bounded away from the phone and xl dashboard layouts", () => {
    expect(css).toContain(
      "@media (min-width: 768px) and (max-width: 1279px) and (max-aspect-ratio: 4/5)",
    );
  });

  it.each([home, loading])(
    "marks each home region so the loaded and loading layouts stay aligned",
    (source) => {
      expect(source).toContain("home-grid-daily");
      expect(source).toContain("home-grid-rail");
      expect(source).toContain("home-grid-secondary");
    },
  );

  it("places secondary widgets below the daily note in a vertical stack", () => {
    expect(css).toMatch(/\.home-grid-rail\s*{[\s\S]*?grid-row: 2;/);
    expect(css).toMatch(/\.home-grid-secondary\s*{[\s\S]*?grid-row: 3;/);
    expect(css).toMatch(/\.home-grid-secondary\s*{[\s\S]*?flex-direction: column;/);
  });
});

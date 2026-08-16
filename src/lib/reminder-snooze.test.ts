import { describe, expect, it } from "vitest";
import { snoozeUntil } from "./reminder-snooze";

describe("snoozeUntil", () => {
  const now = new Date(2026, 7, 15, 14, 30);

  it("supports relative snoozes", () => {
    expect(snoozeUntil("10m", now).getTime() - now.getTime()).toBe(600_000);
    expect(snoozeUntil("1h", now).getTime() - now.getTime()).toBe(3_600_000);
  });

  it("uses 8pm tonight and 9am tomorrow", () => {
    expect(snoozeUntil("tonight", now).getHours()).toBe(20);
    const tomorrow = snoozeUntil("tomorrow", now);
    expect(tomorrow.getDate()).toBe(16);
    expect(tomorrow.getHours()).toBe(9);
  });

  it("moves Tonight to the next evening after 8pm", () => {
    const late = new Date(2026, 7, 15, 21, 0);
    expect(snoozeUntil("tonight", late).getDate()).toBe(16);
  });
});

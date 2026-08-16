export type SnoozeChoice = "10m" | "1h" | "tonight" | "tomorrow";

/** Compute in the browser so Tonight/Tomorrow follow the device's local zone. */
export function snoozeUntil(choice: SnoozeChoice, now = new Date()): Date {
  if (choice === "10m") return new Date(now.getTime() + 10 * 60_000);
  if (choice === "1h") return new Date(now.getTime() + 60 * 60_000);

  const result = new Date(now);
  if (choice === "tonight") {
    result.setHours(20, 0, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
  } else {
    result.setDate(result.getDate() + 1);
    result.setHours(9, 0, 0, 0);
  }
  return result;
}

"use client";

import { CheckGlyph } from "./atoms";
import type { HabitView } from "./useTodayAgenda";

/**
 * Today's habits as one printed row of tick boxes. Only today is tappable;
 * earlier days of the week show what was logged. Streak counts show on today.
 */
export function HabitsRow({
  habits,
  editable,
  onToggle,
  wide,
}: {
  habits: HabitView[];
  editable: boolean;
  onToggle: (id: string) => void;
  wide: boolean;
}) {
  if (habits.length === 0) return null;
  return (
    <div
      className={`flex h-11 flex-none items-center overflow-hidden whitespace-nowrap border-b border-white/8 ${
        wide ? "gap-[1.125rem]" : "mx-5 gap-4"
      }`}
    >
      {habits.map((h) => (
        <button
          key={h.id}
          type="button"
          role="checkbox"
          aria-checked={h.done}
          disabled={!editable}
          onClick={() => onToggle(h.id)}
          className="flex h-11 flex-none items-center gap-2 disabled:cursor-default"
        >
          <span
            className={`flex h-[1.125rem] w-[1.125rem] items-center justify-center rounded-[0.3125rem] ${
              h.done ? "bg-sage" : "border-[1.5px] border-solid border-ink-700"
            }`}
          >
            {h.done && <CheckGlyph size="sm" />}
          </span>
          <span
            className={`text-[0.8125rem] font-medium leading-none ${
              h.done ? "text-sage-soft" : "text-ink-350"
            }`}
          >
            {h.title}
          </span>
          {editable && h.streak > 0 && (
            <span className="font-mono text-[0.65625rem] font-medium leading-none text-ink-500">
              {h.streak}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

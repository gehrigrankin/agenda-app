"use client";

import { useCallback, useState, type MutableRefObject } from "react";
import type { LexicalEditor } from "lexical";
import { CalendarCheck, LineChart, NotebookText, Sparkles } from "lucide-react";

import { localDateString } from "@/lib/dates";
import { DailyPlanCard } from "./DailyPlanCard";
import { HabitStrip } from "./HabitStrip";
import { MeetingModeCard } from "./MeetingModeCard";
import { WeekReviewCard } from "./WeekReviewCard";

/**
 * Home interruption budget (CONTEXT.md §product coherence): at most ONE full
 * card sits above the daily editor — meeting > plan > week review — and
 * everything else that's available collapses into a single quiet digest chip
 * row directly under it (or alone when nothing takes the slot).
 *
 * The cards keep their own fetch + dismissal logic untouched; they stay
 * mounted with `collapsed` (rendering null) and report availability up via
 * `onStatusChange(available, count?, done?)` where `null` means "still
 * resolving". The slot is only granted once every HIGHER-priority card has
 * resolved, so the winner never gets swapped out from under the user. Tapping
 * a chip swaps that card into the full slot for the session; a card's own
 * dismiss/hide (plan localStorage-daily, meeting sessionStorage, …) reports
 * unavailable and the slot falls to the next priority. The habit strip never
 * takes the slot on its own — it lives in the digest until tapped.
 *
 * While availabilities resolve the digest area reserves a single row height
 * (min-h below) so settling never shifts layout worse than the old cards did.
 */

type CardKey = "meeting" | "plan" | "review" | "habits";

type Reported = {
  /** null = still resolving; false/true once the card knows. */
  available: boolean | null;
  count: number;
  done: number;
};

const RESOLVING: Reported = { available: null, count: 0, done: 0 };
const NONE: Reported = { available: false, count: 0, done: 0 };

/** Who may claim the one full slot, best first. Habits never auto-claim. */
const SLOT_PRIORITY: readonly CardKey[] = ["meeting", "plan", "review"];
const ALL_KEYS: readonly CardKey[] = ["meeting", "plan", "review", "habits"];

const CHIP_ICON: Record<CardKey, typeof Sparkles> = {
  meeting: CalendarCheck,
  plan: Sparkles,
  review: NotebookText,
  habits: LineChart,
};

function chipLabel(key: CardKey, s: Reported): string {
  if (key === "plan") return `Plan (${s.count})`;
  if (key === "habits") return `${s.done}/${s.count} habits`;
  if (key === "review") return "Week review";
  return "Meeting";
}

export function DailyStack({
  dateStr,
  isToday,
  noteId,
  editorRef,
  planEligible,
  onPlanInserted,
}: {
  dateStr: string;
  isToday: boolean;
  /** The viewed day's note id; null when the day has no note (review only). */
  noteId: string | null;
  editorRef: MutableRefObject<LexicalEditor | null>;
  /** Today + empty note + not dismissed today — owned by DailyEditor. */
  planEligible: boolean;
  onPlanInserted?: () => void;
}) {
  const [reported, setReported] = useState<Record<CardKey, Reported>>({
    meeting: RESOLVING,
    plan: RESOLVING,
    review: RESOLVING,
    habits: RESOLVING,
  });
  // Chip tap pins a card into the full slot for the session; falls back to
  // priority order whenever the pinned card reports unavailable.
  const [manual, setManual] = useState<CardKey | null>(null);

  const report = useCallback(
    (key: CardKey, available: boolean | null, count = 0, done = 0) => {
      setReported((prev) => {
        const cur = prev[key];
        if (
          cur.available === available &&
          cur.count === count &&
          cur.done === done
        ) {
          return prev;
        }
        return { ...prev, [key]: { available, count, done } };
      });
    },
    [],
  );
  const reportMeeting = useCallback(
    (a: boolean | null) => report("meeting", a),
    [report],
  );
  const reportPlan = useCallback(
    (a: boolean | null, count = 0) => report("plan", a, count),
    [report],
  );
  const reportReview = useCallback(
    (a: boolean | null) => report("review", a),
    [report],
  );
  const reportHabits = useCallback(
    (a: boolean | null, count = 0, done = 0) =>
      report("habits", a, count, done),
    [report],
  );

  const isSunday = new Date(`${dateStr}T00:00:00`).getDay() === 0;
  const isFuture = dateStr > localDateString();

  const mountMeeting = isToday && noteId !== null;
  const mountPlan = isToday && planEligible;
  // A retro only makes sense for a week that has happened.
  const mountReview = isSunday && !isFuture;
  const mountHabits = isToday;

  // Unmounted cards never report — treat them as resolved-unavailable.
  const status: Record<CardKey, Reported> = {
    meeting: mountMeeting ? reported.meeting : NONE,
    plan: mountPlan ? reported.plan : NONE,
    review: mountReview ? reported.review : NONE,
    habits: mountHabits ? reported.habits : NONE,
  };

  let auto: CardKey | null = null;
  for (const key of SLOT_PRIORITY) {
    const s = status[key];
    // Hold the slot open until every higher-priority card has resolved, so
    // a lower card never appears and then gets swapped out.
    if (s.available === null) break;
    if (s.available) {
      auto = key;
      break;
    }
  }
  const expanded =
    manual !== null && status[manual].available === true ? manual : auto;

  const chips = ALL_KEYS.filter(
    (k) => k !== expanded && status[k].available === true,
  );
  const resolving = ALL_KEYS.some((k) => status[k].available === null);

  if (!mountMeeting && !mountPlan && !mountReview && !mountHabits) return null;

  return (
    <>
      {/* The one full slot. empty:hidden collapses the wrapper (and its
          padding) when every mounted card renders nothing; min-h-0 +
          overflow-y-auto lets a tall card yield and scroll instead of
          squeezing the editor out entirely. */}
      <div className="mx-auto flex min-h-0 w-full max-w-[48.125rem] flex-col gap-3 overflow-y-auto px-4 pt-4 empty:hidden md:pl-[4.125rem] md:pr-7 2xl:max-w-[56rem]">
        {mountMeeting && (
          <MeetingModeCard
            isToday={isToday}
            dateStr={dateStr}
            todayNoteId={noteId}
            editorRef={editorRef}
            collapsed={expanded !== "meeting"}
            onStatusChange={reportMeeting}
          />
        )}
        {mountPlan && (
          <DailyPlanCard
            dateStr={dateStr}
            editorRef={editorRef}
            onInserted={onPlanInserted}
            collapsed={expanded !== "plan"}
            onStatusChange={reportPlan}
          />
        )}
        {mountReview && (
          <WeekReviewCard
            viewedDate={dateStr}
            editorRef={editorRef}
            dailyNoteId={noteId}
            collapsed={expanded !== "review"}
            onStatusChange={reportReview}
          />
        )}
      </div>

      {/* Full habit strip when swapped in — it carries its own wrappers. */}
      {mountHabits && (
        <HabitStrip
          dateStr={dateStr}
          collapsed={expanded !== "habits"}
          onStatusChange={reportHabits}
        />
      )}

      {/* Digest chip row: everything available that isn't in the slot. Kept
          at a reserved single-row height while availabilities resolve. */}
      {(resolving || chips.length > 0) && (
        <div className="mx-auto w-full max-w-[48.125rem] flex-none px-4 pt-3 md:pl-[4.125rem] md:pr-7 2xl:max-w-[56rem]">
          <div className="flex min-h-[1.75rem] flex-wrap items-center gap-1.5">
            {chips.map((key) => {
              const Icon = CHIP_ICON[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setManual(key)}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/4 px-2.5 py-1 text-[0.6875rem] font-medium text-ink-400 hover:bg-white/8 hover:text-ink-200"
                >
                  <Icon className="h-3 w-3 text-ink-500" />
                  {chipLabel(key, status[key])}
                </button>
              );
            })}
            {resolving && chips.length === 0 && (
              <span className="h-[1.625rem] w-40 animate-pulse rounded-full bg-white/5" />
            )}
          </div>
        </div>
      )}
    </>
  );
}

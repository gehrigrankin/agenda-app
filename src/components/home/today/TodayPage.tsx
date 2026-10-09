"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import { Inbox, Maximize2, Minimize2, PanelLeft, Plus } from "lucide-react";

import { CreateMenu } from "@/components/layout/CreateMenu";
import {
  focusSummary,
  notesSummary,
  plural,
  scheduleSummary,
  tasksSummary,
  wordCount,
  DOW_SHORT,
  dayOfMonth,
  weekdayIndex,
} from "@/lib/agenda-today";
import { DATE_STR_RE, addDays, localDateString, weekDays } from "@/lib/dates";
import { lexicalToPlainText } from "@/lib/lexical-text";
import { useDailyNoteWindow, type CachedDay } from "@/lib/hooks/use-daily-note-window";
import { useDaySwipe } from "@/lib/hooks/use-day-swipe";

import { DailyNoteWidget, NOTES_TOOLS_HOST_ID } from "../DailyNoteWidget";
import { AddEventForm, AddTaskForm } from "./AddForms";
import { RoundButton, SummaryChips, TodayJump, Hairline, SECTION_LABEL } from "./atoms";
import { DayHeader } from "./DayHeader";
import { DayTab, dayDot } from "./DayTabs";
import { HabitsRow } from "./HabitsRow";
import { ItemPanel, type PanelTarget } from "./ItemPanel";
import { EventList, EventStrip } from "./Schedule";
import { HeaderAddButton, SectionHeader } from "./SectionHeader";
import { TaskList } from "./TaskList";
import { useTodayAgenda, type DayEvent, type DayTask, type DayView } from "./useTodayAgenda";
import { WeekSpread } from "./WeekSpread";
import { WeekPanel, WeekStripFolded, type WeekDay } from "./WeekViews";

/**
 * The Today page as a school agenda (design "Today Agenda", Turns 6–7).
 *
 * Phone: Week | Day, and the book opens to the WEEK — the spread
 * (WeekSpread.tsx): the seven days ruled into subject columns, today's row
 * ribboned; a tap on a day or a cell zooms into the Day page. A link to a
 * specific day (?d=) opens on Day. Day is the open page — seven day tabs,
 * the printed date, today's habits, then three foldable sections: Schedule
 * (a strip of event cards), Tasks (a checklist) and Notes (the daily note).
 * Tapping into the note goes full screen with a context bar of what's on,
 * late and due.
 *
 * Tablet/desktop: the planner opened flat — the agenda on the left page, the
 * daily note on the right, with the week in a scrolling panel beside them
 * (foldable to a strip of dates). ⤢ on the note hides everything but the
 * note for focused writing.
 *
 * Events and tasks open an item panel (sheet on phone, slide-in on wide) to
 * rename, retime, re-subject, move, annotate, tick off or delete them.
 *
 * The viewed day is client state with the URL (?d=) kept in step through the
 * history API, so days are linkable and Back walks them without a server
 * round trip per page turn (TopBar's day switcher relies on that contract).
 */

/** Tasks shown before a heavy day folds the rest behind "N more due". */
const FOLD_AFTER = 4;
const WEEK_PANEL_KEY = "today-week-panel";

type Sections = { schedule: boolean; tasks: boolean; notes: boolean };

function useIsWide(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return wide;
}

function noteText(day: CachedDay): string {
  return day ? lexicalToPlainText(day.content, 2000) : "";
}

/** The viewed day's note as plain text, live while it's being written. */
function useLiveNoteText(
  editorRef: React.MutableRefObject<LexicalEditor | null>,
  noteId: string | null,
  fallback: string,
): string {
  const [live, setLive] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!noteId) return;
    let unregister: (() => void) | null = null;
    let tries = 0;
    let timer: number | null = null;
    // The editor mounts a beat after the note id is known.
    const attach = () => {
      const editor = editorRef.current;
      if (!editor) {
        if (tries++ < 20) timer = window.setTimeout(attach, 100);
        return;
      }
      unregister = editor.registerUpdateListener(({ editorState }) => {
        const text = editorState.read(() => $getRoot().getTextContent());
        setLive({ id: noteId, text });
      });
    };
    attach();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unregister?.();
    };
  }, [editorRef, noteId]);
  return live && live.id === noteId ? live.text : fallback;
}

export function TodayPage({
  viewDate,
  cacheScope,
}: {
  viewDate: string | null;
  cacheScope: string;
}) {
  // Today is CLIENT-local; resolve after mount so SSR stays deterministic.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString());
    // Roll over at midnight without a reload.
    const id = window.setInterval(() => setToday(localDateString()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const [viewedDate, setViewedDate] = useState<string | null>(viewDate);
  const viewed = today === null ? null : (viewedDate ?? today);
  useEffect(() => {
    setViewedDate(viewDate);
  }, [viewDate]);

  const [adding, setAdding] = useState<"event" | "task" | null>(null);
  const [panel, setPanel] = useState<PanelTarget | null>(null);

  const goToDay = useCallback(
    (target: string) => {
      setViewedDate(target);
      setAdding(null);
      const url = today !== null && target === today ? "/app" : `/app?d=${target}`;
      window.history.pushState(null, "", url);
    },
    [today],
  );

  useEffect(() => {
    const onPop = () => {
      const d = new URLSearchParams(window.location.search).get("d");
      setViewedDate(d && DATE_STR_RE.test(d) ? d : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const agenda = useTodayAgenda(viewed, today);
  const notes = useDailyNoteWindow(viewed, today, cacheScope);
  const editorRef = useRef<LexicalEditor | null>(null);
  const wide = useIsWide();

  const note = notes.get(viewed);
  const liveText = useLiveNoteText(editorRef, note?.id ?? null, noteText(note));

  const view: DayView | null = viewed ? agenda.dayView(viewed) : null;

  const weekStart = agenda.weekStart;
  const week: WeekDay[] = useMemo(
    () =>
      weekStart
        ? weekDays(weekStart).map((date) => ({
            date,
            view: agenda.dayView(date),
            noteText: date === viewed ? liveText : noteText(notes.get(date)),
          }))
        : [],
    [weekStart, agenda, viewed, liveText, notes],
  );

  // ---- sections / folds ---------------------------------------------------
  const [open, setOpen] = useState<Sections>({ schedule: true, tasks: true, notes: true });
  const toggle = (k: keyof Sections) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const startAdd = (kind: "event" | "task") => {
    setAdding(kind);
    setOpen((o) => ({ ...o, [kind === "event" ? "schedule" : "tasks"]: true }));
  };

  const openEvent = (e: DayEvent) => setPanel({ kind: "event", id: e.id });
  const openTask = (t: DayTask) => setPanel({ kind: "task", id: t.id });
  const closePanel = useCallback(() => setPanel(null), []);

  // ---- swipe --------------------------------------------------------------
  // ---- phone: Day | Week, writing mode -------------------------------------
  // The spread is the landing page; a deep link to a day lands on the day.
  const [phoneView, setPhoneView] = useState<"day" | "week">(
    viewDate === null ? "week" : "day",
  );
  const [writing, setWriting] = useState(false);
  const notesRef = useRef<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState(false);

  // The swipe surface is the phone's day page or the wide left page — a
  // different element per layout, so the listeners rebind when it changes.
  const swipeSurface = wide ? (focus ? "none" : "wide") : phoneView === "day" && !writing ? "phone" : "none";
  const swipeRef = useDaySwipe({
    onPrev: () => viewed && goToDay(addDays(viewed, -1)),
    onNext: () => viewed && goToDay(addDays(viewed, 1)),
    enabled: viewed !== null && swipeSurface !== "none",
    bindKey: swipeSurface,
  });

  // ---- wide: week panel, focus --------------------------------------------
  const [weekOpen, setWeekOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(WEEK_PANEL_KEY) === "folded") setWeekOpen(false);
    } catch {
      // Per-viewer convenience only.
    }
  }, []);
  const toggleWeek = () => {
    setWeekOpen((o) => {
      try {
        localStorage.setItem(WEEK_PANEL_KEY, o ? "folded" : "open");
      } catch {
        // Per-viewer convenience only.
      }
      return !o;
    });
  };

  if (!today || !viewed || wide === null) {
    return <TodaySkeleton />;
  }

  const isToday = viewed === today;
  const habits = agenda.habitsFor(viewed);
  const events = view?.events ?? [];
  const phases = view?.phases ?? [];
  const tasks = view?.tasks ?? [];
  const rel = view?.rel ?? (viewed < today ? "past" : viewed > today ? "future" : "today");
  const summaryTasks = tasks.map((t) => ({
    title: t.title,
    done: t.done,
    late: t.late || t.carried,
  }));
  const words = wordCount(liveText);
  const colorOf = (tagId: string | null) =>
    tagId ? (agenda.subjectById.get(tagId)?.color ?? null) : null;
  const goToday = () => {
    goToDay(today);
  };
  const prevWeek = () => goToDay(addDays(viewed, -7));
  const nextWeek = () => goToDay(addDays(viewed, 7));

  const loadBanner = agenda.loadFailed && (
    <div className="flex flex-none items-center gap-2 border-b border-overdue/20 bg-overdue/5 px-5 py-2 text-[0.71875rem] text-ink-300">
      Couldn’t load this week’s agenda.
      <button
        type="button"
        onClick={agenda.agenda.refresh}
        className="rounded-md bg-white/6 px-2 py-0.5 font-medium text-ink-200 hover:bg-white/10"
      >
        Retry
      </button>
    </div>
  );

  const createButton = (
    <CreateMenu
      items={["note", "task", "event"]}
      placement="below-left"
      trigger={({ toggle: t }) => (
        <RoundButton label="Create" onClick={t}>
          <Plus className="h-5 w-5" />
        </RoundButton>
      )}
    />
  );
  const inboxButton = (
    <RoundButton label="Inbox" href="/app/inbox">
      <Inbox className="h-[1.1875rem] w-[1.1875rem]" />
    </RoundButton>
  );

  const scheduleHeader = (
    <SectionHeader
      id="today-schedule"
      label="Schedule"
      count={events.length ? String(events.length) : ""}
      chips={scheduleSummary(events, phases)}
      open={open.schedule}
      onToggle={() => toggle("schedule")}
      wide={wide}
    />
  );
  const tasksHeader = (
    <SectionHeader
      id="today-tasks"
      label="Tasks"
      count={tasks.length ? `${tasks.filter((t) => t.done).length}/${tasks.length}` : ""}
      chips={tasksSummary(summaryTasks, rel)}
      open={open.tasks}
      onToggle={() => toggle("tasks")}
      action={<HeaderAddButton label="Add task" onClick={() => startAdd("task")} />}
      wide={wide}
    />
  );
  const taskList = (
    <div id="today-tasks" className={wide ? "flex flex-col" : "mx-5 flex flex-col"}>
      <TaskList
        tasks={tasks}
        date={viewed}
        today={today}
        rel={rel}
        wide={wide}
        limit={FOLD_AFTER}
        expanded={expanded[viewed] ?? false}
        onToggleExpanded={() => setExpanded((m) => ({ ...m, [viewed]: !m[viewed] }))}
        onToggle={agenda.toggleTask}
        onOpen={openTask}
      />
      {adding === "task" && (
        <AddTaskForm
          date={viewed}
          today={today}
          subjects={agenda.subjects}
          onCancel={() => setAdding(null)}
          onAdd={(title, due, tagId) => {
            agenda.addTask(title, due, tagId);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
  const addEventForm = adding === "event" && (
    <div className={wide ? "" : "mx-5 mt-1"}>
      <AddEventForm
        subjects={agenda.subjects}
        onCancel={() => setAdding(null)}
        onAdd={(title, startMin, tagId) => {
          agenda.addEvent(title, viewed, startMin, tagId);
          setAdding(null);
        }}
      />
    </div>
  );

  const notesEditor = (
    <DailyNoteWidget
      dateStr={viewed}
      isToday={isToday}
      note={note}
      prevNote={notes.get(addDays(viewed, -1))}
      onGo={goToDay}
      onNoteCreated={notes.put}
      onSnapshot={notes.snapshot}
      onInvalidate={notes.invalidate}
      editorRef={editorRef}
      embedded
    />
  );

  const panelView = panel && (
    <ItemPanel
      key={`${panel.kind}:${panel.id}`}
      target={panel}
      agenda={agenda}
      today={today}
      variant={wide ? "side" : "sheet"}
      onClose={closePanel}
    />
  );

  // =========================================================================
  // Tablet / desktop
  // =========================================================================
  if (wide) {
    const focusChips = focusSummary(events, phases, summaryTasks, rel);
    return (
      <div className="flex h-full min-h-0 bg-canvas md:pl-[5.75rem]">
        {!focus &&
          (weekOpen ? (
            <WeekPanel
              weekStart={weekStart ?? viewed}
              days={week}
              today={today}
              selected={viewed}
              onPrevWeek={prevWeek}
              onNextWeek={nextWeek}
              onSelect={goToDay}
            />
          ) : (
            <WeekStripFolded days={week} today={today} selected={viewed} onSelect={goToDay} />
          ))}

        <div className="flex min-w-0 flex-1 flex-col">
          {focus ? (
            <div className="flex h-16 flex-none items-center gap-2.5 border-b border-white/8 pl-6 pr-5">
              <DayPill date={viewed} isToday={isToday} large />
              <SummaryChips chips={focusChips} size="md" />
              <button
                type="button"
                onClick={() => setFocus(false)}
                className="flex h-9 flex-none items-center gap-2 rounded-full bg-ink-100 px-3.5 text-[0.8125rem] font-semibold leading-none text-sage-ink"
              >
                <Minimize2 className="h-[0.9375rem] w-[0.9375rem]" />
                Show planner
              </button>
            </div>
          ) : (
            <div className="flex h-[4.25rem] flex-none items-center gap-2.5 px-6">
              <button
                type="button"
                onClick={toggleWeek}
                aria-pressed={weekOpen}
                className={`flex h-11 items-center gap-2 rounded-full border border-white/8 pl-[0.8125rem] pr-4 text-[0.8125rem] font-medium leading-none text-ink-200 ${
                  weekOpen ? "bg-white/10" : "bg-white/3 hover:bg-white/6"
                }`}
              >
                <PanelLeft className="h-[1.0625rem] w-[1.0625rem] text-ink-300" />
                Week
              </button>
              {!isToday && <TodayJump onClick={goToday} />}
              <span className="flex-1" />
              {inboxButton}
              {createButton}
            </div>
          )}
          {loadBanner}

          <div className="flex min-h-0 flex-1 flex-col px-6">
            {!focus && (
              <DayHeader
                date={viewed}
                today={today}
                wide
                onPrev={() => goToDay(addDays(viewed, -1))}
                onNext={() => goToDay(addDays(viewed, 1))}
              />
            )}
            <div className="flex min-h-0 flex-1">
              {!focus && (
                <div
                  ref={swipeRef}
                  className="flex min-w-0 flex-[0_0_42%] flex-col overflow-y-auto overscroll-x-contain border-r border-white/8 pb-6 pr-6 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  <HabitsRow
                    habits={habits}
                    editable={isToday}
                    onToggle={agenda.toggleHabit}
                    wide
                  />
                  {scheduleHeader}
                  {open.schedule && (
                    <div id="today-schedule" className="flex flex-col">
                      <EventList
                        events={events}
                        phases={phases}
                        isToday={isToday}
                        colorOf={colorOf}
                        onOpen={openEvent}
                      />
                      {adding === "event" ? (
                        addEventForm
                      ) : (
                        <button
                          type="button"
                          onClick={() => startAdd("event")}
                          className="flex min-h-10 items-center gap-2 self-start text-[0.8125rem] font-medium leading-none text-sage"
                        >
                          <span className="text-[1.125rem] font-light leading-none">+</span>
                          Add event
                        </button>
                      )}
                    </div>
                  )}
                  {tasksHeader}
                  {open.tasks && taskList}
                </div>
              )}

              {/* The right page: the day's note, always open. */}
              <div className={`flex min-w-0 flex-1 flex-col pt-1 ${focus ? "" : "pl-7"}`}>
                <div
                  className={`mx-auto flex min-h-0 w-full flex-1 flex-col ${
                    focus ? "max-w-[45rem]" : ""
                  }`}
                >
                  <div className="flex min-h-11 flex-none items-center gap-2.5">
                    <span className={`${SECTION_LABEL} flex-none`}>Notes</span>
                    <Hairline />
                    <div id={NOTES_TOOLS_HOST_ID} className="flex flex-none items-center" />
                    {words > 0 && (
                      <span className="flex-none font-mono text-[0.65625rem] font-medium leading-none text-ink-600">
                        {plural(words, "word")}
                      </span>
                    )}
                    {!focus && (
                      <button
                        type="button"
                        onClick={() => {
                          setFocus(true);
                          setPanel(null);
                        }}
                        title="Focus on the note"
                        aria-label="Focus on the note"
                        className="-mr-2 flex h-9 w-9 flex-none items-center justify-center rounded-lg text-ink-350 hover:bg-white/6"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {notesEditor}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {panelView}
      </div>
    );
  }

  // =========================================================================
  // Phone
  // =========================================================================
  const enterWriting = () => {
    if (writing) return;
    setWriting(true);
    setAdding(null);
  };
  const leaveWriting = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && notesRef.current?.contains(active)) {
      active.blur();
    }
    setWriting(false);
  };

  if (phoneView === "week") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-canvas">
        <PhoneTopBar
          view="week"
          onView={setPhoneView}
          showToday={weekStart !== null && !week.some((d) => d.date === today)}
          onToday={goToday}
          trailing={
            <>
              {inboxButton}
              {createButton}
            </>
          }
        />
        {loadBanner}
        <WeekSpread
          weekStart={weekStart ?? viewed}
          days={week}
          today={today}
          lines={agenda.lines}
          subjects={agenda.subjects}
          loading={!agenda.ready}
          onPrevWeek={prevWeek}
          onNextWeek={nextWeek}
          onOpenDay={(d) => {
            goToDay(d);
            setPhoneView("day");
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {writing ? (
        <div className="flex h-[3.25rem] flex-none items-center gap-2 border-b border-white/8 pl-4 pr-3.5">
          <DayPill date={viewed} isToday={isToday} />
          <SummaryChips chips={focusSummary(events, phases, summaryTasks, rel)} />
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={leaveWriting}
            className="flex h-[2.125rem] flex-none items-center rounded-full bg-ink-100 px-3.5 text-[0.8125rem] font-semibold leading-none text-sage-ink"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <PhoneTopBar
            view="day"
            onView={setPhoneView}
            showToday={!isToday}
            onToday={goToday}
            trailing={
              <>
                {inboxButton}
                {createButton}
              </>
            }
          />
          <div className="grid flex-none grid-cols-7 gap-1 px-3.5 pb-3.5">
            {week.map((d, i) => (
              <DayTab
                key={d.date}
                date={d.date}
                today={today}
                index={i}
                selected={d.date === viewed}
                dot={dayDot(d.view)}
                onSelect={() => goToDay(d.date)}
              />
            ))}
          </div>
        </>
      )}
      {loadBanner}

      <div
        ref={swipeRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className={writing ? "hidden" : "contents"}>
          <DayHeader
            date={viewed}
            today={today}
            wide={false}
            onPrev={() => goToDay(addDays(viewed, -1))}
            onNext={() => goToDay(addDays(viewed, 1))}
          />
          <HabitsRow habits={habits} editable={isToday} onToggle={agenda.toggleHabit} wide={false} />
          {scheduleHeader}
          {open.schedule && (
            <div id="today-schedule" className="flex flex-none flex-col">
              <EventStrip
                events={events}
                phases={phases}
                isToday={isToday}
                colorOf={colorOf}
                onOpen={openEvent}
                onAdd={() => startAdd("event")}
              />
              {addEventForm}
            </div>
          )}
          {tasksHeader}
          {open.tasks && taskList}
          <SectionHeader
            label="Notes"
            count={words ? `${words}w` : ""}
            chips={notesSummary(liveText)}
            open={open.notes}
            onToggle={() => toggle("notes")}
            wide={false}
          />
        </div>
        <div
          ref={notesRef}
          onFocusCapture={(e) => {
            const t = e.target as HTMLElement;
            if (t.isContentEditable) enterWriting();
          }}
          className={
            writing
              ? "flex min-h-0 flex-1 flex-col"
              : open.notes
                ? "flex min-h-[11.25rem] flex-[1_0_11.25rem] flex-col pb-6"
                : "hidden"
          }
        >
          {/* Tools portal here on md+ only; the host still has to exist. */}
          <div id={NOTES_TOOLS_HOST_ID} className="hidden" />
          {notesEditor}
        </div>
      </div>
      {panelView}
    </div>
  );
}

function PhoneTopBar({
  view,
  onView,
  showToday,
  onToday,
  trailing,
}: {
  view: "day" | "week";
  onView: (v: "day" | "week") => void;
  showToday: boolean;
  onToday: () => void;
  trailing: ReactNode;
}) {
  return (
    <div className="flex flex-none items-center gap-2 px-4 pb-2.5 pt-1.5">
      <div
        role="tablist"
        aria-label="Day or week"
        className="flex h-11 gap-0.5 rounded-full border border-white/8 bg-white/4 p-1"
      >
        {(["day", "week"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => onView(v)}
            className={`flex h-[2.125rem] w-[3.875rem] items-center justify-center rounded-full text-[0.8125rem] leading-none ${
              view === v
                ? "bg-ink-100 font-semibold text-sage-ink"
                : "font-medium text-ink-350 hover:text-ink-100"
            }`}
          >
            {v === "day" ? "Day" : "Week"}
          </button>
        ))}
      </div>
      {showToday && <TodayJump onClick={onToday} />}
      <span className="flex-1" />
      {trailing}
    </div>
  );
}

/** "WED 9" pill heading the writing-mode context bar. */
function DayPill({
  date,
  isToday,
  large = false,
}: {
  date: string;
  isToday: boolean;
  large?: boolean;
}) {
  return (
    <span
      className={`flex flex-none items-center text-sage-ink ${
        large ? "h-[1.875rem] gap-1.5 rounded-lg px-2.5" : "h-7 gap-[0.3125rem] rounded-[0.4375rem] px-[0.5625rem]"
      } ${isToday ? "bg-sage" : "bg-ink-100"}`}
    >
      <span
        className={`font-mono font-semibold uppercase leading-none ${
          large ? "text-[0.625rem]" : "text-[0.59375rem]"
        }`}
      >
        {DOW_SHORT[weekdayIndex(date)]}
      </span>
      <span className={`font-bold leading-none ${large ? "text-[0.9375rem]" : "text-[0.875rem]"}`}>
        {dayOfMonth(date)}
      </span>
    </span>
  );
}

function TodaySkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 bg-canvas px-5 pt-4 md:pl-[7.25rem]">
      <div className="h-11 w-40 animate-pulse rounded-full bg-white/6" />
      <div className="h-14 w-64 animate-pulse rounded bg-white/6" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-white/6"
          style={{ width: `${85 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

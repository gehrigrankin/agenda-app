"use client";

import {
  CalendarDays,
  CircleCheck,
  Hash,
  Inbox,
  Layers,
  Moon,
  Repeat,
  Sun,
  type LucideIcon,
} from "lucide-react";

import type { TagWithCountResult } from "@/app/app/actions";
import { SidebarRow, SidebarSection } from "@/components/layout/sidebar";
import {
  WorkloadStrip,
  type FilterableTask,
} from "@/components/tasks/TaskFilterRail";
import { subjectColor } from "@/lib/subjects";
import {
  SMART_LIST_LABELS,
  sameView,
  type SmartListId,
  type TaskView,
} from "@/lib/task-lists";

/**
 * Sidebar 1 of the Tasks page (design 5b): the smart lists, then LISTS (one
 * row per subject, colored square), TAGS (the remaining labels), and the two
 * controls carried over from the old filter rail — FOLDERS (tasks by the
 * folder of the note they sit in) and the WORKLOAD strip (brush a window of
 * due days to list it). All of these are navigation: picking one changes the
 * list on the right.
 */

const SMART_ICONS: Record<SmartListId, LucideIcon> = {
  inbox: Inbox,
  today: Sun,
  upcoming: CalendarDays,
  anytime: Layers,
  someday: Moon,
  logbook: CircleCheck,
  repeating: Repeat,
};

export function TaskListsSidebar({
  view,
  onView,
  smartCounts,
  repeatingCount,
  subjects,
  plainTags,
  tagCounts,
  folders,
  workloadTasks,
  today,
}: {
  view: TaskView;
  onView: (view: TaskView) => void;
  smartCounts: Partial<Record<SmartListId, number>>;
  repeatingCount: number | null;
  subjects: TagWithCountResult[];
  plainTags: TagWithCountResult[];
  tagCounts: Map<string, number>;
  folders: { title: string; color: string | null; count: number }[];
  workloadTasks: FilterableTask[];
  today: string;
}) {
  const smart = (id: SmartListId, count?: number | null) => (
    <SidebarRow
      key={id}
      icon={SMART_ICONS[id]}
      label={SMART_LIST_LABELS[id]}
      count={count === null || count === undefined ? undefined : count}
      active={sameView(view, { kind: "smart", id })}
      onClick={() => onView({ kind: "smart", id })}
    />
  );
  const range = view.kind === "range" ? view : null;

  return (
    <nav
      aria-label="Task lists"
      className="min-h-0 flex-1 overflow-y-auto pb-6"
    >
      <div className="py-1.5">
        {smart("inbox", smartCounts.inbox)}
        {smart("today", smartCounts.today)}
        {smart("upcoming", smartCounts.upcoming)}
        {smart("anytime", smartCounts.anytime)}
        {smart("someday", smartCounts.someday)}
        {smart("logbook")}
        {smart("repeating", repeatingCount)}
      </div>

      <div className="border-t border-white/6">
        <SidebarSection label="Lists" storageKey="tasks.lists">
          {subjects.length === 0 ? (
            <p className="px-4 pb-2 text-[0.8125rem] text-ink-600">
              Subjects you color on Today show up here.
            </p>
          ) : (
            subjects.map((s) => (
              <SidebarRow
                key={s.id}
                iconNode={
                  <span
                    aria-hidden
                    className="mx-[0.1875rem] h-[0.625rem] w-[0.625rem] flex-none rounded-[0.1875rem]"
                    style={{ background: subjectColor(s.color) }}
                  />
                }
                label={s.name}
                count={tagCounts.get(s.id) ?? 0}
                active={sameView(view, { kind: "subject", id: s.id })}
                onClick={() => onView({ kind: "subject", id: s.id })}
              />
            ))
          )}
        </SidebarSection>
      </div>

      {plainTags.length > 0 && (
        <div className="border-t border-white/6">
          <SidebarSection label="Tags" storageKey="tasks.tags">
            {plainTags.map((t) => {
              const count = tagCounts.get(t.id) ?? 0;
              return (
                <SidebarRow
                  key={t.id}
                  icon={Hash}
                  label={t.name}
                  count={count || undefined}
                  dim={count === 0}
                  active={sameView(view, { kind: "tag", id: t.id })}
                  onClick={() => onView({ kind: "tag", id: t.id })}
                />
              );
            })}
          </SidebarSection>
        </div>
      )}

      {folders.length > 0 && (
        <div className="border-t border-white/6">
          <SidebarSection
            label="Folders"
            storageKey="tasks.folders"
            defaultOpen={false}
          >
            {folders.map((f) => (
              <SidebarRow
                key={f.title}
                iconNode={
                  <span
                    aria-hidden
                    className="mx-1 h-2 w-2 flex-none rounded-full"
                    style={{ background: f.color ?? "var(--color-sage)" }}
                  />
                }
                label={f.title}
                count={f.count}
                active={sameView(view, { kind: "folder", title: f.title })}
                onClick={() => onView({ kind: "folder", title: f.title })}
              />
            ))}
          </SidebarSection>
        </div>
      )}

      <div className="border-t border-white/6">
        <SidebarSection
          label="Workload"
          storageKey="tasks.workload"
          defaultOpen={false}
        >
          <WorkloadStrip
            tasks={workloadTasks}
            today={today}
            range={range ? { start: range.start, end: range.end } : null}
            onRangeChange={(r) =>
              onView(
                r
                  ? { kind: "range", start: r.start, end: r.end }
                  : { kind: "smart", id: "today" },
              )
            }
          />
        </SidebarSection>
      </div>
    </nav>
  );
}

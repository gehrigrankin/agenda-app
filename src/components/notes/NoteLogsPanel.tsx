import Link from "next/link";
import { CalendarDays, CornerDownRight, FileText } from "lucide-react";

import type { NoteLogEntry } from "@/server/note-logs";

import { LogContent } from "./LogContent";

/**
 * The Logs section on a note — everything other notes have logged onto this
 * one via `[[+`, newest first.
 *
 * Read-only by design. A log belongs to the note it was written in; editing
 * it here would mean writing back into someone else's document, and the
 * round trip is what the `[[+` design deliberately avoids. The source link
 * is the edit affordance: go where you wrote it.
 *
 * The body renders the log's stored BLOCKS (see LogContent), not its plain
 * text — a section written as bullets has to read as bullets here, or the
 * panel misrepresents what was logged.
 *
 * Server component — the note page already fetches on the server, so there's
 * nothing to load client-side and no skeleton to show.
 */

/** "2:15 PM · Aug 8" — the moment the log was written. */
function formatWhen(at: Date): string {
  const time = at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${time} · ${day}`;
}

function LogCard({ log }: { log: NoteLogEntry }) {
  const Icon = log.sourceDailyDate ? CalendarDays : FileText;
  return (
    <li className="rounded-xl border border-white/8 bg-white/2 px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-ink-200">
          {log.heading || "Untitled log"}
        </span>
        <span className="flex-none text-[0.625rem] tabular-nums text-ink-600">
          {formatWhen(log.createdAt)}
        </span>
      </div>
      {log.content.length > 0 || log.text ? (
        <LogContent content={log.content} text={log.text} />
      ) : (
        <p className="mt-1 text-[0.75rem] italic text-ink-600">
          Nothing written under this heading yet.
        </p>
      )}
      <Link
        href={`/app/notes/${log.sourceNoteId}`}
        className="mt-1.5 flex items-center gap-1 text-[0.6875rem] text-ink-500 hover:text-ink-200"
      >
        <Icon className="h-3 w-3 flex-none" />
        <span className="min-w-0 truncate">{log.sourceTitle || "Untitled"}</span>
      </Link>
    </li>
  );
}

export function NoteLogsPanel({
  logs,
  variant,
}: {
  logs: NoteLogEntry[];
  /** "aside" = the right rail at xl+; "stacked" = below the editor under xl. */
  variant: "aside" | "stacked";
}) {
  if (logs.length === 0) return null;

  const heading = (
    <div className="flex items-center gap-1.5 px-1 pb-2">
      <CornerDownRight className="h-3 w-3 flex-none text-sage" />
      <span className="text-[0.625rem] font-medium uppercase tracking-[0.14em] text-ink-600">
        Logs
      </span>
      <span className="text-[0.65625rem] text-ink-700">{logs.length}</span>
    </div>
  );

  if (variant === "stacked") {
    return (
      // Capped and scrollable: under xl this sits between the editor and the
      // backlinks strip, and a busy note's log history would otherwise push
      // the note itself off the screen.
      <div className="max-h-56 flex-none overflow-y-auto border-t border-white/10 px-3 py-2.5 xl:hidden">
        {heading}
        <ul className="flex flex-col gap-1.5">
          {logs.map((log) => (
            <LogCard key={log.id} log={log} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <aside className="hidden w-[17rem] flex-none flex-col overflow-y-auto border-l border-white/7 bg-white/2 px-2.5 py-3 xl:flex">
      {heading}
      <ul className="flex flex-col gap-1.5">
        {logs.map((log) => (
          <LogCard key={log.id} log={log} />
        ))}
      </ul>
    </aside>
  );
}

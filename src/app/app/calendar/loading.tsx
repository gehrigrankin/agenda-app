const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar route skeleton — header bar, phone week strip, month grid. */
export default function CalendarLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:pl-[5.75rem] lg:overflow-hidden">
      <div className="hidden flex-none items-center gap-2 md:flex">
        <div className="h-4 w-4 animate-pulse rounded bg-white/8" />
        <div className="h-4 w-32 animate-pulse rounded bg-white/6" />
        <div className="ml-auto flex items-center gap-1.5">
          <div className="h-7 w-7 animate-pulse rounded-lg bg-white/4" />
          <div className="h-7 w-14 animate-pulse rounded-lg bg-white/4" />
          <div className="h-7 w-7 animate-pulse rounded-lg bg-white/4" />
          <div className="ml-1.5 h-7 w-24 animate-pulse rounded-lg bg-white/6" />
        </div>
      </div>
      <div className="grid flex-none grid-cols-7 gap-1 md:hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1 py-1">
            <div className="h-2 w-4 animate-pulse rounded bg-white/6" />
            <div className="h-10 w-10 animate-pulse rounded-full bg-white/6" />
          </div>
        ))}
      </div>
      <div className="hidden flex-none grid-cols-7 gap-1.5 md:grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="h-2.5 w-6 animate-pulse rounded bg-white/6" />
        ))}
      </div>
      <div className="hidden min-h-0 flex-1 grid-cols-7 gap-1.5 md:grid" style={{ gridAutoRows: "minmax(6.5rem, 1fr)" }}>
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-white/4 bg-white/4" />
        ))}
      </div>
    </div>
  );
}

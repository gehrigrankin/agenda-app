const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar route skeleton — header bar, phone week strip, month grid. */
export default function CalendarLoading() {
  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-y-contain px-3 py-3 md:hidden">
        <div className="relative flex min-h-11 flex-none items-center justify-center">
          <div className="h-4 w-32 animate-pulse rounded bg-white/6" />
          <div className="absolute right-0 h-11 w-11 animate-pulse rounded-full bg-white/5" />
        </div>

        <div className="grid flex-none grid-cols-3 gap-1 rounded-2xl border border-white/7 bg-white/4 p-[0.1875rem]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={`h-[2.125rem] animate-pulse rounded-lg ${i === 1 ? "bg-sage/12" : "bg-white/3"}`}
            />
          ))}
        </div>

        <div className="grid flex-none grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1 py-1">
              <div className="h-2 w-4 animate-pulse rounded bg-white/6" />
              <div className="h-10 w-10 animate-pulse rounded-full bg-white/6" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          {Array.from({ length: 2 }).map((_, day) => (
            <div key={day}>
              <div className="mb-2 h-2.5 w-24 animate-pulse rounded bg-white/6" />
              <div className="flex flex-col gap-1.5">
                <div className="ml-[3.75rem] h-14 animate-pulse rounded-xl border border-steel/20 bg-steel/5" />
                <div className="flex items-start gap-2">
                  <div className="h-3 w-[3.25rem] flex-none animate-pulse rounded bg-white/5" />
                  <div className="h-14 flex-1 animate-pulse rounded-xl border border-white/7 bg-white/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:flex md:pl-[5.75rem] lg:overflow-hidden">
        <div className="flex flex-none items-center gap-2">
          <div className="h-4 w-4 animate-pulse rounded bg-white/8" />
          <div className="h-4 w-32 animate-pulse rounded bg-white/6" />
          <div className="ml-auto flex items-center gap-1.5">
            <div className="h-7 w-7 animate-pulse rounded-lg bg-white/4" />
            <div className="h-7 w-14 animate-pulse rounded-lg bg-white/4" />
            <div className="h-7 w-7 animate-pulse rounded-lg bg-white/4" />
            <div className="ml-1.5 h-7 w-24 animate-pulse rounded-lg bg-white/6" />
          </div>
        </div>
        <div className="grid flex-none grid-cols-7 gap-1.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="h-2.5 w-6 animate-pulse rounded bg-white/6"
            />
          ))}
        </div>
        <div
          className="grid min-h-0 flex-1 grid-cols-7 gap-1.5"
          style={{ gridAutoRows: "minmax(6.5rem, 1fr)" }}
        >
          {Array.from({ length: 35 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-white/4 bg-white/4"
            />
          ))}
        </div>
      </div>
    </>
  );
}

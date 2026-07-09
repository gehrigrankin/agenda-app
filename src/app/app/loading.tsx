const SURFACE =
  "flex flex-col overflow-hidden rounded-2xl border border-white/9 bg-panel/94";

/**
 * Home dashboard skeleton — mirrors `.home-grid`'s two-column structure
 * (big daily-note panel + right rail, then the calendar/board/yesterday
 * row) so the real layout doesn't reflow in underneath it.
 */
export default function AppHomeLoading() {
  return (
    <div className="bubble-canvas-grid home-grid grid h-full min-h-0 grid-cols-1 content-start gap-3.5 overflow-y-auto p-4 md:content-stretch md:pl-[5.75rem] xl:overflow-hidden xl:pb-5 xl:pr-5">
      {/* Daily note */}
      <div className="flex min-h-0 flex-col gap-3.5 md:col-start-1 md:row-start-1">
        <div className={`${SURFACE} min-h-[26.25rem] flex-1 md:min-h-0`}>
          <div className="flex flex-none items-center gap-2.5 border-b border-white/7 px-4 py-3">
            <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/8" />
            <div className="h-3.5 w-32 animate-pulse rounded bg-white/8" />
          </div>
          <div className="flex flex-1 flex-col gap-3 p-5 pl-[4.125rem]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-3 animate-pulse rounded bg-white/6"
                style={{ width: `${88 - ((i * 13) % 45)}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Tasks / linked rail */}
      <div className="flex flex-col gap-3.5 md:col-start-2 md:row-start-1 md:min-h-0 xl:row-span-2">
        <div className={`${SURFACE} min-h-[16.25rem] flex-1 md:min-h-0`}>
          <div className="flex flex-none items-center gap-2 border-b border-white/7 px-3.5 py-3">
            <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/8" />
            <div className="h-3.5 w-16 animate-pulse rounded bg-white/8" />
          </div>
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-white/6" />
            ))}
          </div>
        </div>
        <div className={`${SURFACE} min-h-[10rem] flex-1 md:min-h-0`}>
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        </div>
      </div>

      {/* Calendar / board / yesterday row */}
      <div className="flex gap-3.5 max-md:flex-col md:col-span-2 md:min-h-[9.875rem] xl:col-span-1">
        <div
          className={`${SURFACE} rounded-[0.8125rem] max-md:min-h-[11rem] md:w-[16rem] md:flex-none 2xl:w-[18rem]`}
        >
          <div className="h-full w-full animate-pulse bg-white/5" />
        </div>
        <div
          className={`${SURFACE} rounded-[0.8125rem] max-md:h-[7.5rem] md:min-w-0 md:flex-1`}
        >
          <div className="h-full w-full animate-pulse bg-white/5" />
        </div>
        <div className="flex flex-col rounded-[0.8125rem] border border-white/7 bg-panel/70 max-md:h-[6.25rem] md:w-[13.75rem] md:flex-none 2xl:w-[16rem]">
          <div className="h-full w-full animate-pulse rounded-[0.8125rem] bg-white/5" />
        </div>
      </div>
    </div>
  );
}

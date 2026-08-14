/** Tasks route skeleton — header + Today/Upcoming list rows. */
export default function TasksLoading() {
  return (
    <div className="h-full min-h-0 overflow-y-auto bubble-canvas-grid p-4 pt-7 md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-[55rem]">
        <div className="mb-[1.125rem] flex flex-wrap items-center gap-3">
          <div className="h-5 w-16 animate-pulse rounded bg-white/8" />
          <div className="h-3 w-28 animate-pulse rounded bg-white/6" />
          <div className="ml-auto h-7 w-24 flex-none animate-pulse rounded-lg bg-white/6" />
        </div>

        <div className="mb-1.5 h-2.5 w-16 animate-pulse rounded bg-white/6" />
        <div className="mb-5 flex flex-col gap-2">
          <div className="h-[2.875rem] animate-pulse rounded-xl border border-white/7 bg-white/6" />
          <div className="h-[2.875rem] animate-pulse rounded-xl border border-white/7 bg-white/6" />
          <div className="h-[2.875rem] animate-pulse rounded-xl border border-white/7 bg-white/6" />
        </div>

        <div className="mb-1.5 h-2.5 w-20 animate-pulse rounded bg-white/6" />
        <div className="flex flex-col gap-2">
          <div className="h-[2.875rem] animate-pulse rounded-xl border border-white/7 bg-white/6" />
          <div className="h-[2.875rem] animate-pulse rounded-xl border border-white/7 bg-white/6" />
        </div>
      </div>
    </div>
  );
}

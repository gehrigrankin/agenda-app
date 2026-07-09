/** Skeleton for the Habits page (design Turn 17g) while habit cards load. */
export default function HabitsLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-xl px-4 pb-8">
        <div className="relative -mx-2 flex h-11 items-center md:hidden">
          <div className="h-4 w-14 animate-pulse rounded bg-white/6" />
        </div>
        <div className="hidden pb-4 pt-4 md:block">
          <div className="h-7 w-24 animate-pulse rounded-lg bg-white/6" />
        </div>

        <div className="mt-2 flex flex-col gap-3 md:mt-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/8 bg-white/3 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="h-4 w-2/5 animate-pulse rounded bg-white/8" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-white/6" />
                </div>
                <div className="h-[3.25rem] w-[3.25rem] flex-none animate-pulse rounded-full bg-white/6" />
              </div>
              <div className="mt-4 grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }).map((_, j) => (
                  <div key={j} className="flex flex-col items-center gap-1.5">
                    <div className="h-[0.6875rem] w-[0.6875rem] animate-pulse rounded-full bg-white/6" />
                    <div className="h-2 w-2 animate-pulse rounded bg-white/5" />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="h-12 w-full animate-pulse rounded-[0.875rem] border-[1.5px] border-dashed border-white/10" />
        </div>
      </div>
    </div>
  );
}

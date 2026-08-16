import { MobilePageHeader } from "@/components/layout/MobilePageHeader";

/** Tasks route skeleton — header + Today/Upcoming list rows. */
export default function TasksLoading() {
  return (
    <>
      <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain bubble-canvas-grid md:hidden">
        <MobilePageHeader title="Tasks" subtitle="Loading tasks…" />
        <div className="px-3 py-3">
          <div className="mb-4 flex gap-2 overflow-hidden">
            {["w-16", "w-20", "w-24", "w-20"].map((width, i) => (
              <div
                key={i}
                className={`h-[2.125rem] ${width} flex-none animate-pulse rounded-full border border-white/8 bg-white/4`}
              />
            ))}
          </div>

          <div className="mb-2 h-2.5 w-20 animate-pulse rounded bg-white/6" />
          <div className="flex flex-col divide-y divide-white/5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex min-h-[3.25rem] items-center gap-3 py-1.5"
              >
                <div className="h-6 w-6 flex-none animate-pulse rounded-lg bg-white/7" />
                <div className="min-w-0 flex-1">
                  <div
                    className="h-3.5 animate-pulse rounded bg-white/7"
                    style={{ width: `${78 - i * 9}%` }}
                  />
                  <div className="mt-1.5 h-2.5 w-20 animate-pulse rounded bg-white/5" />
                </div>
              </div>
            ))}
          </div>

          <div className="mb-2 mt-5 h-2.5 w-16 animate-pulse rounded bg-white/6" />
          <div className="flex flex-col divide-y divide-white/5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="flex min-h-[3.25rem] items-center gap-3 py-1.5"
              >
                <div className="h-6 w-6 flex-none animate-pulse rounded-lg bg-white/7" />
                <div className="h-3.5 flex-1 animate-pulse rounded bg-white/7" />
              </div>
            ))}
          </div>

          <div className="mt-5 flex h-12 items-center gap-2.5 rounded-3xl border border-white/10 bg-white/4 px-3.5">
            <div className="h-4 w-4 animate-pulse rounded bg-white/7" />
            <div className="h-3 w-40 animate-pulse rounded bg-white/6" />
          </div>
        </div>
      </div>

      <div className="hidden h-full min-h-0 overflow-y-auto bubble-canvas-grid p-4 pt-7 md:block md:pl-[5.75rem]">
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
    </>
  );
}

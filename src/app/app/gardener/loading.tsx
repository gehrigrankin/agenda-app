/** Gardener route skeleton — header bar + centered column of card pulses. */
export default function GardenerLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      {/* Page header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4">
        <div className="h-[1.125rem] w-[1.125rem] flex-none animate-pulse rounded bg-white/8" />
        <div className="h-5 w-20 animate-pulse rounded bg-white/8" />
        <div className="h-3 w-48 animate-pulse rounded bg-white/6" />
        <div className="ml-auto h-7 w-24 flex-none animate-pulse rounded-lg bg-white/5" />
      </div>

      {/* Body — centered single column of suggestion cards */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3">
          <div className="h-24 w-full animate-pulse rounded-[0.875rem] bg-panel/90" />
          <div className="h-24 w-full animate-pulse rounded-[0.875rem] bg-panel/90" />
          <div className="h-24 w-full animate-pulse rounded-[0.875rem] bg-panel/90" />
        </div>
      </div>
    </div>
  );
}

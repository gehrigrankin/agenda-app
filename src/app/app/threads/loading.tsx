/** Threads route skeleton — header + md: two-pane (20rem list + detail). */
export default function ThreadsLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      {/* Page header */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4">
        <div className="h-5 w-20 animate-pulse rounded bg-white/8" />
        <div className="h-3 w-56 animate-pulse rounded bg-white/6" />
        <div className="ml-auto h-7 w-20 flex-none animate-pulse rounded-lg bg-white/5" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-visible">
        {/* List pane */}
        <div className="w-full flex-none border-b border-white/7 p-3 md:w-[20rem] md:border-b-0 md:border-r">
          <div className="flex flex-col gap-1.5">
            <div className="h-[3.25rem] w-full animate-pulse rounded-[0.5625rem] bg-panel/90" />
            <div className="h-[3.25rem] w-full animate-pulse rounded-[0.5625rem] bg-panel/90" />
            <div className="h-[3.25rem] w-full animate-pulse rounded-[0.5625rem] bg-panel/90" />
          </div>
        </div>

        {/* Detail pane */}
        <div className="min-w-0 flex-1 p-5">
          <div className="mb-4 h-9 w-full animate-pulse rounded-[0.5625rem] bg-panel/90" />
          <div className="flex flex-col gap-4">
            <div className="h-12 w-full animate-pulse rounded-[0.5625rem] bg-panel/90" />
            <div className="h-12 w-full animate-pulse rounded-[0.5625rem] bg-panel/90" />
            <div className="h-12 w-full animate-pulse rounded-[0.5625rem] bg-panel/90" />
          </div>
        </div>
      </div>
    </div>
  );
}

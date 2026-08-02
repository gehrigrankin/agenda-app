/** Automations route skeleton — centered panel, header row + rule rows. */
export default function AutomationsLoading() {
  return (
    <div className="h-full min-h-0 overflow-y-auto bubble-canvas-grid p-4 pt-7 md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-[46.25rem]">
        <div className="overflow-hidden rounded-2xl border border-white/9 bg-panel/95">
          <div className="flex items-center gap-[0.5625rem] border-b border-white/7 px-[1.125rem] py-3">
            <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/8" />
            <div className="h-3.5 w-24 animate-pulse rounded bg-white/8" />
            <div className="h-3 w-40 animate-pulse rounded bg-white/6" />
          </div>
          <div className="flex flex-col gap-[0.375rem] p-[0.625rem]">
            <div className="h-11 animate-pulse rounded-[0.625rem] bg-white/3" />
            <div className="h-11 animate-pulse rounded-[0.625rem] bg-white/3" />
            <div className="h-11 animate-pulse rounded-[0.625rem] bg-white/3" />
            <div className="h-11 animate-pulse rounded-[0.625rem] bg-white/3" />
          </div>
        </div>
      </div>
    </div>
  );
}

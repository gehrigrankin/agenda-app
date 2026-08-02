/** Settings route skeleton — mirrors the real page's grouped rows while
 * `currentUser()` resolves. */
export default function SettingsLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-xl px-4 pb-8">
        <div className="relative -mx-2 flex h-11 items-center md:hidden">
          <div className="h-4 w-14 animate-pulse rounded bg-white/6" />
        </div>
        <div className="hidden pb-4 pt-4 md:block">
          <div className="h-7 w-24 animate-pulse rounded-lg bg-white/6" />
        </div>

        <div className="mt-2 flex items-center gap-3.5 rounded-2xl border border-white/8 bg-white/3 p-3.5">
          <div className="h-[2.875rem] w-[2.875rem] flex-none animate-pulse rounded-full bg-white/8" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-3.5 w-32 animate-pulse rounded bg-white/8" />
            <div className="h-3 w-40 animate-pulse rounded bg-white/6" />
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-white/7 bg-white/2">
          <div className="h-13 min-h-[3.25rem] border-b border-white/6 px-3.5" />
          <div className="h-13 min-h-[3.25rem] px-3.5" />
        </div>

        <div className="mt-3 h-13 min-h-[3.25rem] overflow-hidden rounded-2xl border border-white/7 bg-white/2" />
      </div>
    </div>
  );
}

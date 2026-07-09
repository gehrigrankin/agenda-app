/** List-rows skeleton mirroring TrashList's row shape (design Turn 17j). */
export default function TrashLoading() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 pb-8 md:max-w-[calc(42rem+5.75rem)] md:p-6 md:pl-[5.75rem]">
      {/* Phone back bar */}
      <div className="flex flex-none flex-col items-center gap-1 md:hidden">
        <div className="h-11 w-24 animate-pulse rounded bg-white/8" />
        <div className="h-2.5 w-40 animate-pulse rounded bg-white/6" />
      </div>

      <div className="hidden items-center gap-2 md:flex">
        <div className="h-5 w-5 animate-pulse rounded bg-white/8" />
        <div className="h-5 w-16 animate-pulse rounded bg-white/8" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/7 bg-white/2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[3.75rem] items-center gap-3 border-b border-white/6 px-3.5 last:border-b-0"
          >
            <div className="h-[1.0625rem] w-[1.0625rem] flex-none animate-pulse rounded bg-white/8" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div
                className="h-3 animate-pulse rounded bg-white/8"
                style={{ width: `${60 - (i % 3) * 10}%` }}
              />
              <div className="h-2.5 w-32 animate-pulse rounded bg-white/6" />
            </div>
            <div className="h-9 w-16 flex-none animate-pulse rounded-[0.625rem] bg-white/5" />
          </div>
        ))}
      </div>

      <div className="h-12 animate-pulse rounded-[0.875rem] bg-white/5" />
    </div>
  );
}

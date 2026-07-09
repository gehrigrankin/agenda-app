/** Skeleton for the Boards grid while board cards load. */
export default function BoardsLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-2xl px-5">
        <div className="flex items-center pb-3 pt-3.5">
          <div className="h-8 w-28 animate-pulse rounded-lg bg-white/6" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex min-h-[8.125rem] flex-col gap-2.5 rounded-[0.8125rem] border border-white/8 bg-white/3 p-3.5"
            >
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/10" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-white/8" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-white/6" />
              <div className="mt-auto flex flex-col gap-1.5">
                <div className="h-3 w-full animate-pulse rounded bg-white/5" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

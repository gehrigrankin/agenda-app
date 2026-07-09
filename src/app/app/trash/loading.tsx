/** List-rows skeleton mirroring TrashList's row shape. */
export default function TrashLoading() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-4 overflow-y-auto p-6 md:max-w-[calc(42rem+5.75rem)] md:pl-[5.75rem]">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 animate-pulse rounded bg-white/8" />
        <div className="h-4 w-16 animate-pulse rounded bg-white/8" />
      </div>

      <ul className="flex flex-col divide-y divide-white/7 rounded-lg border border-white/7">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-2.5">
            <div className="h-4 w-4 flex-none animate-pulse rounded bg-white/8" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div
                className="h-3 animate-pulse rounded bg-white/6"
                style={{ width: `${60 - (i % 3) * 10}%` }}
              />
              <div className="h-2.5 w-24 animate-pulse rounded bg-white/5" />
            </div>
            <div className="h-6 w-16 flex-none animate-pulse rounded-md bg-white/5" />
          </li>
        ))}
      </ul>
    </div>
  );
}

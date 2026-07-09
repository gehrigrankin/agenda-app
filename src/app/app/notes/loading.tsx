/**
 * Notes route loading skeleton. The list pane's data actually loads in
 * `layout.tsx` (a layout's own await isn't covered by this file), so this
 * mostly covers navigation between notes — shaped like both panes anyway so
 * a slow first paint doesn't flash empty.
 */
export default function NotesLoading() {
  return (
    <div className="flex h-full min-h-0 md:pl-[5.75rem]">
      {/* List pane */}
      <div className="hidden w-[18.75rem] flex-none flex-col overflow-hidden border-r border-white/7 p-2 md:flex">
        <div className="flex flex-none items-center gap-2 px-2 pb-2 pt-1.5">
          <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/8" />
          <div className="h-3 w-12 animate-pulse rounded bg-white/8" />
          <div className="ml-auto h-[1.375rem] w-[1.375rem] animate-pulse rounded-md bg-white/6" />
        </div>
        <div className="h-[3.5rem] flex-none animate-pulse rounded-[0.5rem] bg-white/6" />
        <div className="mx-1.5 my-1.5 h-px flex-none bg-white/6" />
        <div className="flex flex-col gap-1.5 px-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-[0.5rem] px-2.5 py-2.5">
              <div className="h-2.5 w-3/4 animate-pulse rounded bg-white/6" />
              <div className="h-2 w-1/2 animate-pulse rounded bg-white/5" />
            </div>
          ))}
        </div>
      </div>

      {/* Detail pane */}
      <div className="min-w-0 flex-1 border-l border-white/7">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-white/7 px-3 py-2 md:px-4">
            <div className="h-5 w-48 animate-pulse rounded bg-white/6" />
          </div>
          <div className="flex flex-1 flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-3 animate-pulse rounded bg-white/6"
                style={{ width: `${85 - i * 7}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

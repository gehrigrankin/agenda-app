/**
 * Notes-shaped loading skeleton (Explorer + editor). Used two ways: as the
 * notes layout's Suspense fallback while the Explorer data loads, and by the
 * route-level loading.tsx for navigation between notes.
 */
export function NotesShellSkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Explorer */}
      <div className="hidden w-[23rem] flex-none flex-col overflow-hidden border-r border-white/6 bg-sidebar md:flex">
        <div className="flex h-[3.25rem] flex-none items-center gap-2 border-b border-white/6 px-4">
          <div className="h-2.5 w-14 animate-pulse rounded bg-white/8" />
          <div className="ml-auto h-6 w-6 animate-pulse rounded-md bg-white/6" />
        </div>
        <div className="mx-2.5 mt-3 h-9 flex-none animate-pulse rounded-lg bg-white/6" />
        <div className="mt-3 flex flex-col gap-1 px-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex h-[2rem] items-center gap-2"
              style={{ paddingLeft: `${(i % 4) * 0.9}rem` }}
            >
              <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/6" />
              <div
                className="h-2.5 animate-pulse rounded bg-white/6"
                style={{ width: `${60 - (i % 5) * 8}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden h-[3.25rem] flex-none border-b border-white/7 bg-sidebar md:block" />
        <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col gap-3 px-10 pt-14">
          <div className="h-7 w-64 animate-pulse rounded bg-white/7" />
          <div className="mb-4 h-2.5 w-24 animate-pulse rounded bg-white/5" />
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
  );
}

/**
 * Just the document, for navigation between notes: the route's loading UI
 * renders INSIDE the editor pane (the Explorer and tabs stay put).
 */
export function NoteEditorSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3 px-10 pt-[4.5rem]">
      <div className="h-7 w-64 animate-pulse rounded bg-white/7" />
      <div className="mb-4 h-2.5 w-24 animate-pulse rounded bg-white/5" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-white/6"
          style={{ width: `${85 - i * 7}%` }}
        />
      ))}
    </div>
  );
}

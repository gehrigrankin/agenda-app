/** Editor-shaped skeleton: title bar + several text lines. */
export default function NoteLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/7 px-3 py-2 md:px-4">
        <div className="h-5 w-56 animate-pulse rounded bg-white/6" />
        <div className="ml-auto h-4 w-12 animate-pulse rounded bg-white/5" />
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3.5 p-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-white/6"
            style={{ width: `${92 - ((i * 11) % 40)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

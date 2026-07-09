/** Full-canvas placeholder for the bubble map: dotted grid + a few pulsing
 * circles standing in for bubbles, under a header-shaped bar. */
export default function BubblesLoading() {
  const circles = [
    { top: "18%", left: "22%", size: "6.5rem" },
    { top: "48%", left: "12%", size: "4.5rem" },
    { top: "30%", left: "52%", size: "8.5rem" },
    { top: "62%", left: "58%", size: "5rem" },
    { top: "20%", left: "74%", size: "4rem" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <div className="h-4 w-4 animate-pulse rounded bg-white/8" />
        <div className="h-4 w-32 animate-pulse rounded bg-white/8" />
      </div>
      <div className="bubble-canvas-grid relative min-h-0 flex-1 overflow-hidden">
        {circles.map((c, i) => (
          <div
            key={i}
            className="absolute animate-pulse rounded-full bg-white/6"
            style={{ top: c.top, left: c.left, width: c.size, height: c.size }}
          />
        ))}
      </div>
    </div>
  );
}

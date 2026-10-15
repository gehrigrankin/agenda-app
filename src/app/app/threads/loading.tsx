import { MobilePageHeader } from "@/components/layout/MobilePageHeader";

/** Threads route skeleton — phone list, or md+ sidebar + timeline columns. */
export default function ThreadsLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="md:hidden">
        <MobilePageHeader title="Threads" subtitle="Finding recurring ideas…" />
      </div>

      {/* Sidebar 1 */}
      <div className="w-full flex-none border-white/6 p-3 md:w-[20rem] md:border-r md:bg-sidebar">
        <div className="flex flex-col gap-1.5">
          <div className="h-[3.25rem] w-full animate-pulse rounded-xl bg-panel/90" />
          <div className="h-[3.25rem] w-full animate-pulse rounded-xl bg-panel/90" />
          <div className="h-[3.25rem] w-full animate-pulse rounded-xl bg-panel/90" />
        </div>
      </div>

      {/* Timeline */}
      <div className="hidden min-w-0 flex-1 p-5 md:block">
        <div className="mb-4 h-9 w-full animate-pulse rounded-xl bg-panel/90" />
        <div className="flex flex-col gap-3">
          <div className="h-[4.5rem] w-full animate-pulse rounded-lg bg-panel/90" />
          <div className="h-[4.5rem] w-full animate-pulse rounded-lg bg-panel/90" />
          <div className="h-[4.5rem] w-full animate-pulse rounded-lg bg-panel/90" />
        </div>
      </div>
    </div>
  );
}

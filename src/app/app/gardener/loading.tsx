import { MobilePageHeader } from "@/components/layout/MobilePageHeader";

/** Gardener route skeleton — header bar + centered column of card pulses. */
export default function GardenerLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      <MobilePageHeader
        title="Garden"
        subtitle="Checking what slipped through…"
      />

      {/* Desktop page header */}
      <div className="hidden flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4 md:flex">
        <div className="h-[1.125rem] w-[1.125rem] flex-none animate-pulse rounded bg-white/8" />
        <div className="h-5 w-20 animate-pulse rounded bg-white/8" />
        <div className="h-3 w-48 animate-pulse rounded bg-white/6" />
        <div className="ml-auto h-7 w-24 flex-none animate-pulse rounded-lg bg-white/5" />
      </div>

      {/* Body — centered single column of suggestion cards */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 md:p-4">
        <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3">
          <div className="h-24 w-full animate-pulse rounded-3xl bg-panel/90" />
          <div className="h-24 w-full animate-pulse rounded-3xl bg-panel/90" />
          <div className="h-24 w-full animate-pulse rounded-3xl bg-panel/90" />
        </div>
      </div>
    </div>
  );
}

import { MobilePageHeader } from "@/components/layout/MobilePageHeader";

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl border border-white/7 bg-panel/90 p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 flex-none rounded-lg bg-white/5" />
        <div className="min-w-0 flex-1">
          <div className="h-3.5 w-2/3 rounded bg-white/6" />
          <div className="mt-2 h-2.5 w-1/3 rounded bg-white/5" />
        </div>
      </div>
    </div>
  );
}

/** Inbox route skeleton — header + centered column of card pulses. */
export default function InboxLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col md:pl-[5.75rem]">
      <MobilePageHeader title="Inbox" subtitle="Checking captures…" />

      {/* Desktop page header */}
      <div className="hidden flex-none flex-wrap items-center gap-3 border-b border-white/7 p-4 md:flex">
        <div className="h-[1.125rem] w-[1.125rem] flex-none animate-pulse rounded bg-white/8" />
        <div className="min-w-0">
          <div className="h-5 w-28 animate-pulse rounded bg-white/8" />
          <div className="mt-1.5 h-3 w-40 animate-pulse rounded bg-white/6" />
        </div>
        <div className="ml-auto h-7 w-20 flex-none animate-pulse rounded-lg bg-white/5" />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-3 py-3 md:gap-3 md:p-5">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </div>
  );
}

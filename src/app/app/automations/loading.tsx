import { MobilePageHeader } from "@/components/layout/MobilePageHeader";

/** Automations route skeleton — centered panel, header row + rule rows. */
export default function AutomationsLoading() {
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain bubble-canvas-grid md:pl-[5.75rem]">
      <MobilePageHeader title="Rules" subtitle="Loading automations…" />
      <div className="mx-auto w-full max-w-[46.25rem] px-0 py-3 md:p-4 md:pt-7">
        <div className="overflow-hidden bg-panel/95 md:rounded-2xl md:border md:border-white/9">
          <div className="hidden items-center gap-[0.5625rem] border-b border-white/7 px-[1.125rem] py-3 md:flex">
            <div className="h-3.5 w-3.5 animate-pulse rounded bg-white/8" />
            <div className="h-3.5 w-24 animate-pulse rounded bg-white/8" />
            <div className="h-3 w-40 animate-pulse rounded bg-white/6" />
          </div>
          <div className="flex flex-col gap-[0.375rem] px-3 py-2 md:p-[0.625rem]">
            <div className="h-11 animate-pulse rounded-xl bg-white/3" />
            <div className="h-11 animate-pulse rounded-xl bg-white/3" />
            <div className="h-11 animate-pulse rounded-xl bg-white/3" />
            <div className="h-11 animate-pulse rounded-xl bg-white/3" />
          </div>
        </div>
      </div>
    </div>
  );
}

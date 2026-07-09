import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { ChevronLeft, ChevronRight, Moon, Trash2 } from "lucide-react";

export const metadata = { title: "Settings" };

/**
 * Settings (design Turn 17k): grouped list, 52px rows. Reached from the Notes
 * page on phone (Settings doesn't earn a tab-bar slot). Only settings the app
 * actually has appear here — account, appearance, trash, sign out.
 */
export default async function SettingsPage() {
  const user = await currentUser();
  const name =
    user?.fullName || user?.username || user?.firstName || "Your account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initial = (name[0] ?? "A").toUpperCase();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto md:pl-[5.75rem]">
      <div className="mx-auto w-full max-w-xl px-4 pb-8">
        {/* Phone back bar — Settings lives inside Notes on phone. */}
        <div className="relative -mx-2 flex h-11 items-center md:hidden">
          <Link
            href="/app/notes"
            className="flex h-11 items-center gap-0.5 px-2 text-[0.9375rem] font-medium text-sage"
          >
            <ChevronLeft className="h-5 w-5" />
            Notes
          </Link>
          <span className="absolute left-1/2 -translate-x-1/2 text-[1rem] font-semibold text-ink-100">
            Settings
          </span>
        </div>
        <h1 className="hidden pb-4 pt-4 text-2xl font-semibold text-ink-100 md:block">
          Settings
        </h1>

        {/* Account */}
        <div className="mt-2 flex items-center gap-3.5 rounded-2xl border border-white/8 bg-white/3 p-3.5">
          <span className="flex h-[2.875rem] w-[2.875rem] flex-none items-center justify-center rounded-full bg-sage text-lg font-semibold text-sage-ink">
            {initial}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[0.96875rem] font-semibold text-ink-100">
              {name}
            </span>
            {email && (
              <span className="truncate text-xs text-ink-600">{email}</span>
            )}
          </span>
        </div>

        {/* Preferences */}
        <div className="mt-3 overflow-hidden rounded-2xl border border-white/7 bg-white/2">
          <div className="flex h-13 min-h-[3.25rem] items-center gap-3 px-3.5">
            <Moon className="h-[1.0625rem] w-[1.0625rem] text-ink-400" />
            <span className="flex-1 text-[0.875rem] font-medium text-ink-200">
              Appearance
            </span>
            <span className="text-xs text-ink-500">Dark</span>
          </div>
          <Link
            href="/app/trash"
            className="flex h-13 min-h-[3.25rem] items-center gap-3 border-t border-white/6 px-3.5"
          >
            <Trash2 className="h-[1.0625rem] w-[1.0625rem] text-ink-400" />
            <span className="flex-1 text-[0.875rem] font-medium text-ink-200">
              Trash
            </span>
            <ChevronRight className="h-4 w-4 text-ink-600" />
          </Link>
        </div>

        {/* Sign out */}
        <div className="mt-3 overflow-hidden rounded-2xl border border-white/7 bg-white/2">
          <SignOutButton redirectUrl="/">
            <button
              type="button"
              className="flex h-13 min-h-[3.25rem] w-full items-center justify-center text-[0.875rem] font-medium text-red-400"
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}

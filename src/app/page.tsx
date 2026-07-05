import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { NotebookPen } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex items-center gap-3">
        <NotebookPen className="h-8 w-8" />
        <h1 className="text-3xl font-semibold tracking-tight">Agenda</h1>
      </div>
      <p className="max-w-md text-balance text-sm text-neutral-500">
        Notes, tasks, and a daily agenda in one place. A clean foundation, built
        to extend.
      </p>

      <div className="flex items-center gap-3">
        <SignedOut>
          <Link
            href="/sign-in"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Create account
          </Link>
        </SignedOut>
        <SignedIn>
          <Link
            href="/app"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
          >
            Open app
          </Link>
        </SignedIn>
      </div>
    </main>
  );
}

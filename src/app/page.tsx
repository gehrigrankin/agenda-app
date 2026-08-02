import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { NotebookPen } from "lucide-react";

export default function LandingPage() {
  // <SignedIn>/<SignedOut> throw without a Clerk key; keyless mode (same
  // graceful degradation as the DB) shows the signed-out links.
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex items-center gap-3">
        <NotebookPen className="h-8 w-8" />
        <h1 className="text-3xl font-semibold tracking-tight">Agenda</h1>
      </div>
      <p className="max-w-md text-balance text-sm text-ink-500">
        Notes, tasks, and a daily agenda in one place. A clean foundation, built
        to extend.
      </p>

      <div className="flex items-center gap-3">
        {clerkEnabled ? (
          <>
            <SignedOut>
              <SignInLinks />
            </SignedOut>
            <SignedIn>
              <Link
                href="/app"
                className="rounded-md bg-ink-100 px-4 py-2 text-sm font-medium text-sage-ink hover:bg-white"
              >
                Open app
              </Link>
            </SignedIn>
          </>
        ) : (
          <SignInLinks />
        )}
      </div>
    </main>
  );
}

function SignInLinks() {
  return (
    <>
      <Link
        href="/sign-in"
        className="rounded-md bg-ink-100 px-4 py-2 text-sm font-medium text-sage-ink hover:bg-white"
      >
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="rounded-md border border-white/15 px-4 py-2 text-sm font-medium hover:bg-white/8"
      >
        Create account
      </Link>
    </>
  );
}

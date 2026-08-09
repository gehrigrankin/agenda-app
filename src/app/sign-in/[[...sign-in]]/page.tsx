import { SignIn } from "@clerk/nextjs";

import { ContinueAsGuest } from "@/components/auth/ContinueAsGuest";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="flex w-full max-w-[25rem] flex-col items-center gap-5">
        <SignIn />
        <div className="flex w-full items-center gap-3">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-ink-600">or</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
        <ContinueAsGuest />
      </div>
    </main>
  );
}

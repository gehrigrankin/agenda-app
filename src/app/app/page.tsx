import { currentUser } from "@clerk/nextjs/server";

import { Editor } from "@/components/editor/Editor";

export default async function AppHomePage() {
  const user = await currentUser();
  const greetingName = user?.firstName ?? "there";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
        <div>
          <h1 className="text-sm font-medium">Welcome back, {greetingName}</h1>
          <p className="text-xs text-neutral-500">
            Foundation editor — Note CRUD, autosave, and the daily agenda land
            next.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <Editor />
      </div>
    </div>
  );
}

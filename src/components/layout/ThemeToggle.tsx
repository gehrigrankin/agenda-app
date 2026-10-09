"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "agenda-theme";

function isDark() {
  return document.documentElement.classList.contains("dark");
}

export function ThemeToggle({
  mobile = false,
  row = false,
  menu = false,
}: {
  mobile?: boolean;
  row?: boolean;
  /** A popover-menu row (the main nav's More menu). */
  menu?: boolean;
}) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => setDark(isDark()), []);

  const toggle = () => {
    const nextDark = !isDark();
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.style.colorScheme = nextDark ? "dark" : "light";
    localStorage.setItem(STORAGE_KEY, nextDark ? "dark" : "light");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", nextDark ? "#141618" : "#f8faf8");
    setDark(nextDark);
  };

  const label = dark === false ? "Use dark mode" : "Use light mode";

  if (menu) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] text-ink-200 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-sage/60 touch:min-h-11"
      >
        {dark ? (
          <Sun className="h-4 w-4 flex-none text-ink-400" />
        ) : (
          <Moon className="h-4 w-4 flex-none text-ink-400" />
        )}
        <span className="min-w-0 flex-1">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={
        row
          ? "flex h-13 min-h-[3.25rem] w-full items-center gap-3 px-3.5 text-left"
          : mobile
          ? "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-white/7 bg-white/[0.03] px-2 py-2.5 text-ink-300"
          : "flex h-8 w-8 items-center justify-center rounded-xl text-ink-400 transition-colors hover:bg-white/6 hover:text-ink-200"
      }
    >
      {dark ? (
        <Sun className={mobile ? "h-5 w-5" : row ? "h-[1.0625rem] w-[1.0625rem] text-ink-400" : "h-4 w-4"} />
      ) : (
        <Moon className={mobile ? "h-5 w-5" : row ? "h-[1.0625rem] w-[1.0625rem] text-ink-400" : "h-4 w-4"} />
      )}
      {mobile && <span className="text-[0.6875rem] font-medium">Theme</span>}
      {row && (
        <>
          <span className="flex-1 text-[0.875rem] font-medium text-ink-200">
            Appearance
          </span>
          <span className="text-xs text-ink-500">
            {dark === null ? "System" : dark ? "Dark" : "Light"}
          </span>
        </>
      )}
    </button>
  );
}

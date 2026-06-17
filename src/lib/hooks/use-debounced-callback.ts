"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a debounced version of `callback` that fires `delay`ms after the last
 * call. Used for autosave so we persist on a pause in typing, not every
 * keystroke. The latest callback is always invoked (no stale closures), and any
 * pending call is flushed/cancelled on unmount.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    (...args: Args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay],
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Phone list → full-screen detail navigation backed by a query param
 * (`?t=`, `?person=`, `?item=`). `open(id)` pushes a history entry, so the
 * system back gesture and the screen's back chevron both return to the list;
 * a page loaded straight onto `?param=id` has no entry to pop, so `close()`
 * replaces the URL instead.
 *
 * With `initial` undefined the param is read after mount (keeps the first
 * client render identical to the server's); pass the server-known value when
 * there is one.
 */
export function usePhoneParam(name: string, initial?: string | null) {
  const [id, setId] = useState<string | null>(initial ?? null);
  const pushed = useRef(false);

  useEffect(() => {
    if (initial !== undefined) return;
    try {
      setId(new URL(window.location.href).searchParams.get(name));
    } catch {
      /* non-critical */
    }
  }, [initial, name]);

  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      try {
        setId(new URL(window.location.href).searchParams.get(name));
      } catch {
        setId(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [name]);

  const open = useCallback(
    (next: string) => {
      setId(next);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set(name, next);
        window.history.pushState(window.history.state, "", url);
        pushed.current = true;
      } catch {
        /* non-critical */
      }
    },
    [name],
  );

  const close = useCallback(() => {
    setId(null);
    try {
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
        return;
      }
      const url = new URL(window.location.href);
      if (!url.searchParams.has(name)) return;
      url.searchParams.delete(name);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* non-critical */
    }
  }, [name]);

  return { id, open, close };
}

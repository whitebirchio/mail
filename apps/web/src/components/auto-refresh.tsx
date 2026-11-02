"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetch the page every minute while the tab is visible, and on coming back to it (SPEC.md, story 8). */
export function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      router.refresh();
    };
    const id = setInterval(tick, everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > everyMs) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, everyMs]);
  return null;
}

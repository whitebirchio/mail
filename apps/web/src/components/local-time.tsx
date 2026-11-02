"use client";

import { useSyncExternalStore } from "react";

/**
 * Dates in the browser's own time zone, so the server needs no TZ config.
 * The server (and hydration) render the ISO date; the browser then swaps in
 * the local format.
 */
export function formatShort(ms: number, now = new Date()): string {
  const d = new Date(ms);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "numeric", day: "numeric" });
}

export function formatLong(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const subscribe = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

export function LocalTime({ ms, long = false, className }: { ms: number; long?: boolean; className?: string }) {
  const mounted = useMounted();
  const iso = new Date(ms).toISOString();
  return (
    <time dateTime={iso} title={mounted ? formatLong(ms) : undefined} className={className}>
      {mounted ? (long ? formatLong(ms) : formatShort(ms)) : iso.slice(0, 10)}
    </time>
  );
}

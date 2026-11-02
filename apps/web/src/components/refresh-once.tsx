"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** After the server marked a thread read, refresh once so the sidebar's unread count catches up. */
export function RefreshOnce() {
  const router = useRouter();
  useEffect(() => router.refresh(), [router]);
  return null;
}

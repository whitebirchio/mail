import { headers } from "next/headers";
import type { AppConfig } from "./config";

/**
 * Every Server Action checks this as well as Next's own check (SPEC.md,
 * Security model 4): the request's Origin must be exactly APP_URL. A
 * missing Origin fails closed.
 */
export function originAllowed(origin: string | null, config: AppConfig): boolean {
  return origin !== null && origin === config.appUrl;
}

export async function assertOrigin(config: AppConfig): Promise<void> {
  const origin = (await headers()).get("origin");
  if (!originAllowed(origin, config)) throw new Error("forbidden: cross-origin action");
}

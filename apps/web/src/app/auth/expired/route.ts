import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Gmail refused the refresh token (revoked, or expired): forget it and sign in again. */
export async function GET() {
  const loaded = await loadConfig();
  if (!loaded.ok) return new NextResponse("misconfigured", { status: 503 });
  console.log(JSON.stringify({ level: "info", message: "grant expired" }));
  const res = NextResponse.redirect(`${loaded.config.appUrl}/login?expired=1`, 302);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

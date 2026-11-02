import { type NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { revokeGrant } from "@/lib/oidc";
import { SESSION_COOKIE, openSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST only, so a link or image elsewhere can't sign you out. Revokes the Google grant, then clears the cookie either way. */
export async function POST(request: NextRequest) {
  const loaded = await loadConfig();
  if (!loaded.ok) return new NextResponse("misconfigured", { status: 503 });
  const { config } = loaded;
  const session = await openSession(request.cookies.get(SESSION_COOKIE)?.value, config.sessionKey, Math.floor(Date.now() / 1000));
  if (session) {
    const revoked = await revokeGrant(session.refreshToken);
    console.log(JSON.stringify({ level: "info", message: "signed out", revoked }));
  }
  const res = NextResponse.redirect(`${config.appUrl}/login`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

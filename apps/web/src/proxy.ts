import { type NextRequest, NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { SESSION_COOKIE, SESSION_TTL_S, cookieOptions, openSession, renewal, sealSession } from "@/lib/session";

/**
 * Runs before every route except static assets: fail closed on bad config,
 * send anyone without a valid owner session to /login, slide the session's
 * expiry, and set a per-request CSP nonce (Next applies it to its own scripts).
 */
const PUBLIC = new Set(["/login", "/auth/start", "/auth/callback", "/auth/logout", "/auth/expired"]);

function csp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Email frames (srcdoc) inherit this policy and narrow it with their own;
    // remote images load there only after "Show images". The app's own pages
    // carry no untrusted markup.
    "img-src 'self' data: https: http:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const loaded = await loadConfig();
  if (!loaded.ok) {
    return new NextResponse(`Mail is misconfigured: ${loaded.problems.join(", ")}`, { status: 503, headers: { "content-type": "text/plain" } });
  }
  const { config } = loaded;
  const path = request.nextUrl.pathname;
  const nowS = Math.floor(Date.now() / 1000);

  let renewed: string | null = null;
  if (!PUBLIC.has(path) && !config.devFake) {
    const session = await openSession(request.cookies.get(SESSION_COOKIE)?.value, config.sessionKey, nowS);
    if (!session || session.email !== config.ownerEmail) return NextResponse.redirect(`${config.appUrl}/login`, 302);
    const next = renewal(session, nowS);
    if (next) renewed = await sealSession(next, config.sessionKey);
  }

  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const policy = csp(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  if (renewed) response.cookies.set(SESSION_COOKIE, renewed, cookieOptions(SESSION_TTL_S));
  // Attachments carry their own, stricter policy (sandbox; default-src 'none').
  if (!path.startsWith("/attachments/")) response.headers.set("content-security-policy", policy);
  response.headers.set("cache-control", "no-store");
  // Opening a link from an email mustn't tell the sender's site where it came from.
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

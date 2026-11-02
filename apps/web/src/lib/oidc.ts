import type { AppConfig } from "./config";
import { OAUTH_TTL_S, randomToken, s256, signOAuth, verifyOAuth } from "./session";

/**
 * Google sign-in and Gmail consent in one flow (SPEC.md, Security model 1):
 * OpenID Connect authorization code + PKCE, state and nonce, with offline
 * access so Google returns a refresh token. The ID token comes straight from
 * Google's token endpoint over TLS, with the client secret, so its claims are
 * trusted per OIDC Core 3.1.3.7 step 6 and checked rather than its signature.
 * Only the owner's verified email gets in.
 */

export const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const SCOPES = ["openid", "email", GMAIL_SCOPE] as const;
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const callbackUrl = (c: AppConfig) => `${c.appUrl}/auth/callback`;

/** The Google URL to send the browser to, and the signed cookie that remembers state, nonce and verifier. */
export async function startSignIn(c: AppConfig, nowS: number): Promise<{ location: string; cookie: string }> {
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const url = new URL(GOOGLE_AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: c.googleClientId,
    redirect_uri: callbackUrl(c),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // consent: Google only returns a refresh token when it shows the consent screen.
    prompt: "consent select_account",
    login_hint: c.ownerEmail,
    state,
    nonce,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
  }).toString();
  return { location: url.toString(), cookie: await signOAuth({ state, nonce, verifier, exp: nowS + OAUTH_TTL_S }, c.sessionKey) };
}

export type SignInResult = { ok: true; email: string; refreshToken: string } | { ok: false; status: 400 | 403 | 502; reason: string };

const decodeClaims = (idToken: string): Record<string, unknown> | null => {
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Validate Google's callback and decide who signed in. `fetchFn` is injectable for tests. */
export async function finishSignIn(
  c: AppConfig,
  query: URLSearchParams,
  oauthCookie: string | undefined,
  nowS: number,
  fetchFn: typeof fetch = fetch,
): Promise<SignInResult> {
  const pending = await verifyOAuth(oauthCookie, c.sessionKey, nowS);
  if (!pending) return { ok: false, status: 400, reason: "The sign-in took too long or started elsewhere. Try again." };
  if (query.get("error")) return { ok: false, status: 400, reason: `Google said: ${query.get("error")}` };
  if (query.get("state") !== pending.state) return { ok: false, status: 400, reason: "The sign-in response didn't match this browser. Try again." };
  const code = query.get("code");
  if (!code) return { ok: false, status: 400, reason: "Google returned no code." };

  const res = await fetchFn(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: pending.verifier,
      redirect_uri: callbackUrl(c),
      client_id: c.googleClientId,
      client_secret: c.googleClientSecret,
    }).toString(),
  });
  if (!res.ok) return { ok: false, status: 502, reason: "Google refused the sign-in code." };
  const body = (await res.json()) as { id_token?: string; refresh_token?: string; scope?: string };
  const claims = body.id_token ? decodeClaims(body.id_token) : null;
  if (!claims) return { ok: false, status: 502, reason: "Google returned no identity." };

  if (typeof claims.iss !== "string" || !ISSUERS.includes(claims.iss)) return { ok: false, status: 403, reason: "Unexpected identity issuer." };
  if (claims.aud !== c.googleClientId) return { ok: false, status: 403, reason: "The identity was issued to another app." };
  if (typeof claims.exp !== "number" || claims.exp <= nowS) return { ok: false, status: 403, reason: "The identity has expired." };
  if (claims.nonce !== pending.nonce) return { ok: false, status: 403, reason: "The identity didn't match this sign-in." };
  if (claims.email_verified !== true) return { ok: false, status: 403, reason: "That Google account's email isn't verified." };
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  if (email !== c.ownerEmail) return { ok: false, status: 403, reason: "This mailbox is private to its owner." };
  // Google's consent screen lets you untick individual scopes.
  if (!(body.scope ?? "").split(" ").includes(GMAIL_SCOPE)) return { ok: false, status: 403, reason: "Mail needs permission to read and manage your Gmail. Sign in again and leave that box ticked." };
  if (!body.refresh_token) return { ok: false, status: 502, reason: "Google didn't grant offline access. Sign in again." };
  return { ok: true, email, refreshToken: body.refresh_token };
}

/** Revoke the whole grant (sign out). Best effort: the cookie is cleared either way. */
export async function revokeGrant(refreshToken: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(GOOGLE_REVOKE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

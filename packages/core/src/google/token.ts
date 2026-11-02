/**
 * Access tokens from the session's refresh token (SPEC.md, Security model 2).
 * They're cached in memory only, keyed by a hash of the refresh token, and
 * treated as expired 60 s early. Nothing here is ever logged.
 */

export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const EARLY_S = 60;

export type TokenResult = { ok: true; accessToken: string } | { ok: false; error: "revoked" | "unavailable" };

export interface TokenSource {
  /** An access token; `fresh` skips the cache (after Gmail answered 401). */
  get(fresh?: boolean): Promise<TokenResult>;
}

type Entry = { token: string; expiresAt: number };
const cache = new Map<string, Entry>();

async function keyOf(refreshToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(refreshToken));
  return Buffer.from(digest).toString("base64url");
}

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export function tokenSource(client: GoogleClient, refreshToken: string, fetchFn: typeof fetch = fetch, nowMs: () => number = Date.now): TokenSource {
  return {
    async get(fresh = false) {
      const key = await keyOf(refreshToken);
      const hit = cache.get(key);
      if (!fresh && hit && hit.expiresAt > nowMs()) return { ok: true, accessToken: hit.token };
      let res: Response;
      try {
        res = await fetchFn(GOOGLE_TOKEN, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret }).toString(),
        });
      } catch {
        return { ok: false, error: "unavailable" };
      }
      const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
      // invalid_grant: revoked, expired (7-day Testing tokens) or superseded. The only fix is signing in again.
      if (body.error === "invalid_grant") {
        cache.delete(key);
        return { ok: false, error: "revoked" };
      }
      if (!res.ok || typeof body.access_token !== "string" || typeof body.expires_in !== "number") return { ok: false, error: "unavailable" };
      cache.set(key, { token: body.access_token, expiresAt: nowMs() + (body.expires_in - EARLY_S) * 1000 });
      return { ok: true, accessToken: body.access_token };
    },
  };
}

/** Tests only. */
export const clearTokenCache = () => cache.clear();

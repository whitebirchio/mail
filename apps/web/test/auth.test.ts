import { describe, expect, it } from "vitest";
import { GMAIL_SCOPE, finishSignIn, revokeGrant, startSignIn } from "@/lib/oidc";
import { s256 } from "@/lib/session";
import { NOW, SECRETS, testConfig } from "./helpers";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
const GRANTED = `openid ${GMAIL_SCOPE} https://www.googleapis.com/auth/userinfo.email`;

async function begin() {
  const c = testConfig();
  const { location, cookie } = await startSignIn(c, NOW);
  const url = new URL(location);
  return { c, cookie, url, state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")! };
}

type TokenBody = { id_token?: string; refresh_token?: string; scope?: string };
function google(claims: Record<string, unknown>, extra: Partial<TokenBody> = {}, seen: { body?: URLSearchParams } = {}) {
  return (async (_url: string, init: RequestInit) => {
    seen.body = new URLSearchParams(String(init.body));
    return new Response(JSON.stringify({ id_token: idToken(claims), refresh_token: "1//0test-refresh", scope: GRANTED, ...extra }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("Google sign-in", () => {
  it("asks for offline Gmail access with PKCE, state and nonce, redirecting back to the configured origin", async () => {
    const { url } = await begin();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "123-abc.apps.googleusercontent.com",
      redirect_uri: "https://mail.example.com/auth/callback",
      response_type: "code",
      scope: `openid email ${GMAIL_SCOPE}`,
      access_type: "offline",
      prompt: "consent select_account",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("state")).toHaveLength(43);
    expect(url.searchParams.get("nonce")).toHaveLength(43);
  });

  it("lets the owner in with a refresh token, sending the PKCE verifier and client secret to Google", async () => {
    const { c, cookie, state, nonce, url } = await begin();
    const seen: { body?: URLSearchParams } = {};
    const ok = { iss: "https://accounts.google.com", aud: c.googleClientId, exp: NOW + 300, nonce, email: "OWNER@example.com", email_verified: true };
    const r = await finishSignIn(c, new URLSearchParams({ state, code: "c0de" }), cookie, NOW, google(ok, {}, seen));
    expect(r).toEqual({ ok: true, email: "owner@example.com", refreshToken: "1//0test-refresh" });
    expect(await s256(seen.body!.get("code_verifier")!)).toBe(url.searchParams.get("code_challenge"));
    expect(seen.body!.get("client_secret")).toBe(SECRETS.GOOGLE_CLIENT_SECRET);
  });

  it("refuses everyone and everything else", async () => {
    const { c, cookie, state, nonce } = await begin();
    const ok = { iss: "https://accounts.google.com", aud: c.googleClientId, exp: NOW + 300, nonce, email: "owner@example.com", email_verified: true };
    const q = new URLSearchParams({ state, code: "c0de" });
    const cases: [string, Record<string, unknown>, Partial<TokenBody>, number][] = [
      ["another account", { ...ok, email: "someone@example.com" }, {}, 403],
      ["unverified email", { ...ok, email_verified: false }, {}, 403],
      ["wrong audience", { ...ok, aud: "other.apps.googleusercontent.com" }, {}, 403],
      ["wrong issuer", { ...ok, iss: "https://evil.example" }, {}, 403],
      ["expired token", { ...ok, exp: NOW - 1 }, {}, 403],
      ["wrong nonce", { ...ok, nonce: "replayed" }, {}, 403],
      ["Gmail box unticked", ok, { scope: "openid https://www.googleapis.com/auth/userinfo.email" }, 403],
      ["no refresh token", ok, { refresh_token: undefined }, 502],
    ];
    for (const [name, claims, extra, status] of cases) {
      expect(await finishSignIn(c, q, cookie, NOW, google(claims, extra)), name).toMatchObject({ ok: false, status });
    }
    expect(await finishSignIn(c, new URLSearchParams({ state: "other", code: "c" }), cookie, NOW, google(ok))).toMatchObject({ ok: false, status: 400 });
    expect(await finishSignIn(c, new URLSearchParams({ state, error: "access_denied" }), cookie, NOW, google(ok))).toMatchObject({ ok: false, status: 400 });
    expect(await finishSignIn(c, q, undefined, NOW, google(ok))).toMatchObject({ ok: false, status: 400 });
    expect(await finishSignIn(c, q, cookie, NOW + 601, google(ok))).toMatchObject({ ok: false, status: 400 }); // the round trip expired
    const refused = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    expect(await finishSignIn(c, q, cookie, NOW, refused)).toMatchObject({ ok: false, status: 502 });
  });
});

describe("sign out", () => {
  it("revokes the refresh token at Google, and reports failure without throwing", async () => {
    let sent: URLSearchParams | undefined;
    const ok = (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/revoke");
      sent = new URLSearchParams(String(init.body));
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await revokeGrant("1//0test-refresh", ok)).toBe(true);
    expect(sent!.get("token")).toBe("1//0test-refresh");
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await revokeGrant("1//0test-refresh", down)).toBe(false);
  });
});

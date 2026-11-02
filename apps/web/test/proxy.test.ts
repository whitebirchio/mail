import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { RENEW_AFTER_S, SESSION_COOKIE, newSession, openSession, sealSession } from "@/lib/session";
import { ENV, KEY_B64, SECRETS } from "./helpers";

const key = new Uint8Array(Buffer.from(KEY_B64, "base64url"));
const nowS = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  Object.assign(process.env, ENV, SECRETS);
  delete process.env.SECRETS_PATH;
});

const req = (path: string, cookie?: string) =>
  new NextRequest(`https://8f6j.lambda-web.us-east-1.on.aws${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

describe("proxy", () => {
  it("sends anyone without a session to /login on the public origin, not the Web Function's", async () => {
    const res = await proxy(req("/t/abc"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://mail.example.com/login");
  });

  it("lets the owner through with a nonce CSP, no caching and no referrer", async () => {
    const token = await sealSession(newSession("owner@example.com", "1//0test", nowS()), key);
    const res = await proxy(req("/", token));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'; .*frame-ancestors 'none'/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined(); // fresh: no renewal
  });

  it("slides a session more than a day old", async () => {
    const old = newSession("owner@example.com", "1//0test", nowS() - RENEW_AFTER_S - 5);
    const res = await proxy(req("/", await sealSession(old, key)));
    expect(res.status).toBe(200);
    const renewed = await openSession(res.cookies.get(SESSION_COOKIE)?.value, key, nowS());
    expect(renewed).toMatchObject({ email: "owner@example.com", refreshToken: "1//0test" });
    expect(renewed!.exp).toBeGreaterThan(old.exp);
    expect(res.cookies.get(SESSION_COOKIE)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });

  it("refuses a session for anyone but the owner, and an expired one", async () => {
    const other = await sealSession(newSession("someone@example.com", "1//0test", nowS()), key);
    const old = await sealSession({ ...newSession("owner@example.com", "1//0test", nowS()), exp: nowS() - 1 }, key);
    expect((await proxy(req("/", other))).status).toBe(302);
    expect((await proxy(req("/", old))).status).toBe(302);
  });

  it("leaves the sign-in routes open", async () => {
    for (const p of ["/login", "/auth/start", "/auth/callback", "/auth/logout"]) expect((await proxy(req(p))).status).toBe(200);
  });

  it("fails closed when misconfigured, naming the variables", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const res = await proxy(req("/login"));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("GOOGLE_CLIENT_SECRET");
  });
});

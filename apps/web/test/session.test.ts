import { describe, expect, it } from "vitest";
import { RENEW_AFTER_S, SESSION_TTL_S, newSession, openSession, renewal, sealSession, signOAuth, verifyOAuth } from "@/lib/session";
import { KEY_B64, NOW, OTHER_KEY_B64 } from "./helpers";

const key = new Uint8Array(Buffer.from(KEY_B64, "base64url"));
const otherKey = new Uint8Array(Buffer.from(OTHER_KEY_B64, "base64url"));
const session = newSession("owner@example.com", "1//0test-refresh-token", NOW);

describe("session cookie", () => {
  it("round-trips, and doesn't reveal the refresh token or email", async () => {
    const token = await sealSession(session, key);
    expect(await openSession(token, key, NOW)).toEqual(session);
    const raw = Buffer.from(token, "base64url").toString("latin1");
    expect(raw).not.toContain("1//0test");
    expect(raw).not.toContain("owner@");
  });

  it("uses a fresh IV each time", async () => {
    expect(await sealSession(session, key)).not.toBe(await sealSession(session, key));
  });

  it("rejects tampering, the wrong key, expiry, garbage and absence", async () => {
    const token = await sealSession(session, key);
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 1]! ^= 1;
    expect(await openSession(bytes.toString("base64url"), key, NOW)).toBeNull();
    expect(await openSession(token, otherKey, NOW)).toBeNull();
    expect(await openSession(token, key, NOW + SESSION_TTL_S)).toBeNull();
    expect(await openSession("not-a-cookie", key, NOW)).toBeNull();
    expect(await openSession(undefined, key, NOW)).toBeNull();
  });

  it("can't be opened as an OAuth cookie, nor the reverse", async () => {
    const sealed = await sealSession(session, key);
    expect(await verifyOAuth(sealed, key, NOW)).toBeNull();
    const signed = await signOAuth({ state: "s", nonce: "n", verifier: "v", exp: NOW + 60 }, key);
    expect(await openSession(signed, key, NOW)).toBeNull();
  });

  it("slides: renews only once it's more than a day old", () => {
    expect(renewal(session, NOW + RENEW_AFTER_S)).toBeNull();
    const renewed = renewal(session, NOW + RENEW_AFTER_S + 1);
    expect(renewed).toEqual({ ...session, iat: NOW + RENEW_AFTER_S + 1, exp: NOW + RENEW_AFTER_S + 1 + SESSION_TTL_S });
  });
});

describe("OAuth cookie", () => {
  const pending = { state: "st", nonce: "no", verifier: "ve", exp: NOW + 60 };

  it("round-trips; rejects tampering, the wrong key and expiry", async () => {
    const token = await signOAuth(pending, key);
    expect(await verifyOAuth(token, key, NOW)).toEqual(pending);
    const [, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...pending, state: "evil" })).toString("base64url");
    expect(await verifyOAuth(`${forged}.${mac}`, key, NOW)).toBeNull();
    expect(await verifyOAuth(token, otherKey, NOW)).toBeNull();
    expect(await verifyOAuth(token, key, NOW + 60)).toBeNull();
    expect(await verifyOAuth(undefined, key, NOW)).toBeNull();
  });
});

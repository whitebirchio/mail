import { describe, expect, it } from "vitest";
import { parseConfig } from "@/lib/config";
import { ENV, SECRETS, testConfig } from "./helpers";

describe("config", () => {
  it("parses, lower-casing the owner email and decoding the 32-byte key", () => {
    const c = testConfig();
    expect(c).toMatchObject({ appUrl: "https://mail.example.com", ownerEmail: "owner@example.com" });
    expect(c.sessionKey).toHaveLength(32);
  });

  it("accepts localhost for local dev", () => {
    expect(parseConfig({ ...ENV, APP_URL: "http://localhost:3000" }, SECRETS).ok).toBe(true);
  });

  it("fails closed, naming only what's wrong, never the values", () => {
    const r = parseConfig({ ...ENV, APP_URL: "http://evil.example" }, { GOOGLE_CLIENT_SECRET: undefined, SESSION_KEY: "too-short" });
    expect(r).toEqual({ ok: false, problems: ["APP_URL", "GOOGLE_CLIENT_SECRET", "SESSION_KEY"] });
    expect(JSON.stringify(r)).not.toContain("too-short");
  });

  it("rejects a client id that isn't Google's and a trailing slash on the origin", () => {
    const r = parseConfig({ ...ENV, APP_URL: "https://mail.example.com/", GOOGLE_CLIENT_ID: "abc" }, SECRETS);
    expect(r).toEqual({ ok: false, problems: ["APP_URL", "GOOGLE_CLIENT_ID"] });
  });
});

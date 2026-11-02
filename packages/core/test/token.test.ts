import { beforeEach, describe, expect, it } from "vitest";
import { clearTokenCache, tokenSource } from "../src/google/token";

const client = { clientId: "id.apps.googleusercontent.com", clientSecret: "GOCSPX-test" };
let calls: URLSearchParams[] = [];
const google = (body: object, status = 200) =>
  (async (_url: string, init: RequestInit) => {
    calls.push(new URLSearchParams(String(init.body)));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

beforeEach(() => {
  clearTokenCache();
  calls = [];
});

describe("tokenSource", () => {
  it("exchanges the refresh token, then serves the cached token until 60 s before expiry", async () => {
    let now = 1_000_000;
    const src = tokenSource(client, "1//0test-a", google({ access_token: "ya29.one", expires_in: 3600 }), () => now);
    expect(await src.get()).toEqual({ ok: true, accessToken: "ya29.one" });
    expect(calls[0]!.get("grant_type")).toBe("refresh_token");
    expect(calls[0]!.get("refresh_token")).toBe("1//0test-a");
    expect(calls[0]!.get("client_secret")).toBe("GOCSPX-test");
    now += 3539_000;
    await src.get();
    expect(calls).toHaveLength(1);
    now += 2_000;
    await src.get();
    expect(calls).toHaveLength(2);
  });

  it("skips the cache when asked for a fresh token", async () => {
    const src = tokenSource(client, "1//0test-b", google({ access_token: "ya29.x", expires_in: 3600 }));
    await src.get();
    await src.get(true);
    expect(calls).toHaveLength(2);
  });

  it("keeps tokens for different sessions apart", async () => {
    const f = google({ access_token: "ya29.x", expires_in: 3600 });
    await tokenSource(client, "1//0test-c", f).get();
    await tokenSource(client, "1//0test-d", f).get();
    expect(calls).toHaveLength(2);
  });

  it("reports a revoked grant as revoked, and anything else as unavailable", async () => {
    expect(await tokenSource(client, "1//0test-e", google({ error: "invalid_grant" }, 400)).get()).toEqual({ ok: false, error: "revoked" });
    expect(await tokenSource(client, "1//0test-f", google({ error: "server_error" }, 500)).get()).toEqual({ ok: false, error: "unavailable" });
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await tokenSource(client, "1//0test-g", down).get()).toEqual({ ok: false, error: "unavailable" });
  });
});

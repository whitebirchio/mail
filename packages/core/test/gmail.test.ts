import { describe, expect, it } from "vitest";
import type { TokenSource } from "../src/google/token";
import { GMAIL, GmailMailbox, LIST_CONCURRENCY } from "../src/mailbox/gmail";
import { meta, thread, threadJson } from "./fixtures/gmail";

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function harness(route: Route, tokens: string[] = ["ya29.a", "ya29.b"]) {
  const seen: { url: URL; auth: string }[] = [];
  const fresh: boolean[] = [];
  const src: TokenSource = {
    async get(f = false) {
      fresh.push(f);
      return { ok: true, accessToken: f ? tokens[1]! : tokens[0]! };
    },
  };
  const fetchFn = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    seen.push({ url, auth: (init.headers as Record<string, string>).authorization! });
    return route(url, init);
  }) as unknown as typeof fetch;
  const slept: number[] = [];
  const events: { endpoint: string; status: number | "network" }[] = [];
  const mailbox = new GmailMailbox(src, { fetchFn, sleep: async (ms) => void slept.push(ms), observe: (e) => events.push(e) });
  return { mailbox, seen, fresh, slept, events };
}

const T1 = thread("t1", [meta({ id: "a" }), meta({ id: "b", labelIds: ["INBOX", "UNREAD"] })]);
const T2 = thread("t2", [meta({ id: "c" })]);
const byPath = (threads: Record<string, unknown>): Route => (url) => {
  if (url.pathname.endsWith("/threads")) return json({ threads: Object.keys(threads).map((id) => ({ id, snippet: "", historyId: "1" })), nextPageToken: "NEXT", resultSizeEstimate: 40 });
  const id = url.pathname.split("/").at(-1)!;
  const t = threads[id];
  return t ? json(t) : json({ error: { code: 404 } }, 404);
};

describe("GmailMailbox.listThreads", () => {
  it("lists a label's page, then fetches each thread's metadata with only the list headers", async () => {
    const { mailbox, seen } = harness(byPath({ t1: threadJson(T1), t2: threadJson(T2) }));
    const r = await mailbox.listThreads({ labelId: "INBOX", pageToken: "P2" });
    expect(r).toMatchObject({ ok: true, value: { nextPageToken: "NEXT", resultSizeEstimate: 40 } });
    if (!r.ok) throw new Error();
    expect(r.value.threads.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(r.value.threads[0]!.messages[1]).toMatchObject({ id: "b", labelIds: ["INBOX", "UNREAD"], mimeType: "multipart/alternative" });
    expect(typeof r.value.threads[0]!.messages[0]!.internalDate).toBe("number");

    const list = seen[0]!.url;
    expect(list.origin + list.pathname).toBe(`${GMAIL}/threads`);
    expect(Object.fromEntries(list.searchParams)).toEqual({ maxResults: "25", labelIds: "INBOX", pageToken: "P2" });
    const get = seen[1]!.url;
    expect(get.searchParams.get("format")).toBe("metadata");
    expect(get.searchParams.getAll("metadataHeaders")).toEqual(["From", "To", "Cc", "Subject", "Date"]);
    expect(seen.every((s) => s.auth === "Bearer ya29.a")).toBe(true);
  });

  it("passes a Gmail search through untouched", async () => {
    const { mailbox, seen } = harness(byPath({}));
    await mailbox.listThreads({ q: "from:ann@example.org has:attachment newer_than:7d" });
    expect(seen[0]!.url.searchParams.get("q")).toBe("from:ann@example.org has:attachment newer_than:7d");
    expect(seen[0]!.url.searchParams.has("labelIds")).toBe(false);
  });

  it("keeps at most LIST_CONCURRENCY metadata requests in flight, and keeps order", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `t${i}`);
    let inFlight = 0;
    let peak = 0;
    const { mailbox } = harness(async (url) => {
      if (url.pathname.endsWith("/threads")) return json({ threads: ids.map((id) => ({ id })) });
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return json(threadJson(thread(url.pathname.split("/").at(-1)!, [meta()])));
    });
    const r = await mailbox.listThreads({ labelId: "INBOX" });
    expect(peak).toBe(LIST_CONCURRENCY);
    expect(r.ok && r.value.threads.map((t) => t.id)).toEqual(ids);
  });

  it("drops a thread deleted between list and get", async () => {
    const { mailbox } = harness(byPath({ t1: threadJson(T1) }));
    const r = await mailbox.listThreads({ labelId: "INBOX" });
    expect(r.ok && r.value.threads.map((t) => t.id)).toEqual(["t1"]);
  });

  it("handles an empty label (Gmail omits `threads`)", async () => {
    const { mailbox } = harness(() => json({ resultSizeEstimate: 0 }));
    expect(await mailbox.listThreads({ labelId: "SPAM" })).toEqual({ ok: true, value: { threads: [], nextPageToken: null, resultSizeEstimate: 0 } });
  });
});

describe("GmailMailbox: auth, retries and errors", () => {
  it("on 401, gets a fresh token and retries once", async () => {
    let n = 0;
    const { mailbox, fresh, seen } = harness(() => (n++ === 0 ? json({}, 401) : json({ resultSizeEstimate: 0 })));
    expect((await mailbox.listThreads({})).ok).toBe(true);
    expect(fresh).toEqual([false, true]);
    expect(seen[1]!.auth).toBe("Bearer ya29.b");
  });

  it("a second 401 is an auth error, as is a revoked grant", async () => {
    const { mailbox } = harness(() => json({}, 401));
    expect(await mailbox.listThreads({})).toEqual({ ok: false, error: "auth" });
    const revoked = new GmailMailbox({ get: async () => ({ ok: false, error: "revoked" }) });
    expect(await revoked.listLabels()).toEqual({ ok: false, error: "auth" });
  });

  it("backs off once on a rate limit (429, or 403 rateLimitExceeded), then reports it", async () => {
    let n = 0;
    const once = harness(() => (n++ === 0 ? json({}, 429) : json({ resultSizeEstimate: 0 })));
    expect((await once.mailbox.listThreads({})).ok).toBe(true);
    expect(once.slept).toEqual([1000]);
    const limited = { error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] } };
    const always = harness(() => json(limited, 403));
    expect(await always.mailbox.listThreads({})).toEqual({ ok: false, error: "rate-limited" });
    expect(always.slept).toEqual([1000]);
  });

  it("maps 5xx and network failures to unavailable, and a malformed body to invalid-response", async () => {
    expect(await harness(() => json({}, 503)).mailbox.listThreads({})).toEqual({ ok: false, error: "unavailable" });
    expect(
      await harness(() => {
        throw new TypeError("fetch failed");
      }).mailbox.listThreads({}),
    ).toEqual({ ok: false, error: "unavailable" });
    expect(await harness(() => json({ threads: "nope" })).mailbox.listThreads({})).toEqual({ ok: false, error: "invalid-response" });
    expect(await harness(() => json({}, 400)).mailbox.listThreads({})).toEqual({ ok: false, error: "invalid-response" });
  });

  it("reports each call's endpoint and status, and nothing else", async () => {
    const { mailbox, events } = harness(byPath({ t1: threadJson(T1) }));
    await mailbox.listThreads({ q: "secret search" });
    expect(events.map((e) => [e.endpoint, e.status])).toEqual([
      ["threads.list", 200],
      ["threads.get", 200],
    ]);
    expect(JSON.stringify(events)).not.toContain("secret");
  });
});

describe("GmailMailbox.listLabels", () => {
  it("lists labels with the inbox's unread thread count", async () => {
    const { mailbox } = harness((url) =>
      url.pathname.endsWith("/labels/INBOX")
        ? json({ id: "INBOX", threadsUnread: 3, threadsTotal: 100 })
        : json({ labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "Label_1", name: "Receipts", type: "user" }] }),
    );
    expect(await mailbox.listLabels()).toEqual({
      ok: true,
      value: [
        { id: "INBOX", name: "INBOX", type: "system", unreadThreads: 3 },
        { id: "Label_1", name: "Receipts", type: "user" },
      ],
    });
  });
});

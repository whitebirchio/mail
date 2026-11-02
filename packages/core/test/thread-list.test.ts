import { describe, expect, it } from "vitest";
import { FakeMailbox } from "../src/mailbox/fake";
import { mapLimit } from "../src/util/limit";
import { peopleLine, threadRow } from "../src/views/thread-list";
import { OWNER, meta, thread } from "./fixtures/gmail";

describe("threadRow", () => {
  it("summarizes a conversation: senders in order, me, count, flags and the latest snippet", () => {
    const t = thread("t1", [
      meta({ from: "Ann Example <ann@example.org>", subject: "Lunch on Friday", internalDate: 1000, snippet: "first" }),
      meta({ from: `Owner <${OWNER}>`, subject: "Re: Lunch on Friday", internalDate: 2000, labelIds: ["INBOX", "SENT"] }),
      meta({ from: "ann@example.org", internalDate: 3000, labelIds: ["INBOX", "UNREAD", "STARRED"], snippet: "It&#39;s a plan", mimeType: "multipart/mixed" }),
    ]);
    expect(threadRow(t, "OWNER@example.com")).toMatchObject({
      id: "t1",
      senders: [
        { name: "Ann Example", unread: true },
        { name: "me", unread: false },
      ],
      count: 3,
      subject: "Lunch on Friday",
      snippet: "It's a plan",
      date: 3000,
      unread: true,
      starred: true,
      attachment: true,
      draft: false,
    });
  });

  it("merges a sender by address, taking the display name when a later message has it", () => {
    const t = thread("t3", [meta({ from: "cy@example.org", internalDate: 1 }), meta({ from: "Cy Example <CY@example.org>", internalDate: 2 })]);
    expect(threadRow(t, OWNER).senders).toEqual([{ name: "Cy Example", unread: false }]);
  });

  it("orders messages by date, ignores drafts as senders, and flags the draft", () => {
    const t = thread("t2", [
      meta({ from: `me <${OWNER}>`, internalDate: 5000, labelIds: ["DRAFT"], snippet: "draft text" }),
      meta({ from: "Bob <bob@example.org>", internalDate: 4000, snippet: "question?" }),
    ]);
    const row = threadRow(t, OWNER);
    expect(row).toMatchObject({ senders: [{ name: "Bob", unread: false }], count: 1, draft: true, snippet: "question?", date: 4000 });
  });

  it("names people Gmail-style", () => {
    const base = threadRow(thread("t", [meta()]), OWNER);
    const named = (names: string[]) => ({ ...base, senders: names.map((name) => ({ name, unread: false })) });
    expect(peopleLine(named(["Ann", "me"]), false)).toBe("Ann, me");
    expect(peopleLine(named(["Ann", "Bob", "Cy", "me"]), false)).toBe("Ann … Cy, me");
    expect(peopleLine({ ...base, recipients: ["Dee", "Eve"] }, true)).toBe("To: Dee, Eve");
    expect(peopleLine({ ...named([]), draft: true }, false)).toBe("Draft");
  });
});

describe("FakeMailbox", () => {
  it("lists by label, newest first, with page tokens, and can fail on demand", async () => {
    const fake = new FakeMailbox([
      thread("old", [meta({ internalDate: 1 })]),
      thread("new", [meta({ internalDate: 9 })]),
      thread("spam", [meta({ internalDate: 5, labelIds: ["SPAM"] })]),
    ]);
    const r = await fake.listThreads({ labelId: "INBOX", pageSize: 1 });
    expect(r.ok && [r.value.threads.map((t) => t.id), r.value.nextPageToken]).toEqual([["new"], "1"]);
    const all = await fake.listThreads({});
    expect(all.ok && all.value.threads.map((t) => t.id)).toEqual(["new", "old"]);
    fake.failNext = "unavailable";
    expect(await fake.listLabels()).toEqual({ ok: false, error: "unavailable" });
    expect((await fake.listLabels()).ok).toBe(true);
  });
});

describe("mapLimit", () => {
  it("keeps order and handles empty input", async () => {
    expect(await mapLimit([3, 1, 2], 2, async (n) => n * 2)).toEqual([6, 2, 4]);
    expect(await mapLimit([], 5, async (n) => n)).toEqual([]);
  });
});

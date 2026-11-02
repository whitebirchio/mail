import { describe, expect, it } from "vitest";
import { TRIAGE, type Triage, inverse, isTriage, triage } from "../src/actions";
import type { TokenSource } from "../src/google/token";
import { FakeMailbox } from "../src/mailbox/fake";
import { GmailMailbox } from "../src/mailbox/gmail";
import { meta, thread } from "./fixtures/gmail";

const labelsOf = (fake: FakeMailbox, id: string) => [...new Set(fake.threads.find((t) => t.id === id)!.messages.flatMap((m) => m.labelIds))].sort();

const start: Record<Triage, string[]> = {
  archive: ["INBOX", "UNREAD"],
  inbox: ["IMPORTANT"],
  read: ["INBOX", "UNREAD"],
  unread: ["INBOX"],
  star: ["INBOX"],
  unstar: ["INBOX", "STARRED"],
  trash: ["INBOX"],
  untrash: ["INBOX", "TRASH"],
  spam: ["INBOX"],
  notSpam: ["SPAM"],
};

const expected: Record<Triage, string[]> = {
  archive: ["UNREAD"],
  inbox: ["IMPORTANT", "INBOX"],
  read: ["INBOX"],
  unread: ["INBOX", "UNREAD"],
  star: ["INBOX", "STARRED"],
  unstar: ["INBOX"],
  trash: ["INBOX", "TRASH"],
  untrash: ["INBOX"],
  spam: ["SPAM"],
  notSpam: ["INBOX"],
};

describe("triage", () => {
  for (const verb of TRIAGE) {
    it(`${verb} changes the labels, and its inverse (${inverse(verb)}) restores them`, async () => {
      const fake = new FakeMailbox([thread("t", [meta({ labelIds: [...start[verb]] }), meta({ labelIds: [...start[verb]] })])]);
      const r = await triage(fake, ["t"], verb);
      expect(r).toEqual({ ok: true, undo: { threadIds: ["t"], verb: inverse(verb) } });
      expect(labelsOf(fake, "t")).toEqual(expected[verb]);
      if (!r.ok) throw new Error();
      await triage(fake, r.undo.threadIds, r.undo.verb);
      expect(labelsOf(fake, "t")).toEqual([...start[verb]].sort());
    });
  }

  it("uses Gmail's trash endpoints for trash and untrash, and label edits for the rest", async () => {
    const fake = new FakeMailbox([thread("t", [meta()])]);
    await triage(fake, ["t"], "trash");
    await triage(fake, ["t"], "untrash");
    await triage(fake, ["t"], "archive");
    expect(fake.calls).toEqual([
      { op: "trash", threadId: "t" },
      { op: "untrash", threadId: "t" },
      { op: "modify", threadId: "t", change: { add: [], remove: ["INBOX"] } },
    ]);
  });

  it("acts on each selected thread once", async () => {
    const fake = new FakeMailbox([thread("a", [meta()]), thread("b", [meta()])]);
    const r = await triage(fake, ["a", "b", "a"], "star");
    expect(r.ok && r.undo.threadIds).toEqual(["a", "b"]);
    expect(fake.calls).toHaveLength(2);
  });

  it("returns a status for an empty selection, and for a partial failure an Undo covering what changed", async () => {
    const fake = new FakeMailbox([thread("a", [meta()])]);
    expect(await triage(fake, [], "archive")).toEqual({ ok: false, error: "nothing-selected", undo: null });
    expect(await triage(fake, ["a", "gone"], "archive")).toEqual({ ok: false, error: "not-found", undo: { threadIds: ["a"], verb: "inbox" } });
  });

  it("validates verbs from the wire", () => {
    expect(isTriage("archive")).toBe(true);
    expect(isTriage("delete")).toBe(false);
    expect(isTriage(undefined)).toBe(false);
  });
});

describe("GmailMailbox label changes", () => {
  it("POSTs threads.modify with label ids, and trash/untrash with no body", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method, body: init.body as string | undefined });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const tokens: TokenSource = { get: async () => ({ ok: true, accessToken: "ya29.t" }) };
    const mb = new GmailMailbox(tokens, { fetchFn });
    expect(await mb.modifyThread("t 1", { add: ["STARRED"], remove: ["UNREAD"] })).toEqual({ ok: true, value: null });
    await mb.trashThread("t1");
    await mb.untrashThread("t1");
    expect(calls).toEqual([
      { url: "https://gmail.googleapis.com/gmail/v1/users/me/threads/t%201/modify", method: "POST", body: '{"addLabelIds":["STARRED"],"removeLabelIds":["UNREAD"]}' },
      { url: "https://gmail.googleapis.com/gmail/v1/users/me/threads/t1/trash", method: "POST", body: undefined },
      { url: "https://gmail.googleapis.com/gmail/v1/users/me/threads/t1/untrash", method: "POST", body: undefined },
    ]);
  });
});

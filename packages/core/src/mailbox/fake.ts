import { headerValue } from "../message/headers";
import { findPart } from "../message/parse";
import {
  type AttachmentData,
  type FullMessage,
  type FullThread,
  type Label,
  type LabelChange,
  type Mailbox,
  type MailboxError,
  type Result,
  type ThreadMeta,
  type ThreadPage,
  type ThreadQuery,
  fail,
  ok,
} from "./port";

/**
 * An in-memory Mailbox for tests. Threads are listed newest first; `q`
 * matches subject or snippet as a plain substring (not Gmail's syntax).
 * Set `failNext` to make the next call return that error.
 */
export class FakeMailbox implements Mailbox {
  failNext: MailboxError | null = null;

  constructor(
    public threads: (ThreadMeta | FullThread)[] = [],
    public userLabels: { id: string; name: string }[] = [],
  ) {}

  private failing<T>(): Result<T> | null {
    const e = this.failNext;
    this.failNext = null;
    return e ? fail(e) : null;
  }

  async listLabels(): Promise<Result<Label[]>> {
    const f = this.failing<Label[]>();
    if (f) return f;
    const unread = this.threads.filter((t) => t.messages.some((m) => m.labelIds.includes("INBOX")) && t.messages.some((m) => m.labelIds.includes("UNREAD"))).length;
    const system: Label[] = ["INBOX", "STARRED", "SENT", "DRAFT", "SPAM", "TRASH", "UNREAD", "IMPORTANT"].map((id) => ({
      id,
      name: id,
      type: "system" as const,
      ...(id === "INBOX" ? { unreadThreads: unread } : {}),
    }));
    return ok([...system, ...this.userLabels.map((l) => ({ ...l, type: "user" as const }))]);
  }

  async listThreads(query: ThreadQuery): Promise<Result<ThreadPage>> {
    const f = this.failing<ThreadPage>();
    if (f) return f;
    const latest = (t: ThreadMeta) => Math.max(...t.messages.map((m) => m.internalDate));
    let matches = [...this.threads].sort((a, b) => latest(b) - latest(a));
    if (query.labelId) matches = matches.filter((t) => t.messages.some((m) => m.labelIds.includes(query.labelId!)));
    else matches = matches.filter((t) => !t.messages.every((m) => m.labelIds.includes("SPAM") || m.labelIds.includes("TRASH")));
    if (query.q) {
      const q = query.q.toLowerCase();
      matches = matches.filter((t) => t.messages.some((m) => headerValue(m.headers, "Subject").toLowerCase().includes(q) || m.snippet.toLowerCase().includes(q)));
    }
    const size = query.pageSize ?? 25;
    const start = query.pageToken ? Number(query.pageToken) : 0;
    const page = matches.slice(start, start + size);
    return ok({ threads: page, nextPageToken: start + size < matches.length ? String(start + size) : null, resultSizeEstimate: matches.length });
  }

  async getThread(threadId: string): Promise<Result<FullThread>> {
    const f = this.failing<FullThread>();
    if (f) return f;
    const t = this.threads.find((x) => x.id === threadId);
    if (!t || !t.messages.every((m) => "payload" in m)) return fail("not-found");
    return ok(structuredClone(t) as FullThread);
  }

  async getAttachment(messageId: string, partId: string): Promise<Result<AttachmentData>> {
    const f = this.failing<AttachmentData>();
    if (f) return f;
    const m = this.threads.flatMap((t) => t.messages).find((x) => x.id === messageId) as FullMessage | undefined;
    const part = m?.payload ? findPart(m.payload, partId) : null;
    if (!part) return fail("not-found");
    return ok({ filename: part.filename, mimeType: part.mimeType, bytes: new Uint8Array(Buffer.from(part.body.data ?? "", "base64url")) });
  }

  /** Every label-changing call, in order, for assertions. */
  calls: { op: "modify" | "trash" | "untrash"; threadId: string; change?: LabelChange }[] = [];

  private relabel(threadId: string, fn: (labels: Set<string>) => void): Result<null> {
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) return fail("not-found");
    for (const m of t.messages) {
      const labels = new Set(m.labelIds);
      fn(labels);
      m.labelIds = [...labels];
    }
    return ok(null);
  }

  async modifyThread(threadId: string, change: LabelChange): Promise<Result<null>> {
    const f = this.failing<null>();
    if (f) return f;
    this.calls.push({ op: "modify", threadId, change });
    return this.relabel(threadId, (l) => {
      for (const r of change.remove) l.delete(r);
      for (const a of change.add) l.add(a);
    });
  }

  // Like Gmail: trash adds TRASH and keeps the other labels; untrash removes it.
  async trashThread(threadId: string): Promise<Result<null>> {
    const f = this.failing<null>();
    if (f) return f;
    this.calls.push({ op: "trash", threadId });
    return this.relabel(threadId, (l) => void l.add("TRASH"));
  }

  async untrashThread(threadId: string): Promise<Result<null>> {
    const f = this.failing<null>();
    if (f) return f;
    this.calls.push({ op: "untrash", threadId });
    return this.relabel(threadId, (l) => void l.delete("TRASH"));
  }

  /** The identity sender() reports. */
  identity = { email: "owner@example.com", name: "Owner Example" };

  async sender(): Promise<Result<{ email: string; name: string }>> {
    const f = this.failing<{ email: string; name: string }>();
    return f ?? ok(this.identity);
  }

  /** Messages handed to send(), for assertions. */
  sent: { raw: string; threadId: string | null }[] = [];

  async send(raw: string, threadId: string | null): Promise<Result<{ id: string; threadId: string }>> {
    const f = this.failing<{ id: string; threadId: string }>();
    if (f) return f;
    this.sent.push({ raw, threadId });
    return ok({ id: `sent-${this.sent.length}`, threadId: threadId ?? `thread-sent-${this.sent.length}` });
  }
}

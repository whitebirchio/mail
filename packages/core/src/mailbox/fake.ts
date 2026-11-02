import { headerValue } from "../message/headers";
import { type Label, type Mailbox, type MailboxError, type Result, type ThreadMeta, type ThreadPage, type ThreadQuery, fail, ok } from "./port";

/**
 * An in-memory Mailbox for tests. Threads are listed newest first; `q`
 * matches subject or snippet as a plain substring (not Gmail's syntax).
 * Set `failNext` to make the next call return that error.
 */
export class FakeMailbox implements Mailbox {
  failNext: MailboxError | null = null;

  constructor(
    public threads: ThreadMeta[] = [],
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
}

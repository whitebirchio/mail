/**
 * Synthetic Gmail API shapes for tests. Every name, address and subject here
 * is invented: no real mail ever enters the repo (SPEC.md, Boundaries).
 */
import type { MessageMeta, ThreadMeta } from "../../src/mailbox/port";

export const OWNER = "owner@example.com";

let seq = 0;
export function meta(over: Partial<MessageMeta> & { from?: string; to?: string; subject?: string } = {}): MessageMeta {
  const { from = "Ann Example <ann@example.org>", to = OWNER, subject = "Lunch on Friday", ...rest } = over;
  seq++;
  return {
    id: `m${seq}`,
    threadId: "t1",
    labelIds: ["INBOX"],
    internalDate: 1_790_000_000_000 + seq * 60_000,
    snippet: "Are we still on for noon?",
    headers: [
      { name: "From", value: from },
      { name: "To", value: to },
      { name: "Subject", value: subject },
    ],
    mimeType: "multipart/alternative",
    ...rest,
  };
}

export const thread = (id: string, messages: MessageMeta[]): ThreadMeta => ({ id, messages: messages.map((m) => ({ ...m, threadId: id })) });

/** The JSON Gmail returns for threads.get?format=metadata. */
export const threadJson = (t: ThreadMeta) => ({
  id: t.id,
  historyId: "1",
  messages: t.messages.map((m) => ({
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds,
    snippet: m.snippet,
    internalDate: String(m.internalDate),
    historyId: "1",
    sizeEstimate: 1000,
    payload: { partId: "", mimeType: m.mimeType, filename: "", headers: m.headers, body: { size: 0 } },
  })),
});

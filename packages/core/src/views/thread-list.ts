import { decodeEntities } from "../message/entities";
import { displayName, headerValue, parseAddresses } from "../message/headers";
import type { MessageMeta, ThreadMeta } from "../mailbox/port";

/** One row of a thread list (SPEC.md, story 2). */
export interface ThreadRow {
  id: string;
  /** Distinct senders (by address) in the order they first wrote; "me" for the owner. Drafts aren't senders. */
  senders: { name: string; unread: boolean }[];
  /** Who the latest message went to; Sent shows this instead of senders. */
  recipients: string[];
  count: number;
  subject: string;
  snippet: string;
  /** Epoch ms of the latest message. */
  date: number;
  unread: boolean;
  starred: boolean;
  /** Gmail's metadata has no part list, so this is a hint: a multipart/mixed message. */
  attachment: boolean;
  draft: boolean;
  labelIds: string[];
}

const has = (m: MessageMeta, label: string) => m.labelIds.includes(label);

export function threadRow(thread: ThreadMeta, ownerEmail: string): ThreadRow {
  const owner = ownerEmail.toLowerCase();
  const messages = [...thread.messages].sort((a, b) => a.internalDate - b.internalDate);
  const sent = messages.filter((m) => !has(m, "DRAFT"));
  const latest = sent.at(-1) ?? messages.at(-1);

  const byEmail = new Map<string, { name: string; unread: boolean; named: boolean }>();
  for (const m of sent) {
    const from = parseAddresses(headerValue(m.headers, "From"))[0];
    if (!from) continue;
    const email = from.email.toLowerCase();
    const seen = byEmail.get(email);
    if (seen) {
      seen.unread ||= has(m, "UNREAD");
      // A later message may carry the display name an earlier one lacked.
      if (!seen.named && from.name && email !== owner) Object.assign(seen, { name: from.name, named: true });
    } else byEmail.set(email, { name: email === owner ? "me" : displayName(from), unread: has(m, "UNREAD"), named: Boolean(from.name) });
  }
  const senders = [...byEmail.values()].map(({ name, unread }) => ({ name, unread }));

  const recipients = latest ? parseAddresses(headerValue(latest.headers, "To")).map((a) => (a.email.toLowerCase() === owner ? "me" : displayName(a))) : [];
  const subject = messages.map((m) => headerValue(m.headers, "Subject").trim()).find(Boolean) ?? "";
  const labelIds = [...new Set(messages.flatMap((m) => m.labelIds))];

  return {
    id: thread.id,
    senders,
    recipients,
    count: sent.length,
    subject,
    snippet: decodeEntities(latest?.snippet ?? ""),
    date: latest?.internalDate ?? 0,
    unread: messages.some((m) => has(m, "UNREAD")),
    starred: messages.some((m) => has(m, "STARRED")),
    attachment: messages.some((m) => m.mimeType.toLowerCase() === "multipart/mixed"),
    draft: messages.some((m) => has(m, "DRAFT")),
    labelIds,
  };
}

/**
 * How a row names its people, Gmail-style: up to three senders, eliding the
 * middle ("Ann … Bob, me"), or "To: …" in Sent.
 */
export function peopleLine(row: ThreadRow, inSent: boolean): string {
  if (inSent) return row.recipients.length > 0 ? `To: ${row.recipients.join(", ")}` : "(no recipients)";
  const names = row.senders.map((s) => s.name);
  if (names.length === 0) return row.draft ? "Draft" : "(unknown sender)";
  if (names.length <= 3) return names.join(", ");
  return `${names[0]} … ${names.slice(-2).join(", ")}`;
}

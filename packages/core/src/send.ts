import type { AttachmentData, Mailbox, MailboxError } from "./mailbox/port";
import { buildMime, parseRecipients } from "./message/compose";
import type { Address } from "./message/headers";

/** What the compose form posts. Threading fields come from composeDefaults via hidden inputs. */
export interface SendInput {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Attachments of the forwarded message to send along. */
  forward: { messageId: string; partId: string }[];
}

/** Gmail's limit for a sent message's attachments, before base64 growth. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type SendResult =
  | { ok: true; id: string; threadId: string }
  | { ok: false; error: "invalid-recipients"; field: "to" | "cc" | "bcc"; invalid: string[] }
  | { ok: false; error: "no-recipients" | "too-large" }
  | { ok: false; error: MailboxError };

const MESSAGE_ID = /^<[^<>\s]+>$/;

export async function sendMail(mailbox: Mailbox, input: SendInput, from: { email: string; name?: string }, now: Date): Promise<SendResult> {
  const lists: Record<"to" | "cc" | "bcc", Address[]> = { to: [], cc: [], bcc: [] };
  for (const field of ["to", "cc", "bcc"] as const) {
    const r = parseRecipients(input[field]);
    if (!r.ok) return { ok: false, error: "invalid-recipients", field, invalid: r.invalid };
    lists[field] = r.addresses;
  }
  const { to, cc, bcc } = lists;
  if (to.length + cc.length + bcc.length === 0) return { ok: false, error: "no-recipients" };

  const attachments: AttachmentData[] = [];
  let total = 0;
  for (const f of input.forward) {
    const a = await mailbox.getAttachment(f.messageId, f.partId);
    if (!a.ok) return { ok: false, error: a.error };
    total += a.value.bytes.length;
    if (total > MAX_ATTACHMENT_BYTES) return { ok: false, error: "too-large" };
    attachments.push(a.value);
  }

  const raw = buildMime({
    from: { name: from.name ?? "", email: from.email },
    to,
    cc,
    bcc,
    subject: input.subject,
    body: input.body,
    inReplyTo: input.inReplyTo && MESSAGE_ID.test(input.inReplyTo) ? input.inReplyTo : null,
    references: input.references.filter((r) => MESSAGE_ID.test(r)),
    attachments,
    date: now,
  });
  const sent = await mailbox.send(raw, input.threadId);
  return sent.ok ? { ok: true, ...sent.value } : { ok: false, error: sent.error };
}

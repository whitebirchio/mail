import type { FullMessage, FullThread } from "../mailbox/port";
import { type Address, displayName } from "../message/headers";
import { type AttachmentInfo, type ParsedMessage, parseMessage } from "../message/parse";
import { messageDocument, sanitizeEmailHtml, textToHtml } from "../message/sanitize";

/** One message in the thread view (SPEC.md, story 5). */
export interface MessageView {
  id: string;
  from: Address | null;
  /** "me" for the owner. */
  fromName: string;
  to: Address[];
  cc: Address[];
  subject: string;
  /** Epoch ms (Gmail's internalDate). */
  date: number;
  snippet: string;
  unread: boolean;
  starred: boolean;
  draft: boolean;
  /** Latest and unread messages start expanded; earlier read ones are a one-line row. */
  expanded: boolean;
  /** The sandboxed frame's srcdoc: sanitized HTML or converted text, with its own CSP. */
  document: string;
  blockedImages: number;
  imagesShown: boolean;
  /** Listed attachments: everything except inline images the body shows in place. */
  attachments: (AttachmentInfo & { url: string })[];
  parsed: ParsedMessage;
}

export interface ThreadView {
  id: string;
  subject: string;
  messages: MessageView[];
  labelIds: string[];
  unread: boolean;
}

export interface ThreadViewOptions {
  ownerEmail: string;
  /** Whether this message's remote images are allowed ("Show images"). */
  showImages: (messageId: string) => boolean;
  /** The same-origin URL that serves a part's bytes. */
  attachmentUrl: (messageId: string, partId: string) => string;
}

function messageView(m: FullMessage, o: ThreadViewOptions, expanded: boolean): MessageView {
  const parsed = parseMessage(m);
  const imagesShown = o.showImages(m.id);
  const byCid = new Map(parsed.attachments.filter((a) => a.contentId).map((a) => [a.contentId!, a.partId]));
  let body: string;
  let blockedImages = 0;
  if (parsed.html !== null) {
    const s = sanitizeEmailHtml(parsed.html, {
      allowRemoteImages: imagesShown,
      cidUrl: (cid) => {
        const partId = byCid.get(cid);
        return partId ? o.attachmentUrl(m.id, partId) : null;
      },
    });
    body = s.html;
    blockedImages = s.blockedImages;
  } else if (parsed.text !== null) body = textToHtml(parsed.text);
  else body = '<p style="color:#666"><em>(no content)</em></p>';

  const owner = o.ownerEmail.toLowerCase();
  const has = (l: string) => m.labelIds.includes(l);
  return {
    id: m.id,
    from: parsed.from,
    fromName: parsed.from ? (parsed.from.email.toLowerCase() === owner ? "me" : displayName(parsed.from)) : "(unknown sender)",
    to: parsed.to,
    cc: parsed.cc,
    subject: parsed.subject,
    date: m.internalDate,
    snippet: m.snippet,
    unread: has("UNREAD"),
    starred: has("STARRED"),
    draft: has("DRAFT"),
    expanded,
    document: messageDocument(body, imagesShown),
    blockedImages,
    imagesShown,
    attachments: parsed.attachments.filter((a) => !a.inline).map((a) => ({ ...a, url: o.attachmentUrl(m.id, a.partId) })),
    parsed,
  };
}

export function threadView(thread: FullThread, o: ThreadViewOptions): ThreadView {
  const messages = [...thread.messages].sort((a, b) => a.internalDate - b.internalDate);
  const latest = messages.filter((m) => !m.labelIds.includes("DRAFT")).at(-1) ?? messages.at(-1);
  const views = messages.map((m) => messageView(m, o, m === latest || m.labelIds.includes("UNREAD")));
  return {
    id: thread.id,
    subject: views.map((v) => v.subject.trim()).find(Boolean) ?? "",
    messages: views,
    labelIds: [...new Set(messages.flatMap((m) => m.labelIds))],
    unread: views.some((v) => v.unread),
  };
}

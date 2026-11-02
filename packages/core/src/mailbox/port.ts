/**
 * The Mailbox port (SPEC.md): everything the app needs from Gmail, as plain
 * data. GmailMailbox implements it against the REST API; FakeMailbox, in
 * memory, for tests. Expected failures are status unions, not throws.
 */

export type MailboxError = "auth" | "not-found" | "rate-limited" | "unavailable" | "invalid-response";
export type Result<T> = { ok: true; value: T } | { ok: false; error: MailboxError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(error: MailboxError): Result<T> => ({ ok: false, error });

/** Gmail's system labels that Mail shows or acts on. */
export const SYSTEM_LABELS = ["INBOX", "STARRED", "SENT", "DRAFT", "SPAM", "TRASH", "UNREAD", "IMPORTANT"] as const;
export type SystemLabel = (typeof SYSTEM_LABELS)[number];

export interface Label {
  id: string;
  name: string;
  type: "system" | "user";
  /** Only fetched for INBOX (the sidebar count); undefined elsewhere. */
  unreadThreads?: number;
}

export interface Header {
  name: string;
  value: string;
}

/** A message as listed: headers and flags, no body. */
export interface MessageMeta {
  id: string;
  threadId: string;
  labelIds: string[];
  /** Epoch ms when Gmail received it. */
  internalDate: number;
  snippet: string;
  headers: Header[];
  /** The top-level MIME type; multipart/mixed is the attachment hint in lists. */
  mimeType: string;
}

export interface ThreadMeta {
  id: string;
  messages: MessageMeta[];
}

export interface ThreadPage {
  threads: ThreadMeta[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
}

/** What to list: one label, a Gmail search, or both (a search within a label). */
export interface ThreadQuery {
  labelId?: string;
  q?: string;
  pageToken?: string;
  pageSize?: number;
}

/** One MIME part as Gmail returns it: bodies are already transfer-decoded, then base64url-encoded. */
export interface Part {
  partId: string;
  mimeType: string;
  filename: string;
  headers: Header[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: Part[];
}

export interface FullMessage extends MessageMeta {
  payload: Part;
}

export interface FullThread {
  id: string;
  messages: FullMessage[];
}

export interface AttachmentData {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface Mailbox {
  listLabels(): Promise<Result<Label[]>>;
  listThreads(query: ThreadQuery): Promise<Result<ThreadPage>>;
  getThread(threadId: string): Promise<Result<FullThread>>;
  /** A part's bytes, by the message and the part's partId (inline or stored as an attachment). */
  getAttachment(messageId: string, partId: string): Promise<Result<AttachmentData>>;
  /** Add and remove labels on every message in a thread. */
  modifyThread(threadId: string, change: LabelChange): Promise<Result<null>>;
  trashThread(threadId: string): Promise<Result<null>>;
  untrashThread(threadId: string): Promise<Result<null>>;
  /** The primary send-as identity: the address and display name Gmail sends as. */
  sender(): Promise<Result<{ email: string; name: string }>>;
  /** Send an RFC 5322 message; a threadId keeps a reply in its conversation. */
  send(raw: string, threadId: string | null): Promise<Result<{ id: string; threadId: string }>>;
}

export interface LabelChange {
  add: string[];
  remove: string[];
}

import { z } from "zod";
import type { TokenSource } from "../google/token";
import { mapLimit } from "../util/limit";
import { findPart } from "../message/parse";
import {
  type AttachmentData,
  type FullThread,
  type Label,
  type LabelChange,
  type Mailbox,
  type MailboxError,
  type Part,
  type Result,
  type ThreadMeta,
  type ThreadPage,
  type ThreadQuery,
  fail,
  ok,
} from "./port";

/**
 * The Gmail REST adapter (SPEC.md, Tech stack): plain fetch, every response
 * Zod-validated. A 401 gets one fresh token and one retry; a rate limit gets
 * one back-off and one retry. Errors come back as status unions, and nothing
 * about a request's content is logged.
 */

export const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
/** threads.get costs 10 quota units against ~250/s per user; 10 in flight keeps a 25-thread page inside a burst. */
export const LIST_CONCURRENCY = 10;
export const PAGE_SIZE = 25;
const LIST_HEADERS = ["From", "To", "Cc", "Subject", "Date"];

const header = z.object({ name: z.string(), value: z.string() });
const labelSchema = z.object({ id: z.string(), name: z.string(), type: z.enum(["system", "user"]).optional() });
const labelsSchema = z.object({ labels: z.array(labelSchema).default([]) });
const labelDetail = z.object({ id: z.string(), threadsUnread: z.number().int().nonnegative().default(0) });
const threadListSchema = z.object({
  threads: z.array(z.object({ id: z.string() })).default([]),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().int().default(0),
});
const messageMetaSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  snippet: z.string().default(""),
  internalDate: z.string().regex(/^\d+$/),
  payload: z.object({ mimeType: z.string().default(""), headers: z.array(header).default([]) }).default({ mimeType: "", headers: [] }),
});
const threadMetaSchema = z.object({ id: z.string(), messages: z.array(messageMetaSchema).default([]) });
const partSchema: z.ZodType<Part> = z.lazy(() =>
  z.object({
    partId: z.string().default(""),
    mimeType: z.string().default(""),
    filename: z.string().default(""),
    headers: z.array(header).default([]),
    body: z.object({ size: z.number().int().nonnegative().default(0), data: z.string().optional(), attachmentId: z.string().optional() }).default({ size: 0 }),
    parts: z.array(partSchema).optional(),
  }),
) as z.ZodType<Part>;
const fullMessageSchema = messageMetaSchema.extend({ payload: partSchema });
const fullThreadSchema = z.object({ id: z.string(), messages: z.array(fullMessageSchema).default([]) });
const attachmentSchema = z.object({ size: z.number().int().optional(), data: z.string() });

export interface GmailOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called once per Gmail call with its outcome; for latency and error logs. No content. */
  observe?: (event: { endpoint: string; status: number | "network"; ms: number }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class GmailMailbox implements Mailbox {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly observe: NonNullable<GmailOptions["observe"]>;

  constructor(
    private readonly tokens: TokenSource,
    options: GmailOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.observe = options.observe ?? (() => {});
  }

  async listLabels(): Promise<Result<Label[]>> {
    const [all, inbox] = await Promise.all([this.json("labels.list", "/labels", labelsSchema), this.json("labels.get", "/labels/INBOX", labelDetail)]);
    if (!all.ok) return all;
    if (!inbox.ok) return inbox;
    return ok(
      all.value.labels.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type ?? (l.id === l.id.toUpperCase() ? "system" : "user"),
        ...(l.id === "INBOX" ? { unreadThreads: inbox.value.threadsUnread } : {}),
      })),
    );
  }

  async listThreads(query: ThreadQuery): Promise<Result<ThreadPage>> {
    const params = new URLSearchParams({ maxResults: String(query.pageSize ?? PAGE_SIZE) });
    if (query.labelId) params.set("labelIds", query.labelId);
    if (query.q) params.set("q", query.q);
    if (query.pageToken) params.set("pageToken", query.pageToken);
    const list = await this.json("threads.list", `/threads?${params}`, threadListSchema);
    if (!list.ok) return list;

    const metaParams = new URLSearchParams({ format: "metadata" });
    for (const h of LIST_HEADERS) metaParams.append("metadataHeaders", h);
    const fetched = await mapLimit(list.value.threads, LIST_CONCURRENCY, (t) => this.json("threads.get", `/threads/${encodeURIComponent(t.id)}?${metaParams}`, threadMetaSchema));
    const threads: ThreadMeta[] = [];
    for (const r of fetched) {
      // A thread deleted between list and get is just gone; anything else fails the page.
      if (!r.ok && r.error === "not-found") continue;
      if (!r.ok) return r;
      threads.push({
        id: r.value.id,
        messages: r.value.messages.map((m) => ({
          id: m.id,
          threadId: m.threadId,
          labelIds: m.labelIds,
          internalDate: Number(m.internalDate),
          snippet: m.snippet,
          headers: m.payload.headers,
          mimeType: m.payload.mimeType,
        })),
      });
    }
    return ok({ threads, nextPageToken: list.value.nextPageToken ?? null, resultSizeEstimate: list.value.resultSizeEstimate });
  }

  async getThread(threadId: string): Promise<Result<FullThread>> {
    const r = await this.json("threads.get", `/threads/${encodeURIComponent(threadId)}?format=full`, fullThreadSchema);
    if (!r.ok) return r;
    return ok({
      id: r.value.id,
      messages: r.value.messages.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        labelIds: m.labelIds,
        internalDate: Number(m.internalDate),
        snippet: m.snippet,
        headers: m.payload.headers,
        mimeType: m.payload.mimeType,
        payload: m.payload,
      })),
    });
  }

  async getAttachment(messageId: string, partId: string): Promise<Result<AttachmentData>> {
    const msg = await this.json("messages.get", `/messages/${encodeURIComponent(messageId)}?format=full`, fullMessageSchema);
    if (!msg.ok) return msg;
    const part = findPart(msg.value.payload, partId);
    if (!part || part.mimeType.toLowerCase().startsWith("multipart/")) return fail("not-found");
    let data = part.body.data;
    if (part.body.attachmentId) {
      const att = await this.json("attachments.get", `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, attachmentSchema);
      if (!att.ok) return att;
      data = att.value.data;
    }
    return ok({ filename: part.filename, mimeType: part.mimeType || "application/octet-stream", bytes: new Uint8Array(Buffer.from(data ?? "", "base64url")) });
  }

  async modifyThread(threadId: string, change: LabelChange): Promise<Result<null>> {
    const r = await this.post("threads.modify", `/threads/${encodeURIComponent(threadId)}/modify`, { addLabelIds: change.add, removeLabelIds: change.remove });
    return r.ok ? ok(null) : r;
  }

  async trashThread(threadId: string): Promise<Result<null>> {
    const r = await this.post("threads.trash", `/threads/${encodeURIComponent(threadId)}/trash`);
    return r.ok ? ok(null) : r;
  }

  async untrashThread(threadId: string): Promise<Result<null>> {
    const r = await this.post("threads.untrash", `/threads/${encodeURIComponent(threadId)}/untrash`);
    return r.ok ? ok(null) : r;
  }

  private post(endpoint: string, path: string, body?: unknown): Promise<Result<Response>> {
    return this.send(endpoint, path, { method: "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  }

  /** One Gmail call: auth, retries, status mapping and validation. */
  protected async json<S extends z.ZodType>(endpoint: string, path: string, schema: S, init: RequestInit = {}): Promise<Result<z.output<S>>> {
    const res = await this.send(endpoint, path, init);
    if (!res.ok) return res;
    const parsed = schema.safeParse(await res.value.json().catch(() => undefined));
    return parsed.success ? ok(parsed.data) : fail("invalid-response");
  }

  protected async send(endpoint: string, path: string, init: RequestInit, url = `${GMAIL}${path}`): Promise<Result<Response>> {
    let refreshed = false;
    let backedOff = false;
    for (;;) {
      const token = await this.tokens.get(refreshed);
      if (!token.ok) return fail(token.error === "revoked" ? "auth" : "unavailable");
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token.accessToken}` } });
      } catch {
        this.observe({ endpoint, status: "network", ms: Date.now() - started });
        return fail("unavailable");
      }
      this.observe({ endpoint, status: res.status, ms: Date.now() - started });
      if (res.ok) return ok(res);
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if ((res.status === 429 || (res.status === 403 && (await isRateLimit(res.clone())))) && !backedOff) {
        backedOff = true;
        await this.sleep(1000);
        continue;
      }
      return fail(statusError(res.status, backedOff));
    }
  }
}

async function isRateLimit(res: Response): Promise<boolean> {
  const body = (await res.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
  return (body?.error?.errors ?? []).some((e) => e.reason === "rateLimitExceeded" || e.reason === "userRateLimitExceeded");
}

function statusError(status: number, rateLimited: boolean): MailboxError {
  if (status === 401) return "auth";
  if (status === 404) return "not-found";
  if (status === 429 || (status === 403 && rateLimited)) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "invalid-response";
}

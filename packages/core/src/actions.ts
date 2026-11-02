import type { Mailbox, MailboxError, Result } from "./mailbox/port";
import { mapLimit } from "./util/limit";

/** The triage verbs (SPEC.md, story 6). Each has an exact inverse, which is what Undo sends. */
export const TRIAGE = ["archive", "inbox", "read", "unread", "star", "unstar", "trash", "untrash", "spam", "notSpam"] as const;
export type Triage = (typeof TRIAGE)[number];

export const isTriage = (v: unknown): v is Triage => typeof v === "string" && (TRIAGE as readonly string[]).includes(v);

const LABEL_CHANGES: Record<Exclude<Triage, "trash" | "untrash">, { add: string[]; remove: string[] }> = {
  archive: { add: [], remove: ["INBOX"] },
  inbox: { add: ["INBOX"], remove: [] },
  read: { add: [], remove: ["UNREAD"] },
  unread: { add: ["UNREAD"], remove: [] },
  star: { add: ["STARRED"], remove: [] },
  unstar: { add: [], remove: ["STARRED"] },
  spam: { add: ["SPAM"], remove: ["INBOX"] },
  notSpam: { add: ["INBOX"], remove: ["SPAM"] },
};

const INVERSES: Record<Triage, Triage> = {
  archive: "inbox",
  inbox: "archive",
  read: "unread",
  unread: "read",
  star: "unstar",
  unstar: "star",
  trash: "untrash",
  untrash: "trash",
  spam: "notSpam",
  notSpam: "spam",
};

/** What Undo sends to reverse `verb`. Trash goes through Gmail's own trash/untrash endpoints, not a label edit. */
export const inverse = (verb: Triage): Triage => INVERSES[verb];

/** Verbs whose result takes the thread out of the current view, so they get an Undo toast and move you on. */
export const REMOVES_FROM_VIEW: ReadonlySet<Triage> = new Set(["archive", "trash", "spam", "notSpam", "untrash"]);

export interface Undo {
  threadIds: string[];
  verb: Triage;
}

export type TriageResult = { ok: true; undo: Undo } | { ok: false; error: MailboxError | "nothing-selected"; /** Covers the threads that did change. */ undo: Undo | null };

/** At most this many threads change at once in a bulk action (threads.modify is 10 quota units). */
export const TRIAGE_CONCURRENCY = 10;

function apply(mailbox: Mailbox, threadId: string, verb: Triage): Promise<Result<null>> {
  if (verb === "trash") return mailbox.trashThread(threadId);
  if (verb === "untrash") return mailbox.untrashThread(threadId);
  return mailbox.modifyThread(threadId, LABEL_CHANGES[verb]);
}

export async function triage(mailbox: Mailbox, threadIds: readonly string[], verb: Triage): Promise<TriageResult> {
  const ids = [...new Set(threadIds)];
  if (ids.length === 0) return { ok: false, error: "nothing-selected", undo: null };
  const results = await mapLimit(ids, TRIAGE_CONCURRENCY, (id) => apply(mailbox, id, verb));
  const done = ids.filter((_, i) => results[i]!.ok);
  const firstError = results.find((r) => !r.ok);
  const undo = done.length > 0 ? { threadIds: done, verb: inverse(verb) } : null;
  if (firstError && !firstError.ok) return { ok: false, error: firstError.error, undo };
  return { ok: true, undo: undo! };
}

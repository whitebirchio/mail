"use client";

import type { Triage, TriageResult } from "@mail/core";
import { triageAction } from "@/app/(signed-in)/actions";
import type { Toast } from "./toast";

const DONE: Partial<Record<Triage, string>> = {
  archive: "archived",
  inbox: "moved to Inbox",
  trash: "moved to Trash",
  untrash: "restored",
  spam: "marked as spam",
  notSpam: "moved to Inbox",
  read: "marked as read",
  unread: "marked as unread",
};

const ERRORS: Record<string, string> = {
  "rate-limited": "Gmail is busy. Try again in a few seconds.",
  unavailable: "Couldn't reach Gmail. Try again.",
  "not-found": "That conversation no longer exists.",
  auth: "Your sign-in expired. Reload to sign in again.",
};

const noun = (n: number) => (n === 1 ? "Conversation" : `${n} conversations`);

/** Run a triage verb and toast the outcome, with Undo where the verb has one worth offering. */
export async function runTriage(ids: string[], verb: Triage, toast: (t: Toast) => void, opts: { undoable?: boolean } = {}): Promise<TriageResult> {
  const result = await triageAction(ids, verb);
  if (!result.ok) {
    toast({ tone: "error", message: ERRORS[result.error] ?? "Something went wrong. Try again." });
    return result;
  }
  const message = DONE[verb];
  if (message) {
    const undo = result.undo;
    toast({
      message: `${noun(ids.length)} ${message}.`,
      action: opts.undoable
        ? {
            label: "Undo",
            run: async () => {
              const r = await triageAction(undo.threadIds, undo.verb);
              toast(r.ok ? { message: "Action undone." } : { tone: "error", message: "Couldn't undo. Try again." });
            },
          }
        : undefined,
    });
  }
  return result;
}

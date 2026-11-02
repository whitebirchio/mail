"use client";

import type { Triage } from "@mail/core";
import { AlertOctagon, Archive, ArrowLeft, Inbox, Mail, RotateCcw, ShieldCheck, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { IconButton, threadHref } from "./thread-list";
import { useToast } from "./toast";
import { runTriage } from "./triage";

/** Thread actions (SPEC.md, story 6). Archive, delete and spam move on to the next conversation, or back to the list. */
export function ThreadToolbar({ threadId, labelIds, back, after }: { threadId: string; labelIds: string[]; back: string; after: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const has = (l: string) => labelIds.includes(l);
  const onward = () => (after.length > 0 ? threadHref(after[0]!, back, after.slice(1)) : back);

  const act = (verb: Triage, leave: "next" | "back" | "stay", undoable = leave !== "stay") =>
    start(async () => {
      const r = await runTriage([threadId], verb, toast, { undoable });
      if (!r.ok) return;
      if (leave === "next") router.push(onward());
      else if (leave === "back") router.push(back);
    });

  return (
    <div role="toolbar" aria-label="Conversation actions" className="sticky top-14 z-20 flex h-12 items-center gap-1 border-b border-[var(--border)] bg-[var(--background)] px-2" aria-busy={pending}>
      <Link href={back} aria-label="Back to list" title="Back to list" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]">
        <ArrowLeft className="size-4" />
      </Link>
      <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
      {has("TRASH") ? (
        <IconButton label="Restore" disabled={pending} onClick={() => act("untrash", "next")}>
          <RotateCcw className="size-4" />
        </IconButton>
      ) : (
        <>
          {has("INBOX") ? (
            <IconButton label="Archive" disabled={pending} onClick={() => act("archive", "next")}>
              <Archive className="size-4" />
            </IconButton>
          ) : (
            !has("SPAM") && (
              <IconButton label="Move to Inbox" disabled={pending} onClick={() => act("inbox", "stay", false)}>
                <Inbox className="size-4" />
              </IconButton>
            )
          )}
          {has("SPAM") ? (
            <IconButton label="Not spam" disabled={pending} onClick={() => act("notSpam", "next")}>
              <ShieldCheck className="size-4" />
            </IconButton>
          ) : (
            <IconButton label="Report spam" disabled={pending} onClick={() => act("spam", "next")}>
              <AlertOctagon className="size-4" />
            </IconButton>
          )}
          <IconButton label="Delete" disabled={pending} onClick={() => act("trash", "next")}>
            <Trash2 className="size-4" />
          </IconButton>
        </>
      )}
      <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
      <IconButton label="Mark as unread" disabled={pending} onClick={() => act("unread", "back", false)}>
        <Mail className="size-4" />
      </IconButton>
      <button
        type="button"
        aria-pressed={has("STARRED")}
        aria-label={has("STARRED") ? "Unstar" : "Star"}
        title={has("STARRED") ? "Unstar" : "Star"}
        disabled={pending}
        onClick={() => act(has("STARRED") ? "unstar" : "star", "stay", false)}
        className="rounded-full p-2 hover:bg-[var(--surface)] disabled:opacity-50"
      >
        <Star className={`size-4 ${has("STARRED") ? "fill-[var(--star)] text-[var(--star)]" : "text-[var(--muted)]"}`} />
      </button>
    </div>
  );
}

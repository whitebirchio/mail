"use client";

import { Paperclip, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { type SendState, sendAction } from "@/app/(signed-in)/compose/actions";
import { useToast } from "./toast";

export interface ComposeFormProps {
  heading: string;
  back: string;
  initial: { to: string; cc: string; bcc: string; subject: string; body: string };
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  forwardAttachments: { value: string; filename: string; size: string }[];
  /** Where the cursor starts: replies at the top of the body, new mail in To. */
  focus: "to" | "body";
}

export function ComposeForm(p: ComposeFormProps) {
  const [state, action, pending] = useActionState<SendState, FormData>(sendAction, { status: "idle" });
  const [dirty, setDirty] = useState(false);
  const [showCc, setShowCc] = useState(Boolean(p.initial.cc || p.initial.bcc));
  const router = useRouter();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const to = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (p.focus === "body" && body.current) {
      body.current.focus();
      body.current.setSelectionRange(0, 0);
      body.current.scrollTop = 0;
    } else to.current?.focus();
  }, [p.focus]);

  useEffect(() => {
    if (state.status !== "sent") return;
    setDirty(false);
    toast({ message: "Message sent." });
    router.push(p.back);
  }, [state, router, toast, p.back]);

  // Leaving with unsent text asks first (SPEC.md, story 7).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const discard = () => {
    if (dirty && !window.confirm("Discard this message?")) return;
    setDirty(false);
    router.push(p.back);
  };

  const field = "w-full bg-transparent py-2 text-sm outline-none";
  const row = (name: "to" | "cc" | "bcc", label: string, extra?: React.ReactNode) => (
    <div className={`flex items-center gap-3 border-b px-4 ${state.status === "error" && state.field === name ? "border-[var(--bad)]" : "border-[var(--border)]"}`}>
      <label htmlFor={`compose-${name}`} className="w-8 shrink-0 text-sm text-[var(--muted)]">
        {label}
      </label>
      <input
        ref={name === "to" ? to : undefined}
        id={`compose-${name}`}
        name={name}
        type="text"
        inputMode="email"
        autoComplete="off"
        defaultValue={p.initial[name]}
        className={field}
        aria-invalid={state.status === "error" && state.field === name}
      />
      {extra}
    </div>
  );

  return (
    <form
      ref={form}
      action={action}
      onChange={() => setDirty(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          form.current?.requestSubmit();
        }
      }}
      className="mx-auto flex max-w-3xl flex-col p-2 md:p-4"
    >
      <div className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--raised)]">
        <div className="flex items-center justify-between bg-[var(--surface)] px-4 py-2">
          <h1 className="text-sm font-semibold">{p.heading}</h1>
          <button type="button" onClick={discard} aria-label="Discard" title="Discard" className="rounded-full p-1 text-[var(--muted)] hover:text-[var(--text)]">
            <X className="size-4" />
          </button>
        </div>
        {row(
          "to",
          "To",
          !showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="shrink-0 text-sm text-[var(--muted)] hover:text-[var(--text)]">
              Cc/Bcc
            </button>
          ),
        )}
        {showCc ? (
          <>
            {row("cc", "Cc")}
            {row("bcc", "Bcc")}
          </>
        ) : (
          <>
            <input type="hidden" name="cc" value="" />
            <input type="hidden" name="bcc" value="" />
          </>
        )}
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
          <label htmlFor="compose-subject" className="sr-only">
            Subject
          </label>
          <input id="compose-subject" name="subject" type="text" placeholder="Subject" defaultValue={p.initial.subject} className={field} />
        </div>
        <label htmlFor="compose-body" className="sr-only">
          Message
        </label>
        <textarea ref={body} id="compose-body" name="body" defaultValue={p.initial.body} rows={16} className="min-h-72 w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed outline-none" />

        {p.forwardAttachments.length > 0 && (
          <fieldset className="border-t border-[var(--border)] px-4 py-3">
            <legend className="sr-only">Attachments to forward</legend>
            <div className="flex flex-wrap gap-2">
              {p.forwardAttachments.map((a) => (
                <label key={a.value} className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs">
                  <input type="checkbox" name="forward" value={a.value} defaultChecked className="accent-[var(--accent)]" />
                  <Paperclip className="size-3.5" aria-hidden />
                  <span className="max-w-60 truncate">{a.filename}</span>
                  <span className="text-[var(--muted)]">{a.size}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <input type="hidden" name="threadId" value={p.threadId ?? ""} />
        <input type="hidden" name="inReplyTo" value={p.inReplyTo ?? ""} />
        <input type="hidden" name="references" value={JSON.stringify(p.references)} />

        <div className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-3">
          <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
            <Send className="size-4" aria-hidden />
            {pending ? "Sending…" : "Send"}
          </button>
          <span className="hidden text-xs text-[var(--muted)] sm:inline">⌘/Ctrl + Enter</span>
          {state.status === "error" && (
            <p role="alert" className="ml-auto text-sm text-[var(--bad)]">
              {state.message}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}

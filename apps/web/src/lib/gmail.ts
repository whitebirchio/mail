import { GmailMailbox, type Mailbox, type MailboxError, tokenSource } from "@mail/core";
import { redirect } from "next/navigation";
import type { AppConfig } from "./config";
import type { Session } from "./session";

/** Gmail calls slower than this are logged (endpoint, status and time only). */
const SLOW_MS = 1500;

/** The signed-in owner's mailbox for this request. */
export async function mailboxFor(config: AppConfig, session: Session): Promise<Mailbox> {
  if (config.devFake) return (await import("./dev-mailbox")).devMailbox();
  const tokens = tokenSource({ clientId: config.googleClientId, clientSecret: config.googleClientSecret }, session.refreshToken);
  return new GmailMailbox(tokens, {
    observe: ({ endpoint, status, ms }) => {
      if (status === "network" || status >= 400 || ms > SLOW_MS) console.log(JSON.stringify({ level: status === 200 ? "info" : "warn", message: "gmail", endpoint, status, ms }));
    },
  });
}

/** For pages: a dead grant means signing in again; anything else renders as an error panel. */
export function onMailboxError(error: MailboxError): MailboxError {
  if (error === "auth") redirect("/auth/expired");
  return error;
}

export const ERROR_TEXT: Record<MailboxError | "nothing-selected", string> = {
  auth: "Your Google sign-in has expired. Sign in again.",
  "not-found": "That conversation no longer exists. It may have been deleted.",
  "rate-limited": "Gmail is asking Mail to slow down. Try again in a few seconds.",
  unavailable: "Gmail didn't answer. Check your connection and try again.",
  "invalid-response": "Gmail sent something unexpected. Try again.",
  "nothing-selected": "Select at least one conversation first.",
};

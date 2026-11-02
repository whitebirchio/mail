"use server";

import { type Triage, type TriageResult, isTriage, triage } from "@mail/core";
import { revalidatePath } from "next/cache";
import { signedIn } from "@/lib/auth";
import { mailboxFor } from "@/lib/gmail";
import { assertOrigin } from "@/lib/origin";

const MAX_THREADS = 100;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Triage from a list or a thread (SPEC.md, story 6). Returns the Undo to offer. */
export async function triageAction(threadIds: string[], verb: Triage): Promise<TriageResult> {
  const { config, session } = await signedIn();
  await assertOrigin(config);
  if (!isTriage(verb) || !Array.isArray(threadIds) || threadIds.length > MAX_THREADS || !threadIds.every((id) => typeof id === "string" && ID.test(id))) {
    throw new Error("bad triage request");
  }
  const result = await triage(await mailboxFor(config, session), threadIds, verb);
  if (!result.ok) console.log(JSON.stringify({ level: "warn", message: "triage failed", verb, count: threadIds.length, error: result.error }));
  revalidatePath("/", "layout");
  return result;
}

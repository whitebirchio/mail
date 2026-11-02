import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type AppConfig, loadConfig } from "./config";
import { SESSION_COOKIE, type Session, openSession } from "./session";

/** For every signed-in page and action: the config and the owner's session, or a redirect to sign in. The proxy checks first; this checks again. */
export async function signedIn(): Promise<{ config: AppConfig; session: Session }> {
  const loaded = await loadConfig();
  if (!loaded.ok) throw new Error(`mail misconfigured: ${loaded.problems.join(", ")}`);
  const session = await openSession((await cookies()).get(SESSION_COOKIE)?.value, loaded.config.sessionKey, Math.floor(Date.now() / 1000));
  if (!session || session.email !== loaded.config.ownerEmail) redirect("/login");
  return { config: loaded.config, session };
}

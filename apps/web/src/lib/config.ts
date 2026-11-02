import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { z } from "zod";

/**
 * Mail's configuration (SPEC.md). Plain settings come from the Web Function's
 * environment; the two secrets come from SSM by exact name (the role can read
 * nothing else), or from the environment in local dev. Fails closed: invalid
 * config yields the names that are wrong, never their values.
 */
export interface AppConfig {
  /** Public origin, e.g. https://mail.whitebirch.io. The app's own Host is the Web Function's, so every absolute URL is built from this. */
  appUrl: string;
  ownerEmail: string;
  googleClientId: string;
  googleClientSecret: string;
  /** 32 random bytes; the session and OAuth-cookie keys are derived from it. */
  sessionKey: Uint8Array;
  /**
   * Local UI work only: skip sign-in and use an in-memory mailbox of invented
   * mail. Only under `next dev` (NODE_ENV=development) with MAIL_DEV_FAKE=1;
   * production builds inline NODE_ENV, so this is dead code there.
   */
  devFake: boolean;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] };

export const SECRET_NAMES = ["GOOGLE_CLIENT_SECRET", "SESSION_KEY"] as const;
const TTL_MS = 15 * 60_000;
let cache: { at: number; values: Record<string, string> } | null = null;
let ssm: SSMClient | null = null;

async function loadSecrets(env: NodeJS.ProcessEnv, now: number): Promise<Record<string, string | undefined>> {
  const path = env.SECRETS_PATH;
  if (!path) return Object.fromEntries(SECRET_NAMES.map((n) => [n, env[n]])); // local dev: from the environment
  if (cache && now - cache.at < TTL_MS) return cache.values;
  ssm ??= new SSMClient({});
  const out = await ssm.send(new GetParametersCommand({ Names: SECRET_NAMES.map((n) => `${path}${n}`), WithDecryption: true }));
  const values: Record<string, string> = {};
  for (const p of out.Parameters ?? []) if (p.Name && p.Value) values[p.Name.slice(path.length)] = p.Value;
  cache = { at: now, values };
  return values;
}

const key32 = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .transform((v) => new Uint8Array(Buffer.from(v, "base64url")));

const fields = {
  APP_URL: z.string().regex(/^(https:\/\/[a-z0-9.-]+|http:\/\/localhost(:\d+)?)$/),
  OWNER_EMAIL: z
    .string()
    .regex(/^[^@\s]+@[^@\s]+$/)
    .transform((v) => v.toLowerCase()),
  GOOGLE_CLIENT_ID: z.string().endsWith(".apps.googleusercontent.com"),
  GOOGLE_CLIENT_SECRET: z.string().min(20),
  SESSION_KEY: key32,
} as const;

/** Validate settings and secrets. Exported for tests with an explicit environment and secrets. */
export function parseConfig(env: NodeJS.ProcessEnv, secrets: Record<string, string | undefined>): ConfigResult {
  const input = { ...env, ...secrets };
  const problems: string[] = [];
  const values: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(fields)) {
    const r = schema.safeParse(input[name]);
    if (r.success) values[name] = r.data;
    else problems.push(name);
  }
  if (problems.length > 0) return { ok: false, problems };
  const v = values as { [K in keyof typeof fields]: z.output<(typeof fields)[K]> };
  return {
    ok: true,
    config: {
      appUrl: v.APP_URL,
      ownerEmail: v.OWNER_EMAIL,
      googleClientId: v.GOOGLE_CLIENT_ID,
      googleClientSecret: v.GOOGLE_CLIENT_SECRET,
      sessionKey: v.SESSION_KEY,
      devFake: env.NODE_ENV === "development" && env.MAIL_DEV_FAKE === "1",
    },
  };
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<ConfigResult> {
  return parseConfig(env, await loadSecrets(env, now));
}

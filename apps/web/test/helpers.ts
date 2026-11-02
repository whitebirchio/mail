import { type AppConfig, parseConfig } from "@/lib/config";

export const KEY_B64 = Buffer.alloc(32, 7).toString("base64url");
export const OTHER_KEY_B64 = Buffer.alloc(32, 9).toString("base64url");

export const ENV = {
  APP_URL: "https://mail.example.com",
  OWNER_EMAIL: "Owner@Example.com",
  GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
} as unknown as NodeJS.ProcessEnv;

export const SECRETS = {
  GOOGLE_CLIENT_SECRET: "GOCSPX-test-secret-secret-secret",
  SESSION_KEY: KEY_B64,
};

export function testConfig(): AppConfig {
  const r = parseConfig(ENV, SECRETS);
  if (!r.ok) throw new Error(r.problems.join());
  return r.config;
}

export const NOW = 1_800_000_000;

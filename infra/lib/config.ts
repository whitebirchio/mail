/**
 * Values shared by the stacks. None are secrets: those live in SSM under
 * SECRETS_PATH, written by scripts/set-secrets.sh (SPEC.md).
 */
export const REGION = "us-east-1";
export const DOMAIN = "mail.whitebirch.io";
export const APP_URL = `https://${DOMAIN}`;
export const OWNER_EMAIL = "scott.schmalz@gmail.com";
export const SECRETS_PATH = "/mail/production/";
/** Secrets the Web Function may read, by exact name. */
export const SECRET_NAMES = ["GOOGLE_CLIENT_SECRET", "SESSION_KEY"] as const;
/** The Google OAuth client (project whitebirch-mail; a public identifier, its secret is in SSM). */
export const GOOGLE_CLIENT_ID = "pending.apps.googleusercontent.com";
/** CDK's default bootstrap qualifier; the CI role may only assume these roles. */
export const CDK_QUALIFIER = "hnb659fds";

/**
 * GitHub's immutable OIDC subject embeds the org and repo IDs
 * (gh api repos/whitebirchio/mail/actions/oidc/customization/sub), so a
 * renamed or re-created "mail" repo can't inherit deploy rights. null until
 * the repo exists; MailCi isn't synthesized without it.
 */
export const GITHUB_OIDC_SUBJECT_PREFIX: string | null = null;

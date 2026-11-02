/**
 * The session and the OAuth round trip, both stateless cookies (SPEC.md,
 * Security model 2).
 *
 * - The session carries the Google refresh token, so it's encrypted, not just
 *   signed: AES-256-GCM, base64url(iv ‖ ciphertext+tag).
 * - The OAuth cookie (state, nonce, PKCE verifier) only needs integrity, so it
 *   keeps Trader's scheme: base64url(JSON) "." base64url(HMAC-SHA256).
 *
 * Each gets its own key, derived from SESSION_KEY with HKDF, so neither can be
 * replayed as the other. Rotating SESSION_KEY signs everyone out.
 */

export const SESSION_COOKIE = "__Host-mail_session";
export const OAUTH_COOKIE = "__Host-mail_oauth";
export const SESSION_TTL_S = 30 * 24 * 60 * 60;
export const OAUTH_TTL_S = 10 * 60;
/** A session older than this is re-issued with a fresh expiry, so it only lapses after 30 idle days. */
export const RENEW_AFTER_S = 24 * 60 * 60;

export interface Session {
  email: string;
  refreshToken: string;
  /** When this cookie was issued; drives the sliding renewal. */
  iat: number;
  exp: number;
}

export interface OAuthPending {
  state: string;
  nonce: string;
  verifier: string;
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64url = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const AAD = enc.encode("mail-session-v1");

async function derive(master: Uint8Array, info: string, algorithm: AesKeyGenParams | HmacKeyGenParams, usages: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", master as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) }, base, algorithm, false, usages);
}

const sessionKey = (master: Uint8Array) => derive(master, "mail/session/aes-256-gcm", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]);
const oauthKey = (master: Uint8Array) => derive(master, "mail/oauth/hmac-sha256", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign", "verify"]);

export async function sealSession(session: Session, master: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await sessionKey(master), enc.encode(JSON.stringify(session)));
  const out = new Uint8Array(iv.length + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), iv.length);
  return b64url(out);
}

/** The session, or null if the cookie is missing, tampered with, sealed under another key, malformed or expired. */
export async function openSession(token: string | undefined, master: Uint8Array, nowS: number): Promise<Session | null> {
  if (!token) return null;
  const bytes = unb64url(token);
  if (bytes.length < 12 + 16) return null;
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: AAD }, await sessionKey(master), bytes.slice(12));
  } catch {
    return null;
  }
  let s: Partial<Session>;
  try {
    s = JSON.parse(dec.decode(plain)) as Partial<Session>;
  } catch {
    return null;
  }
  if (typeof s.email !== "string" || typeof s.refreshToken !== "string" || typeof s.iat !== "number" || typeof s.exp !== "number") return null;
  if (s.exp <= nowS) return null;
  return s as Session;
}

export const newSession = (email: string, refreshToken: string, nowS: number): Session => ({ email, refreshToken, iat: nowS, exp: nowS + SESSION_TTL_S });

/** The re-issued session if this one is due for renewal, else null. */
export const renewal = (s: Session, nowS: number): Session | null => (nowS - s.iat > RENEW_AFTER_S ? newSession(s.email, s.refreshToken, nowS) : null);

export async function signOAuth(pending: OAuthPending, master: Uint8Array): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(pending)));
  const mac = await crypto.subtle.sign("HMAC", await oauthKey(master), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(mac))}`;
}

export async function verifyOAuth(token: string | undefined, master: Uint8Array, nowS: number): Promise<OAuthPending | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const ok = await crypto.subtle.verify("HMAC", await oauthKey(master), unb64url(token.slice(dot + 1)) as BufferSource, enc.encode(body));
  if (!ok) return null;
  let p: Partial<OAuthPending>;
  try {
    p = JSON.parse(dec.decode(unb64url(body))) as Partial<OAuthPending>;
  } catch {
    return null;
  }
  if (typeof p.state !== "string" || typeof p.nonce !== "string" || typeof p.verifier !== "string" || typeof p.exp !== "number" || p.exp <= nowS) return null;
  return p as OAuthPending;
}

export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

export async function s256(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

/** Cookie attributes: __Host- requires Secure, Path=/ and no Domain. Lax so Google's redirect back carries the OAuth cookie. */
export const cookieOptions = (maxAge: number) => ({ httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge });

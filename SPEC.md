# Spec: Mail

> **Status: Approved** (Scott, 2026-11-02; open questions resolved below). Scott's decisions (2026-11-02):
> - Host it on **AWS Lambda Web Functions**, with the same coding and hosting practices as Trader (`~/src/trader`).
> - Sign in with **Google OAuth**.
> - v1 covers **read, triage and reply/compose**.
> - Talk to Gmail through the **Gmail API**.
> - Serve it at **mail.whitebirch.io**.
> - Use its **own Google Cloud project**.
> - Run **production only**.
> - Show **no category tabs**: the inbox is one list.
> - **No label editing** in v1.
> - Use a **sliding 30-day session**.
> - Add **keyboard shortcuts** if they're cheap to add.
> - Make the repo **public**.

> **Build notes (2026-11-02):** changes made while building, none of them to scope.
> - **Next 16.4.4, not Trader's 16.2.10.** npm audit flags 16.2.10 critical, including a Proxy bypass under Turbopack, and `proxy.ts` is our auth gate.
> - **The list's attachment marker is a hint.** Gmail's metadata format has no part list, so a row shows a paperclip when a message is `multipart/mixed`. SC-3 checks it against Gmail, and some mismatches are expected.
> - **The CI deploy role trusts only `main`** (Trader's trusts every branch), since only `main` deploys here.
> - **A dev-only fake mailbox** (`MAIL_DEV_FAKE=1` under `next dev`) and a browser smoke test (`npm run smoke`) let the UI be built and checked without a Google client. Production builds compile the fake out.
> - **Sending reads your display name from Gmail's send-as settings** (`sendAs.list`, covered by `gmail.modify`; no new scope).

## Objective

Scott's work network blocks gmail.com. Mail is a small, single-user web client for **scott.schmalz@gmail.com**, served from `mail.whitebirch.io`. The browser only ever talks to `mail.whitebirch.io`. The server calls the Gmail API for it and passes the results through.

It's a **passthrough**. The server stores no mail: no database, no cache of messages, nothing on disk. Gmail is the only source of truth, so whatever Mail does shows up in Gmail (and the phone app) right away, and the reverse is true too.

**It's not a Gmail clone.** The aim is a clean, fast, friendly interface for daily reading and triage, plus replies.

### User stories (v1)
1. **Sign in.** I sign in with Google once, and stay signed in until I go 30 days without using it. Anyone else who signs in gets a 403.
2. **Inbox.** I see my inbox as conversations, newest first, 25 to a page. Each row shows:
   - the sender(s) and the thread's message count;
   - the subject and a snippet;
   - the date;
   - an unread state (bold), a star and an attachment marker.
3. **Folders and labels.** The inbox is one list (`in:inbox`), with no category tabs. A sidebar lists Inbox (with its unread count), Starred, Sent, Drafts (read-only list), All Mail, Spam, Trash and my user labels. Clicking one shows its threads.
4. **Search.** A search box accepts Gmail's own query syntax (`from:amazon has:attachment newer_than:7d`), so the results match what Gmail would return.
5. **Read.** Opening a thread shows every message in it.
   - Earlier read messages are collapsed to one line each. The latest and any unread ones are expanded.
   - HTML email looks the way the sender meant it to, inside a sandbox. Plain-text email is shown as text.
   - **Remote images are blocked** until I click "Show images". Inline (`cid:`) images always show.
   - Attachments are listed with their name and size, and download through Mail.
   - Opening an unread thread marks it read.
6. **Triage.** From the thread view, or on several selected threads in a list, I can:
   - archive, or move back to the inbox;
   - mark read or unread;
   - star or unstar;
   - move to trash, or restore from trash;
   - report spam, or mark not spam.

   Archive, trash and spam show an **Undo** toast for about 8 seconds. After archive or trash in the thread view, I go to the next thread (or back to the list).
7. **Reply and compose.** I can reply, reply-all or forward from any message, or write a new email.
   - To, Cc and Bcc are comma-separated addresses.
   - The body is **plain text**. Replies and forwards include the quoted original ("On …, X wrote:").
   - Replies stay in the thread: same `threadId`, plus `In-Reply-To`/`References` headers. They show up threaded in Gmail and in the recipient's mail client.
   - Forwarding includes the original's attachments.
   - Leaving a compose form with text in it asks me to confirm first.
8. **Fresh.** The list refreshes itself every 60 seconds while the tab is visible, and has a refresh button. The tab title shows the inbox unread count ("Inbox (3) · Mail").
9. **Keyboard.** If they're cheap to add, a small set of Gmail-style shortcuts (the last task in the plan, and the first to cut):
   - `j`/`k` to move, and `o`/Enter to open;
   - `e` to archive, `#` to trash and `s` to star;
   - `Shift+U`/`Shift+I` for unread/read;
   - `r`/`a`/`f` to reply, reply-all or forward, and `c` to compose;
   - `/` to search, `u` to go back to the list, and `?` for help.
10. **Anywhere.** It's built for a desktop browser and still usable at phone width.

### Out of scope for v1
Here's what's deliberately left out, and what each would cost:
- **Draft editing, scheduled send and undo send.** Each needs saved drafts.
- **Attachments on new mail.** Needs an upload path and size limits.
- **Rich-text compose.**
- **Contact autocomplete.** Needs the People API, which is another scope.
- **Editing labels** (applying or removing them, or creating new ones).
- **Inbox category tabs** (Primary / Promotions / …). Scott doesn't use them.
- **Filters and settings.**
- **Send-as aliases.**
- **Multiple accounts.**
- **Push notifications and offline use.**
- **Permanent delete.** The OAuth scope doesn't even allow it.

## Tech stack

This matches Trader's dashboard (`SPEC-dashboard.md` in `~/src/trader`) wherever there's nothing mail-specific to change:
- **Language and tooling:**
  - TypeScript, with `typescript@6.0.3` pinned (Next 16 can't load TS 7).
  - An npm-workspaces monorepo. Node 22 locally and in CI, `nodejs24.x` in Lambda.
- **Web:**
  - Next.js 16 (App Router, React Server Components, Server Actions), React 19, Tailwind 4.
  - Pages are server components. Mutations are Server Actions.
  - `"use client"` only where it has to be: selection checkboxes, the toast, the iframe autosizer, the compose form and the auto-refresh.
- **Gmail:** the Gmail REST API v1, called with plain `fetch`, with every response Zod-validated. We don't use `googleapis`: it's large, and we need about ten endpoints.
- **Email HTML:** sanitized on the server (`sanitize-html` or similar; we'll pick in the plan), then rendered in a sandboxed `<iframe srcdoc>`.
- **Hosting:** the same pattern as Trader, all of it CDK in `infra/` (aws-cdk-lib ≥ 2.275, with the L1 `CfnWebFunction*` constructs):
  - an **AWS Lambda Web Function** (Arm64, `maxEnvironments: 2`, a rate limit);
  - an `IamAuth` endpoint, reachable **only** through CloudFront OAC;
  - the same CloudFront Function that re-encodes `+` as `%20`;
  - an ACM certificate in its own `MailCerts` stack.
- **Account and region:** the same AWS account as Trader (SSO profile `whitebirch`), in us-east-1.
- **DNS:** Cloudflare, already authoritative for whitebirch.io. Scott adds the cert-validation CNAME and a `mail` CNAME to CloudFront, both set to DNS only.
- **Secrets:** stored in SSM under `/mail/production/`:
  - `GOOGLE_CLIENT_SECRET`;
  - `SESSION_KEY`, the 32-byte key that encrypts the session cookie.

  `GOOGLE_CLIENT_ID` isn't secret, so it's a plain environment variable.
- **CI and CD:** GitHub Actions in a new repo, `whitebirchio/mail`, deploying through a GitHub OIDC role (`MailCi` stack) with no stored AWS keys. It also runs a gitleaks history scan, as Trader does.
  - The account already has a GitHub OIDC provider (Trader's), so we **import** it rather than create a second one.

### Security model
The app holds the keys to Scott's whole mailbox, so this section carries the most weight.

1. **Sign-in and Gmail consent happen in a single Google OAuth flow.**
   - It's the authorization-code flow with PKCE, `state` and `nonce`.
   - It uses `access_type=offline` and the scopes `openid email https://www.googleapis.com/auth/gmail.modify`.
   - `gmail.modify` covers read, label changes, trash and send, but not permanent delete. It's the only Gmail scope we ask for.
   - The callback checks the ID token's `iss`, `aud`, `exp`, `nonce` and `email_verified`, and that `email` is **exactly** `OWNER_EMAIL` (from config). Anyone else gets a 403 page, and their tokens are thrown away without being stored.
2. **Session = encrypted cookie, no server-side storage.**
   - `__Host-mail_session` holds `{ email, refreshToken, exp }`, encrypted with **AES-256-GCM** under `SESSION_KEY`. Trader signs its cookie but doesn't encrypt it. Here we must encrypt, because the cookie carries a refresh token.
   - It's `HttpOnly`, `Secure`, `SameSite=Lax`.
   - It **slides**: `proxy.ts` re-issues it with a fresh 30-day expiry whenever it's more than a day old, so it only expires after 30 days without use.
   - Access tokens are minted from the refresh token as needed. They're cached **in memory only** (keyed by a hash of the session), and never sent to the browser.
   - Rotating `SESSION_KEY` signs everyone out.
   - **Sign out** revokes the Google grant at `oauth2.googleapis.com/revoke` and clears the cookie.
3. **Every route checks the session** in `proxy.ts`, except `/login`, `/auth/*` and the static assets. Bad config fails closed with a 503 that names the bad variables but never their values.
4. **Mutations are POST only**, through Server Actions, which check `Origin` against `APP_URL`. A GET never changes mailbox state. The one exception is the documented side effect of marking a thread read when you open it.
5. **Email HTML is untrusted input.** It gets two layers of defense:
   - **(a) Sanitized on the server.** That removes scripts, event handlers, `<form>`, `<iframe>`, `<object>`, `<base>`, `<meta http-equiv>` and `javascript:`/`data:` URLs, apart from `data:` images.
   - **(b) Rendered in `<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc=…>`.** It has **no `allow-scripts`**, so nothing in the message can run, even if the sanitizer misses something. `allow-same-origin` is only there so the parent can measure the content's height.

   The srcdoc carries its own CSP: `default-src 'none'; style-src 'unsafe-inline'; img-src <cid/data, plus https: only after "Show images">`.

   Links open in a new tab with `rel="noopener noreferrer"`.
6. **The browser never contacts Google** after sign-in. It reaches no `*.google.com`, `*.googleapis.com` or `gmail.com` address, because the attachment and inline-image bytes stream through Mail's own routes. The one exception is remote images in a message, and those load only after "Show images".
7. **Nothing sensitive is logged.** Logs never contain message bodies, subjects, addresses, snippets, search queries or tokens. They record only the route, the status, the latency and any Gmail error codes.
8. **IAM:** the function's role can `ssm:GetParameters` on exactly the two `/mail/production/` parameters, and write its own log groups. Nothing else.
9. **Headers:**
   - a strict app CSP (self only, with a nonce for scripts, as Trader has);
   - `frame-ancestors 'none'`;
   - `Referrer-Policy: no-referrer`, so opening a link from an email doesn't leak the app's URL;
   - `Cache-Control: no-store` on every page and attachment.
10. **Branding:** the app is called "Mail". It has its own icon, and no Google or Gmail logos.

### Environments
There's **one deployed environment**: `production` at `mail.whitebirch.io`, deployed when you push to `main`. That's a departure from Trader, whose staging exists because paper trading gives it a safe twin. Mail has no sandbox mailbox, so a staging site would act on the same real inbox.

Feature branches run the full CI gate (typecheck, test, build, `cdk synth`), but nothing is deployed from them. Local `next dev` runs the real OAuth flow, with a `http://localhost:3000/auth/callback` redirect URI, against the real mailbox.

### Cost
There's no standing cost.
- CloudFront and ACM fall within their free tiers.
- Web Functions bill per request, plus CPU and memory while an environment exists. They're capped at 2 environments, so this works out to cents a month for one person.
- There's no database, NAT, WAF or Secrets Manager.

## Commands

```sh
npm run typecheck && npm test              # the gate: run before every commit; mirrors CI
npm run test:watch -w @mail/core           # inner loop
npm run dev -w mail-web                    # next dev on :3000, real Google sign-in, real mailbox
npm run build -w mail-web                  # next build (standalone) + package for the Web Function
npm run synth                              # cdk synth every stack (CI runs this on every push)
npm run deploy -w mail-infra               # cdk deploy MailProduction (CI does this on main)
scripts/set-secrets.sh                     # GOOGLE_CLIENT_SECRET (from .env) + a generated SESSION_KEY → SSM; prints names only
```

## Project structure

```
packages/core/                 @mail/core: all logic and its tests; no Next, AWS or HTTP-framework deps
  src/mailbox/port.ts          Mailbox port: listThreads, getThread, modifyThreads, send, getAttachment, listLabels
  src/mailbox/gmail.ts         GmailMailbox: the Gmail REST adapter (fetch injected; Zod-validated responses)
  src/mailbox/fake.ts          in-memory Mailbox for tests
  src/message/parse.ts         Gmail payload tree → { headers, textBody, htmlBody, attachments, inlineParts }
  src/message/sanitize.ts      email HTML → safe HTML (+ cid: → /attachments/… rewrite, remote-image gating)
  src/message/compose.ts       reply/reply-all/forward/new → RFC 5322 MIME (threading headers, quoting, UTF-8)
  src/views/                   view models: thread-list rows, thread view, label sidebar
  src/actions.ts               triage verbs → label changes (archive = remove INBOX, etc.) and their undo inverses
  test/                        vitest; synthetic Gmail JSON fixtures only, never real mail
apps/web/                      mail-web: Next.js app (thin: validate → call core → render)
  src/app/(signed-in)/[label]/page.tsx       thread list for a system or user label (?q= search, ?page=)
  src/app/(signed-in)/t/[threadId]/page.tsx  thread view
  src/app/(signed-in)/compose/page.tsx       new / reply / reply-all / forward (?mode=&messageId=)
  src/app/attachments/[messageId]/[attachmentId]/route.ts   streamed download / inline image
  src/app/login/, src/app/auth/{start,callback,logout}/     Google OAuth
  src/lib/{config,oidc,session,gmail}.ts     config (Zod), OAuth, encrypted cookie, per-request Mailbox
  src/proxy.ts                               session check + CSP on every route
  src/components/                            list, thread, message frame, toolbar, toast, compose
  test/
infra/                         mail-infra: CDK
  bin/mail.ts, lib/{config,certs-stack,ci-stack,app-stack}.ts, test/
docs/SETUP.md                  one-time steps: Google Cloud project + OAuth client, DNS records, secrets, first deploy
docs/decisions/                ADRs (001: stateless passthrough with no mail storage; 002: one environment)
scripts/set-secrets.sh
CLAUDE.md                      written once the scaffold exists, in Trader's format
```

## Code style

This follows Trader's conventions. Logic lives in core behind ports. Next is a thin shell. Expected outcomes are status unions, not throws. Comments are sparse and explain *why*.

```ts
// packages/core/src/actions.ts
export type Triage = "archive" | "inbox" | "read" | "unread" | "star" | "unstar" | "trash" | "untrash" | "spam" | "notSpam";

const LABEL_CHANGES: Record<Triage, { add: SystemLabel[]; remove: SystemLabel[] }> = {
  archive: { add: [], remove: ["INBOX"] },
  inbox: { add: ["INBOX"], remove: [] },
  read: { add: [], remove: ["UNREAD"] },
  // …
};

/** What Undo sends to reverse `verb`. Trash goes through Gmail's own trash/untrash endpoints, not a label edit. */
export const inverse = (verb: Triage): Triage => INVERSES[verb];

export async function triage(mailbox: Mailbox, threadIds: string[], verb: Triage): Promise<TriageResult> {
  if (threadIds.length === 0) return { ok: false, reason: "nothing-selected" };
  const result = await mailbox.modifyThreads(threadIds, verb);
  return result.ok ? { ok: true, undo: { threadIds, verb: inverse(verb) } } : result;
}
```

```tsx
// apps/web/src/app/(signed-in)/t/[threadId]/actions.ts
"use server";
export async function triageAction(threadIds: string[], verb: Triage) {
  const result = await triage(await mailbox(), threadIds, verb);
  revalidatePath("/", "layout");
  return result;
}
```

- **Names:** camelCase in TypeScript. Component files are kebab-case (`message-frame.tsx`), as in Trader's dashboard.
- **Config:** Zod-validated at every entry point. All absolute URLs come from `APP_URL`, never from `req.url`. Behind CloudFront, the Web Function sees its own host, not the viewer's (a Trader D1 finding).
- **Dependencies:** each new one, and why, goes in the commit message that adds it.

## Testing strategy

- **Framework:** vitest 4 in every workspace. Fixtures are synthetic Gmail API JSON written by hand. **No real email content ever enters the repo.**
- **Core: every exported function gets a test.**
  - **parse:**
    - multipart/alternative, multipart/mixed and nested multipart/related;
    - quoted-printable and base64 bodies;
    - non-UTF-8 charsets;
    - RFC 2047 encoded headers;
    - attachments vs inline `cid:` parts;
    - a message with no text part.
  - **sanitize:** an XSS corpus. Script, `on*=` handlers, `javascript:` hrefs, SVG script, `<base>`, `<meta refresh>`, CSS `expression`/`url(javascript:)`, forms and nested iframes must all come out inert. Also:
    - `cid:` gets rewritten to the attachment route;
    - remote `img src` is blocked until it's allowed;
    - links get `target=_blank rel=noopener noreferrer`.
  - **compose:**
    - reply-all recipients (my own address removed, de-duplicated, Cc kept);
    - `In-Reply-To`/`References`, and `Re:`/`Fwd:` prefixes that don't double up;
    - the quoted body;
    - UTF-8 subjects and bodies;
    - forwarded attachments;
    - a generated RFC 5322 message that round-trips through `parse`.
  - **actions:** every verb maps to the right Gmail call, and every verb's inverse restores the original labels on the fake.
  - **GmailMailbox:** against a fake `fetch`.
    - request shapes for every endpoint;
    - pagination tokens;
    - batching thread metadata within Gmail's quota;
    - a 401 leads to a token refresh and one retry;
    - a 429 or 5xx becomes a status union, not a throw;
    - Zod rejects a malformed response.
- **Web:**
  - **OAuth:** the authorize URL has PKCE, `state`, `nonce`, offline access and the exact scopes. The callback rejects a bad state or nonce, a wrong `aud`/`iss`, an expired token, an unverified email, a non-owner email, and a missing refresh token.
  - **Session:** the cookie encrypts and decrypts. A tampered, expired or wrong-key cookie is rejected.
  - **proxy:** no session means a redirect to `/login`. Bad config means a 503.
  - **Server Actions:** a wrong or missing `Origin` is rejected.
- **Infra (CDK assertions):**
  - the role reads only the two SSM parameters;
  - the endpoint has `IamAuth` and `maxEnvironments: 2`;
  - the resource policy allows only this distribution;
  - CloudFront has OAC, `CachingDisabled` on dynamic routes and an HTTPS redirect;
  - log groups have 30-day retention;
  - the CI stack imports the existing OIDC provider and doesn't create one.
- **Live checklist (manual, after the first deploy):** runs the Success criteria below against the real inbox, using the browser's network panel.

## Boundaries

- **Always:**
  - Run the gate (`typecheck && test`) before committing.
  - Keep logic in core.
  - Sanitize **and** sandbox every piece of email HTML.
  - Make every mutation a POST Server Action that checks Origin.
  - Take absolute URLs from config.
  - Use synthetic fixtures only.
- **Ask first:**
  - Adding any OAuth scope.
  - Storing any mail data server-side (a database, a cache, logs of content).
  - Adding any permanent-delete path.
  - Allowing a second email address.
  - Adding a staging environment.
  - AWS resources with a standing cost (WAF, provisioned concurrency, Secrets Manager, NAT).
  - Changing CI deploy triggers.
  - Setting or rotating production secrets.
- **Never:**
  - Commit secrets, `.env*` or real email content.
  - Log message content, addresses, queries or tokens.
  - Send a refresh or access token to the browser unencrypted.
  - Let the browser call Google APIs directly.
  - Render email HTML outside the sandboxed iframe, or add `allow-scripts` to it.
  - Turn the sanitizer off.

## Success criteria

1. **Locked down.**
   - With no session, `https://mail.whitebirch.io` goes to Google sign-in. Signing in as scott.schmalz@gmail.com works.
   - Any other Google account gets 403.
   - The raw Web Function URL refuses direct requests (403).
2. **No Google in the browser.** After sign-in, a full session (list, search, open, attachments, triage, send) makes **no browser requests** to `*.google.com`, `*.googleapis.com`, `*.gstatic.com` or `gmail.com`, as the DevTools network log shows. Remote images in a message are the one exception, and only after "Show images".
3. **Inbox parity.** The first page of the inbox matches Gmail's order, unread state and stars. Attachment markers match too, apart from the known multipart/mixed mismatches (see Build notes). Labels, Starred, Sent, Spam and Trash list the same threads Gmail does. A Gmail-syntax search returns the same threads as the same search in Gmail.
4. **Reading.**
   - A newsletter, a receipt, a plain-text email and a message with an inline image all render correctly.
   - A message containing `<script>` and `onerror=` runs nothing.
   - Remote images stay blocked until "Show images".
   - A PDF attachment downloads intact (byte-for-byte, checked by sha256).
5. **Triage.** Every verb in story 6 shows up in the Gmail phone app within 10 seconds, single and bulk alike. Undo restores the original state.
6. **Compose.**
   - A reply, a reply-all, a forward (with an attachment) and a new email all arrive.
   - Replies thread correctly in Gmail and in a second client (for example Apple Mail or Outlook).
   - Each appears in Sent once, with the right To/Cc/Bcc.
   - Non-ASCII text (é, 日本, emoji) survives in both the subject and the body.
7. **Fast enough.** Measured from the laptop through CloudFront, warm, at the median: the inbox list loads in **under 1.5 s**, a thread opens in **under 1 s**, and a triage action finishes in **under 500 ms**. A cold start adds no more than about 2 s.
8. **Sessions last.** A session still works 8 days after sign-in without consenting again. That proves the OAuth app isn't stuck in Testing's 7-day token expiry. Sign out revokes the grant: it disappears from Google Account → Security → Third-party connections.
9. **Usable.**
   - It works in current Chrome, Edge, Safari and Firefox on desktop.
   - Lists and threads are usable at 390 px wide.
   - Every action can be reached by keyboard.
   - Every control has an accessible name.
10. **Cheap and quiet.** The bill shows no standing-cost resources. CloudWatch logs for a session contain no subjects, addresses, bodies or tokens.

## Risks

- **The work network may also block Google sign-in.** If `accounts.google.com` is blocked, you'd have to sign in on the work laptop while it's on another network, such as at home. Signing in on your phone won't help, because the session cookie belongs to the browser that signed in. The 30-day session covers the gaps between sign-ins.
  - **Mitigation:** the session slides, so it renews whenever it's used.
- **Corporate controls.** A web filter might later classify `mail.whitebirch.io` as webmail. TLS inspection, if your employer runs it, would show them the mail content. And your company's acceptable-use policy may say something about personal webmail. This spec can't fix any of those, so it's worth a quick check.
- **The unverified-app warning and token expiry.** `gmail.modify` is a restricted scope, so this is an unverified personal-use app.
  - The consent screen shows an "unverified app" warning, which you click through once.
  - The OAuth app must be **published to Production**. In Testing status, refresh tokens expire every 7 days.
  - Personal use stays far below the 100-user limit for unverified apps.
- **Attachment size limits on Web Functions** aren't documented. The plan starts with a spike to measure the largest download that streams through CloudFront and the Web Function. Above that limit, the UI says the file is too large rather than failing silently.
- **Gmail quota.** Listing 25 threads takes one `threads.list` plus 25 `threads.get` calls (metadata format). That's about 255 quota units, against a per-user limit of about 250 units per second. The plan has to pick a strategy: Gmail's batch endpoint, bounded concurrency, or `messages.list` with metadata.

## Public repo

`whitebirchio/mail` is **public**, so everything committed is world-readable, and so are the CI logs.
- **No secrets:** client secret, session key, tokens and `.env*` are all gitignored. CI runs a gitleaks scan over all of history, as Trader does.
- **No mail data:** fixtures are synthetic, and we never commit screenshots of the real inbox.
- **What may be public:** the owner email (`OWNER_EMAIL`, already public in Trader), the Google client id and the domain. None of them grants access.
- **Never echoed:** CI never prints secret values. AWS account ids are only referenced through the OIDC role, as in Trader.

## Open questions

None. All resolved by Scott on 2026-11-02:
1. Mail gets its own Google Cloud project.
2. Production only.
3. No category tabs.
4. No label editing in v1.
5. Sliding session: yes.
6. Keyboard shortcuts: if they're cheap.
7. The repo is public (see above).

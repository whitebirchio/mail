# Tasks: Mail

> Plan: [plan.md](plan.md) · Spec: [SPEC.md](../SPEC.md) · gate = `npm run typecheck && npm test` (+ `npm run synth` once infra exists)

## Step S: Scott's one-time setup (alongside T1–T4)

- [ ] S: Google Cloud and GitHub setup (step-by-step instructions go in `docs/SETUP.md` in T4)
  - **Google Cloud project:**
    - Create the project `whitebirch-mail` and enable the Gmail API.
    - Consent screen: External, with scopes `openid`, `email` and `gmail.modify`. **Publish it to Production** and leave it unverified.
    - Create a Web OAuth client with redirect URIs `https://mail.whitebirch.io/auth/callback` and `http://localhost:3000/auth/callback`.
    - Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
  - **GitHub:** create the public, empty repo `whitebirchio/mail`.

## M1: signed-in shell, live

- [ ] T1: Repo scaffold
  - **Build:**
    - `git init`; npm workspaces (`packages/core` = `@mail/core`, `apps/web` = `mail-web`, `infra` = `mail-infra`); `tsconfig.base.json`; `typescript@6.0.3` pinned; vitest 4 in each workspace; `.nvmrc` (22).
    - `.gitignore`, covering `.env*`, `.next`, `dist`, `cdk.out` and `node_modules`.
    - `.gitleaks.toml` and `.github/workflows/ci.yml`. CI runs gitleaks over full history, then `npm ci`, typecheck, test, build and synth, with no deploy job yet.
    - ADRs: `docs/decisions/001-stateless-passthrough.md` and `002-one-environment.md`, plus the README index.
    - The first commit holds the spec and the plan.
  - **Acceptance:**
    - `npm run typecheck && npm test` passes, with one placeholder test per workspace.
    - `gitleaks git .` is clean.
    - CI is green on the first push.
  - **Verify:** run the gate locally, and check the Actions run on GitHub.
  - **Files:** root `package.json`, `tsconfig.base.json`, `.gitignore`, `.gitleaks.toml`, `ci.yml`, workspace `package.json`s, ADRs.

- [ ] T2: Config and the encrypted session
  - **Build:**
    - `apps/web/src/lib/config.ts`: Zod. `APP_URL`, `OWNER_EMAIL`, `GOOGLE_CLIENT_ID`, `SECRETS_PATH`, then SSM loading of `GOOGLE_CLIENT_SECRET` and `SESSION_KEY`. Locally, these come from `.env`.
    - `session.ts`:
      - the session is AES-256-GCM (`{ t: "session", email, refreshToken, iat, exp }`);
      - the OAuth state/nonce/verifier cookie is HMAC-signed, as in Trader;
      - `shouldRenew` returns true when `iat` is more than 24 h old.
  - **Acceptance:**
    - The session round-trips.
    - Tampered ciphertext, a wrong key, an expired cookie, and a cookie of the wrong kind are all rejected.
    - Invalid config reports variable **names** only.
  - **Verify:** `npm test -w mail-web`.
  - **Files:** `src/lib/config.ts`, `src/lib/session.ts`, `test/session.test.ts`, `test/config.test.ts`.

- [ ] T3: Google sign-in, `proxy.ts`, login and logout
  - **Build:**
    - `oidc.ts`, ported from Trader. Scopes are `openid email gmail.modify`, with `access_type=offline` and `prompt=consent select_account`.
    - The callback requires a `refresh_token`. Owner-only.
    - `proxy.ts`: session check, sliding renewal, a CSP nonce, `Referrer-Policy: no-referrer` and `no-store`. Bad config fails closed with a 503.
    - Routes `/login`, `/auth/start`, `/auth/callback` and `/auth/logout`. Logout revokes the grant and clears the cookie.
    - A placeholder signed-in page: "Signed in as …".
  - **Acceptance (tested):**
    - The authorize URL has PKCE, state, nonce, offline access and the exact scopes.
    - The callback rejects a bad state or nonce, a wrong aud/iss, an expired token, an unverified email, a non-owner email and a missing refresh token.
    - The proxy redirects to `/login` without a session, and renews a stale cookie.
  - **Verify:** `npm test -w mail-web`. Then `npm run dev -w mail-web`: sign in at localhost as the owner (works), then as another account (403). Sign out, and the grant is gone from Google Account → Third-party connections.
  - **Files:** `src/lib/oidc.ts`, `src/proxy.ts`, `src/app/auth/*/route.ts`, `src/app/login/page.tsx`, `test/auth.test.ts`.

- [ ] T4: Infra
  - **Build:**
    - `infra/lib/config.ts`: domain, owner, client id, and the GitHub OIDC subject from `gh api` repo/org ids.
    - `certs-stack.ts` (`MailCerts`): an ACM certificate for `mail.whitebirch.io`.
    - `ci-stack.ts` (`MailCi`): the deploy role, which can only assume the CDK bootstrap roles. It **imports** the existing GitHub OIDC provider.
    - `app-stack.ts` (`MailProduction`): ported from Trader's `Dashboard` construct.
      - the versioned code bucket and the Web Function, revision and IamAuth endpoint (`maxEnvironments: 2`, a rate limit);
      - a resource policy for this distribution only;
      - a role scoped to the 2 SSM parameters;
      - both log groups (30 days);
      - CloudFront with OAC, the `+` → `%20` function, `CachingDisabled`, and caching for `/_next/static/*`.
    - `apps/web/scripts/package.mjs`.
    - `scripts/set-secrets.sh`.
    - `docs/SETUP.md`: steps S, cert DNS validation, the `mail` CNAME, secrets and the first deploy.
  - **Acceptance (CDK assertions):**
    - The role reads exactly 2 parameters.
    - IamAuth plus `maxEnvironments: 2`.
    - The resource policy names only this distribution.
    - OAC, CachingDisabled and an HTTPS redirect.
    - 30-day log retention.
    - The CI stack creates no OIDC provider.
  - **Verify:** `npm test -w mail-infra && npm run build -w mail-web && npm run synth`.
  - **Files:** `infra/bin/mail.ts`, `infra/lib/{config,certs-stack,ci-stack,app-stack}.ts`, `infra/test/*.test.ts`, `apps/web/scripts/package.mjs`, `scripts/set-secrets.sh`, `docs/SETUP.md`.

- [ ] T5: First deploy and spikes
  - **Build:**
    - Scott deploys `MailCerts` and `MailCi` from the laptop and adds the validation CNAME. Then `set-secrets.sh`.
    - Add a `deploy` job to CI, on `main` only, using OIDC. Then merge.
    - Scott adds `mail CNAME <cloudfront>` (DNS only).
    - **Spike A:** a temporary signed-in route, `/_probe/bytes?mb=N`. Find the largest response that downloads intact through CloudFront.
    - **Spike B:** a trivial Server Action (sign out as a form action) works through CloudFront with `allowedOrigins`.
    - Remove the probe, and record both findings in the spec.
  - **Acceptance:**
    - SC-1 holds live: owner in, other account 403, raw endpoint 403.
    - The spike results are written into SPEC.md (Risks).
    - The SC-8 start date is recorded.
  - **Verify:** check it in the browser and with `curl` against the raw endpoint, then review the CloudWatch logs (no tokens).
  - **Files:** `ci.yml`, `next.config.ts`, the temporary probe route, `SPEC.md`.

### Checkpoint: M1
- [ ] The gate and synth are green, and CI deploys on `main`.
- [ ] SC-1 holds live. The SC-8 clock has started.
- [ ] **Review with Scott:** the spike findings (attachment ceiling, Server Actions), and whether the plan changes.

## M2: read

- [ ] T6: Core: tokens, the Mailbox port, and listing
  - **Build:**
    - `google/token.ts`: refresh → access token, an in-memory cache keyed by `sha256(refreshToken)`, expiring 60 s early.
    - `mailbox/port.ts`.
    - `mailbox/gmail.ts`: `listLabels` (with INBOX unread counts) and `listThreads({ labelId | q, pageToken })`. Up to 10 metadata `threads.get` calls in flight; a 401 refreshes the token and retries once; a 429 backs off once.
    - `mailbox/fake.ts`.
    - `views/thread-list.ts`, which produces the row model: senders, count, subject, snippet, date, unread, starred, attachment.
  - **Acceptance (tested with a fake `fetch` and synthetic fixtures):**
    - request shapes and pagination;
    - the concurrency bound;
    - 401 retry;
    - 429/5xx return a status union;
    - Zod rejects malformed responses;
    - the row model is correct.
  - **Verify:** `npm test -w @mail/core`.
  - **Files:** `src/google/token.ts`, `src/mailbox/{port,gmail,fake}.ts`, `src/views/thread-list.ts`, `test/*`.

- [ ] T7: UI: sidebar, thread list and search
  - **Build:**
    - The `(signed-in)` layout, with a sidebar: Inbox (unread), Starred, Sent, Drafts, All Mail, Spam, Trash, and user labels.
    - `[label]/page.tsx`, supporting `?q=` and `?page=`.
    - A search box.
    - A `<LocalTime>` client component.
    - A `lib/gmail.ts` per-request Mailbox built from the session.
    - Log Gmail latency and quota errors with no content.
  - **Acceptance:**
    - The inbox's first page matches Gmail's order, unread state, stars and attachment markers.
    - Labels, Sent, Spam and Trash list the same threads Gmail does.
    - A Gmail-syntax search matches Gmail's.
    - A warm list takes under 1.5 s.
  - **Verify:** run locally against the real inbox, side by side with Gmail on a phone. Then deploy and check the timing in the network panel.
  - **Files:** `src/app/(signed-in)/layout.tsx`, `[label]/page.tsx`, `src/components/{sidebar,thread-list,local-time}.tsx`, `src/lib/gmail.ts`.

- [ ] T8: Core: MIME parse and the thread view model
  - **Build:**
    - `message/parse.ts`: walks the payload tree; handles multipart/alternative, mixed and nested related; QP and base64; non-UTF-8 charsets (`TextDecoder`); RFC 2047 headers; tells attachments apart from inline `cid:` parts.
    - `GmailMailbox.getThread` (format=full).
    - `views/thread.ts`, with collapse rules: the latest message and any unread ones expanded.
  - **Acceptance:** every case listed in the spec's testing strategy for parse passes, plus the collapse rules.
  - **Verify:** `npm test -w @mail/core`.
  - **Files:** `src/message/parse.ts`, `src/mailbox/gmail.ts`, `src/views/thread.ts`, `test/parse.test.ts`, `test/fixtures/*`.

- [ ] T9: Core: sanitize
  - **Build:** `message/sanitize.ts`, using `sanitize-html` or similar (record the dependency in the commit). It:
    - strips scripts, `on*` handlers, `javascript:` and non-image `data:` URLs, forms, iframes, objects, `<base>`, `<meta http-equiv>`, and dangerous CSS;
    - rewrites `cid:` to `/attachments/<msg>/<att>`;
    - gates remote images behind `allowRemoteImages`;
    - gives links `target=_blank rel=noopener noreferrer`;
    - wraps the result in a srcdoc with its own CSP.
  - **Acceptance:** the XSS corpus comes out inert. The cid rewrite, image gating and link attributes all hold.
  - **Verify:** `npm test -w @mail/core`.
  - **Files:** `src/message/sanitize.ts`, `test/sanitize.test.ts`, `test/fixtures/xss/*`.

- [ ] T10: UI: thread view and attachments
  - **Build:**
    - `t/[threadId]/page.tsx`.
    - A `<MessageFrame>`: a sandboxed iframe (`allow-same-origin allow-popups allow-popups-to-escape-sandbox`, never `allow-scripts`) with a parent-side autosizer.
    - Collapsed rows that expand on click.
    - "Show images" (`?images=1` for that message).
    - An attachment list with sizes.
    - `attachments/[messageId]/[attachmentId]/route.ts`: decode the attachment, then nosniff, `no-store`, `Content-Disposition`, and the size ceiling from T5.
    - Opening an unread thread marks it read. This is the one GET side effect, and the spec documents it.
  - **Acceptance:**
    - The newsletter, receipt, plain-text and inline-image test messages render correctly.
    - A `<script>`/`onerror` test message runs nothing.
    - Images stay blocked until clicked.
    - The PDF's sha256 matches.
    - The network log shows no Google hosts.
    - A thread opens in under 1 s, warm.
  - **Verify:** locally, then deploy. For the test messages, send yourself mail from another account rather than relying on real mail.
  - **Files:** `t/[threadId]/page.tsx`, `src/components/{message-frame,message,attachments}.tsx`, the attachments `route.ts`.

### Checkpoint: M2
- [ ] SC-2, SC-3 and SC-4 hold live, and the gate is green.
- [ ] Review with Scott. This is the first version that's actually useful.

## M3: triage

- [ ] T11: Core: triage verbs
  - **Build:**
    - `actions.ts`: `Triage` verbs → label changes, or trash/untrash; `inverse()`; `triage()` returns `{ ok, undo }`.
    - `GmailMailbox.modifyThreads`, using `threads.modify` (`batchModify` is messages-only), with bounded concurrency for bulk.
  - **Acceptance:** every verb maps to the right call. Applying a verb and then its inverse restores the original labels in the fake. An empty selection returns a status, not a throw.
  - **Verify:** `npm test -w @mail/core`.
  - **Files:** `src/actions.ts`, `src/mailbox/{gmail,fake}.ts`, `test/actions.test.ts`.

- [ ] T12: UI: triage
  - **Build:**
    - A thread toolbar: archive / inbox, read / unread, star, trash / untrash, spam / not spam.
    - List checkboxes with a bulk toolbar.
    - Server Actions that call `assertOrigin`.
    - An Undo toast (about 8 s) for archive, trash and spam.
    - After archive or trash, go to the next thread or back to the list.
    - The list auto-refreshes every 60 s while visible (`router.refresh`), and has a refresh button.
    - The title reads "Inbox (N) · Mail".
  - **Acceptance:**
    - Every verb, single and bulk, shows up in the Gmail phone app within 10 s.
    - Undo restores the original state.
    - A triage action takes under 500 ms, warm.
    - A forged-Origin POST is rejected (tested).
  - **Verify:** `npm test -w mail-web`, then test live against the phone app.
  - **Files:** `src/app/(signed-in)/actions.ts`, `src/components/{toolbar,toast,selection}.tsx`, `test/actions.test.ts`.

### Checkpoint: M3
- [ ] SC-5 holds live, and the gate is green.

## M4: compose

- [ ] T13: Core: compose and send
  - **Build:** `message/compose.ts` covers:
    - reply-all recipients (own address removed, de-duplicated, Cc kept);
    - `In-Reply-To`/`References`, and `Re:`/`Fwd:` without doubling;
    - the quoted body ("On …, X wrote:");
    - RFC 2047 subjects and a UTF-8 QP body;
    - forwarded attachments (fetched, then base64-encoded into the message);
    - address validation.

    `GmailMailbox.send` uses media upload (`message/rfc822`) with `threadId`.
  - **Acceptance:** every case listed in the spec's testing strategy for compose passes. A generated message round-trips through `parse`.
  - **Verify:** `npm test -w @mail/core`.
  - **Files:** `src/message/compose.ts`, `src/mailbox/gmail.ts`, `test/compose.test.ts`.

- [ ] T14: UI: compose
  - **Build:**
    - `compose/page.tsx` (`?mode=new|reply|replyAll|forward&messageId=`), with prefilled To/Cc/Bcc/Subject and the quoted body.
    - Reply / reply-all / forward buttons on each message, and a Compose button.
    - A send Server Action (`assertOrigin`, then validate, then `compose`, then `send`).
    - A leave-page guard while there's text.
    - After sending, return to the thread or the list with a "Sent" toast.
  - **Acceptance:**
    - A reply, a reply-all, a forward with an attachment, and a new email all arrive.
    - Replies thread in Gmail and in a second client.
    - Each appears in Sent once.
    - Non-ASCII survives in both the subject and the body.
  - **Verify:** live, sending to a second account Scott controls.
  - **Files:** `src/app/(signed-in)/compose/page.tsx`, `compose/actions.ts`, `src/components/compose-form.tsx`, the message component.

### Checkpoint: M4
- [ ] SC-6 holds live, and the gate is green.

## M5: polish

- [ ] T15: Keyboard shortcuts (first to cut)
  - **Build:** a single client `useShortcuts` hook: `j`/`k`, `o`/Enter, `e`, `#`, `s`, `Shift+U`/`Shift+I`, `r`/`a`/`f`, `c`, `/`, `u`, and `?` for a help overlay. It's off while focus is in a text field.
  - **Acceptance:** each key triggers the same path as the button it mirrors. Nothing fires while typing.
  - **Verify:** a manual run-through, and a unit test of the keymap.
  - **Files:** `src/components/shortcuts.tsx`, `test/shortcuts.test.ts`.

- [ ] T16: Responsive and accessibility pass, log audit
  - **Build:**
    - Usable at 390 px (the sidebar collapses into a menu).
    - Visible focus, accessible names on icon buttons, toolbar keyboard order.
    - Check it in Chrome, Edge, Safari and Firefox.
    - Read a session's CloudWatch logs: no subjects, addresses, bodies, queries or tokens.
  - **Acceptance:** SC-9 holds. The log half of SC-10 holds.
  - **Verify:** manual checks in each browser and with DevTools device mode; `aws logs tail` for the log audit.
  - **Files:** components and `globals.css` as needed.

- [ ] T17: Wrap-up
  - **Build:**
    - `CLAUDE.md` in Trader's format, and a `README`.
    - A full live run of SC-1 to SC-10, including SC-8 (8 days after T5).
    - The cost check in Billing.
    - The spec's status changes to Built, and the tasks move to `tasks/done/`.
  - **Acceptance:** all 10 success criteria are checked off with dates.
  - **Verify:** the live checklist.
  - **Files:** `CLAUDE.md`, `README.md`, `SPEC.md`, `tasks/*`.

### Checkpoint: Complete
- [ ] SC-1 to SC-10 pass. The spec is marked Built.

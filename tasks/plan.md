# Implementation Plan: Mail

> Implements [SPEC.md](../SPEC.md) (approved 2026-11-02). Tasks are in [todo.md](todo.md).

## Overview

Mail is built as thin vertical slices. Each one ends with something Scott can use at `mail.whitebirch.io`:
1. **M1:** a signed-in shell, deployed. Most of the risk is here.
2. **M2:** read mail.
3. **M3:** triage it.
4. **M4:** reply and compose.
5. **M5:** polish.

There's no staging, so **local `next dev` against the real inbox is the test environment, and merging to `main` ships**. Once T5 has deployed, every PR is checked locally before it merges.

## Order

| # | Task | Depends on | Size |
|---|---|---|---|
| **S** | *(Scott, alongside T1–T4)* Create the Google Cloud project: Gmail API on, consent screen **published to Production**, Web OAuth client. Create the public `whitebirchio/mail` repo. | — | — |
| **M1: signed-in shell, live** | | | |
| T1 | Repo scaffold: workspaces, TS, vitest, gitleaks, CI gate, ADRs 001–002 | — | M |
| T2 | Config and the encrypted, sliding session cookie | T1 | S |
| T3 | Google sign-in with Gmail consent, `proxy.ts`, login/logout (revoke) | T2 | M |
| T4 | Infra: `MailCerts`, `MailCi`, `MailProduction` + CDK tests; packaging; `set-secrets.sh`; SETUP.md | T1 | M |
| T5 | First deploy, the CI deploy job, and **spikes**: attachment size limit and a Server Action through CloudFront | T3, T4, S | M |
| **M2: read** | | | |
| T6 | Core: token minting, the `Mailbox` port, `GmailMailbox.listLabels`/`listThreads`, fake `fetch`, list view model | T1 | M |
| T7 | UI: label sidebar, thread list, pagination, search, local dates | T3, T6 | M |
| T8 | Core: MIME `parse`, `getThread`, the thread view model | T6 | M |
| T9 | Core: `sanitize`, using the XSS corpus | T1 | S |
| T10 | UI: thread view, sandboxed message frame, Show images, the attachment/cid route, mark read on open | T7, T8, T9 | M |
| **M3: triage** | | | |
| T11 | Core: `triage` verbs and their inverses, `modifyThreads`/trash/untrash | T6 | S |
| T12 | UI: thread toolbar, bulk select, Undo toast, next thread, auto-refresh, unread in the title | T10, T11 | M |
| **M4: compose** | | | |
| T13 | Core: `compose` (MIME build, reply-all, threading, quoting, UTF-8, forwarded attachments) and `send` | T8 | M |
| T14 | UI: compose page (new/reply/reply-all/forward), send action, leave-page guard | T12, T13 | M |
| **M5: polish** | | | |
| T15 | Keyboard shortcuts, with `?` for help (**first to cut**) | T12, T14 | S |
| T16 | Responsive and accessibility pass, log audit | T14 | S |
| T17 | CLAUDE.md, README, a full live run of SC-1 to SC-10, the cost check | T16 | S |

**Parallel work:** S runs alongside T1–T4. T4 only needs T1. T6, T9 and T11 are pure core work and can run alongside the UI tasks before them.

## Checkpoints

- **After T5 (M1).** This is the one point where the plan might change shape.
  - SC-1 holds live.
  - The **8-day clock for SC-8 starts** here.
  - Report the spike results: the largest attachment that comes through, and whether Server Actions work behind CloudFront.
- **After T10 (M2):** SC-2, SC-3 and SC-4 hold live. This is the first version that's actually useful.
- **After T12 (M3):** SC-5 holds live.
- **After T14 (M4):** SC-6 holds live.
- **After T17:** SC-1 to SC-10 all pass, and the spec's status changes to Built.

## Key decisions

- **Copied from Trader, not shared.** OIDC, the session, `proxy.ts`, the packaging script and the Web Function construct are all ported from `~/src/trader/apps/dashboard` and `infra/lib/dashboard.ts`.
  - The session changes from HMAC-signed to **AES-256-GCM encrypted**, because it carries the refresh token.
  - The OAuth cookie (state, nonce, verifier) stays HMAC-signed, as in Trader.
  - The two repos don't share a package. Each stays small and deploys on its own.
- **No Gmail client library.** We call the endpoints we need directly: `labels.list`/`get`, `threads.list`/`get`/`modify`/`trash`/`untrash`, `messages.attachments.get`, `messages.send` and `token`/`revoke`. Each response is Zod-validated.
- **Access tokens** are minted in core (`google/token.ts`, with `fetch` injected). They're cached in a module-level `Map` keyed by `sha256(refreshToken)`, and expire 60 s early. A 401 drops the cached token and retries once.
- **Listing threads and the quota.** `threads.list` (25) is followed by `threads.get?format=metadata`, keeping only the From/To/Subject/Date headers, with **at most 10 requests in flight**. A 429 backs off and retries once. T7 measures this against the real inbox. If 429s show up, we switch to Gmail's batch endpoint (`/batch/gmail/v1`) and nothing outside `GmailMailbox` changes.
- **Sending** uses the media-upload endpoint (`/upload/gmail/v1/users/me/messages/send?uploadType=media`, `message/rfc822`). It accepts up to 35 MB, so forwarded attachments fit. The JSON `raw` form is far smaller.
- **Attachments:** Gmail returns attachment data as base64url inside JSON, so it can't stream. The route decodes it in memory and returns bytes with `Content-Disposition`, `X-Content-Type-Options: nosniff` and `no-store`. The ceiling is whatever T5's spike finds. Above it, the UI shows "too large to open here" instead of a link.
- **Server Actions behind CloudFront.** The Web Function sees its own `Host`, so Next's built-in Origin check would reject `mail.whitebirch.io`.
  - Set `experimental.serverActions.allowedOrigins` from `APP_URL`, **and** have every action call our own `assertOrigin`, as Trader's `commands.ts` does.
  - T5 proves this live. If Server Actions misbehave anyway, they fall back to route handlers with POST forms, Trader's pattern, and only `apps/web/**/actions.ts` changes.
- **Dates:** a tiny `<LocalTime>` client component formats them in the browser's time zone, so the server needs no TZ config.
- **The sliding session:** `proxy.ts` re-issues the cookie on `NextResponse.next()` when it's more than 24 h old.
- **The frame autosizer:** with `allow-same-origin` and no `allow-scripts`, the parent measures `contentDocument.body.scrollHeight` on load and on resize (`ResizeObserver`). No script runs inside the frame.
- **Branches:** work happens on feature branches, which run CI checks only. `main` deploys `MailProduction` through OIDC. The GitHub OIDC subject uses the org and repo **ids** (`repo:whitebirchio@<org-id>/mail@<repo-id>`), as Trader does. T4 reads them with `gh api` once the repo exists.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Web Functions or CloudFront cap response size well below typical attachments | Med | T5 measures the ceiling first. Larger files get a clear "too large" message, and Scott can still open them on his phone. If the cap is tiny, ask about a presigned-S3 hand-off, which would mean briefly storing a file (an Ask-first item). |
| Server Actions are rejected behind CloudFront (`Host`/`Origin` mismatch) | Med | `allowedOrigins`, proven in T5. Fallback: POST route handlers, confined to `actions.ts`. |
| Google doesn't issue a refresh token, or expires it in 7 days | High | `prompt=consent` + `access_type=offline` on every sign-in. The callback rejects a missing refresh token (tested). The consent screen goes to Production in step S. SC-8 starts timing at T5. |
| The work network blocks `accounts.google.com` | Med | A 30-day sliding session. Scott signs in from another network when he has to. |
| The sanitizer misses an XSS vector | High → Low | Defense in depth: the iframe never has `allow-scripts`, and its srcdoc carries its own CSP. The T9 corpus grows whenever a vector is found. |
| Gmail quota 429s while listing | Low | Bounded concurrency plus one retry; batch endpoint as a fallback (see Key decisions). |
| Real mail or secrets leak into the public repo | High | Gitleaks over all of history in CI. `.gitignore` covers `.env*`. Fixtures are synthetic only. No screenshots of the real inbox. CI never echoes secrets. |
| A merge to `main` breaks the only environment | Med | Gate plus synth on every branch. Local checks against the real inbox before merging. Rollback = revert and push (CI redeploys), or move the endpoint's `revisionWeights` back to the previous revision. |

## Open questions

None blocking. Step S needs Scott to act, and T4/T5 will print the exact steps.

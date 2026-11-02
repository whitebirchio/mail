# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mail is a small, single-user web client for Scott's Gmail (scott.schmalz@gmail.com), served at **mail.whitebirch.io**, so he can read and triage mail from a network that blocks gmail.com. The browser talks only to Mail, and the server calls the Gmail API. It's a **stateless passthrough** (ADR-001): no database, no cache of mail, nothing on disk. The scope is read, search, triage (archive, read/unread, star, trash, spam, each with Undo) and plain-text reply, reply-all, forward and compose. It deliberately isn't a Gmail clone; [SPEC.md](SPEC.md) lists what's out of scope.

The spec is [SPEC.md](SPEC.md). The plan and tasks are in [tasks/](tasks/). Conventions follow `~/src/trader` unless the spec says otherwise.

## Commands

Run from the repo root unless noted.

```sh
npm run typecheck && npm test             # the gate: run before every commit; mirrors CI
npm run test:watch -w @mail/core          # inner loop
npm run build -w mail-web                 # next build (standalone) → apps/web/dist/app, the CDK asset
npm run synth                             # cdk synth (CI runs it on every push)

# Local dev against the real mailbox (repo-root .env; see docs/SETUP.md):
npm run dev -w mail-web

# Local UI work with no Google client: an in-memory mailbox of invented mail, sign-in skipped.
# Only under `next dev`; production builds compile it out (config.ts, tested).
APP_URL=http://localhost:3000 OWNER_EMAIL=scott.schmalz@gmail.com GOOGLE_CLIENT_ID=dev.apps.googleusercontent.com \
  GOOGLE_CLIENT_SECRET=GOCSPX-fake-dev-only-xxxxxxxx SESSION_KEY=$(node -e 'console.log(Buffer.alloc(32,3).toString("base64url"))') \
  MAIL_DEV_FAKE=1 npm run dev -w mail-web
npm run smoke -w mail-web                 # with the fake running: clicks through the UI in the installed Chrome
```

The fake keeps its state across hot reloads (on `globalThis`). Restart `next dev` to reset it, or after changing the Mailbox port.

Local AWS commands use the SSO profile `whitebirch` (`aws sso login --profile whitebirch`).

## Environment and deploys

There's **one environment**: `production`, CDK stack `MailProduction` (Web Function `mail-web`), deployed by CI on push to `main` (ADR-002). Branches run the gate only. **Merging to `main` ships to the real inbox**, so check changes locally first, against the fake and then the real mailbox.
- `MailCerts` (the ACM certificate) and `MailCi` (the OIDC deploy role, which trusts only `main`) are deployed once from the laptop.
- Secrets are in SSM under `/mail/production/` (`GOOGLE_CLIENT_SECRET`, `SESSION_KEY`), written by `scripts/set-secrets.sh`.
- One-time setup is in [docs/SETUP.md](docs/SETUP.md).

## Architecture

The same shape as Trader's dashboard: **hexagonal core + thin Next.js shell**.

- **`packages/core` (`@mail/core`):** all logic and its tests. No Next, AWS or HTTP-framework deps.
  - `mailbox/port.ts`: the `Mailbox` port. `GmailMailbox` implements it in `gmail.ts`, using plain fetch with Zod-validated responses, one token refresh on a 401 and one back-off on a rate limit. `FakeMailbox` implements it in memory.
  - `message/parse.ts`: the Gmail payload tree → body and attachments. Gmail has already undone the transfer encoding; parse decodes by charset only.
  - `message/sanitize.ts`: email HTML → safe HTML, plus the frame's srcdoc and CSP.
  - `message/compose.ts`: reply/forward defaults and RFC 5322 output.
  - `actions.ts`: the triage verbs and their exact inverses (Undo).
  - `send.ts`: sending.
  - `views/`: the list and thread view models.
- **`apps/web` (`mail-web`):** the Next 16 App Router, running as a Lambda Web Function.
  - `proxy.ts` checks the session on every route except `/login` and `/auth/*`. It also slides the session, sets the CSP nonce and fails closed on bad config.
  - Pages are server components that call core.
  - Mutations are Server Actions that check the session **and** `assertOrigin`.
  - `/attachments/<msg>/<part>` streams part bytes. Its disposition is always `attachment`, it has its own sandbox CSP, and active types are served as octet-stream.
- **`infra` (`mail-infra`):** CDK. `AppStack` is a port of Trader's dashboard construct: the Web Function plus an IamAuth endpoint behind CloudFront OAC, and a role that can read exactly two SSM parameters.

## Invariants

- **Email HTML is hostile.** Sanitize it in core **and** render it only in `<MessageFrame>`: an iframe sandboxed **without `allow-scripts`**, whose srcdoc carries its own CSP. Remote images stay off until "Show images".
- **The browser never talks to Google** after sign-in. Attachment and inline-image bytes come through Mail.
- **The session cookie is AES-256-GCM encrypted**, because it carries the Google refresh token. Access tokens live in memory only. Tokens never reach the browser or the logs.
- **Logs carry routes, statuses, latencies and Gmail error codes only.** Never subjects, addresses, bodies, snippets, search queries or tokens.
- **Absolute URLs come from `APP_URL`.** Behind CloudFront the function sees its own Host.
- **Expected outcomes are status unions** (`Result<T>`, `TriageResult`, `SendResult`), not throws.
- **The repo is public:** fixtures are invented, and no real mail, screenshots of it or secrets ever get committed (gitleaks runs over all of history in CI).

## Testing

- **Core:** `packages/core/test/`, against synthetic Gmail JSON. There's an XSS corpus in `test/fixtures/xss.ts`; add a vector whenever one turns up.
- **Web:** `apps/web/test/` covers auth/OIDC, the session, proxy, config, downloads and the shortcut keymap.
- **Infra:** `infra/test/` pins IAM, OAC, the endpoint bounds and the CI role's trust.
- **Browser:** `apps/web/scripts/ui-smoke.mjs` (`npm run smoke`) runs against the dev fake.

## Boundaries

- **Always:**
  - Run the gate before committing.
  - Keep logic in core.
  - Sanitize **and** sandbox every email body.
  - Make every mutation a POST Server Action that checks Origin.
  - Use synthetic fixtures only.
  - Note each new dependency, and why, in its commit message.
- **Ask first:**
  - Adding an OAuth scope.
  - Storing any mail data server-side.
  - Adding a permanent-delete path.
  - Allowing a second email address.
  - Adding a staging environment.
  - AWS resources with a standing cost.
  - Changing CI deploy triggers.
  - Setting or rotating production secrets.
- **Never:**
  - Commit secrets, `.env*` or real mail.
  - Log content or tokens.
  - Send a token to the browser.
  - Let the browser call Google APIs.
  - Add `allow-scripts` to the message frame.
  - Serve an attachment inline from our origin.

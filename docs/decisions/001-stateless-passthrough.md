# ADR-001: A stateless passthrough

**Status:** Accepted (Scott, 2026-11-02)

## Context
Mail lets Scott read his Gmail from a network that blocks gmail.com. Gmail already stores everything and syncs it to his other devices. A second copy of the mailbox would be a second thing to secure, back up and keep consistent.

## Decision
The server stores no mail: no database, no message cache, nothing on disk. Every page is built from live Gmail API calls.
- The only credential is the Google refresh token. It lives in the browser's session cookie, encrypted with AES-256-GCM under `SESSION_KEY` (from SSM).
- Access tokens are cached in memory only.
- Logs record routes, statuses, latencies and Gmail error codes. They never record content, addresses, queries or tokens.

## Consequences
- **Nothing to breach at rest.** A server-side compromise exposes in-flight requests, not an archive.
- **No sync bugs.** Gmail is the only source of truth, and Mail's actions show up everywhere immediately.
- **Every page costs Gmail API calls**, so latency and quota depend on Gmail's API.
- **Rotating `SESSION_KEY`** signs everyone out and forgets the refresh token. Signing in again mints a new one.
- **Adding any server-side storage of mail data is an Ask-first change** (SPEC.md boundaries).

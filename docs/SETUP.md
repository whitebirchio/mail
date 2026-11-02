# Setup

One-time account setup, plus the procedures that touch credentials. Everything else is `git push` to `main` (ADR-002).

## Accounts

| What | Where | Notes |
|---|---|---|
| GitHub repo | `whitebirchio/mail` (**public**) | One Actions variable, `AWS_DEPLOY_ROLE_ARN`. No secrets in GitHub. |
| AWS | The same account as Trader, `us-east-1` | SSO profile `whitebirch`. CDK is already bootstrapped (Trader's SETUP). |
| Google Cloud | Project `whitebirch-mail` | Gmail API, consent screen, the OAuth client |
| Cloudflare | Scott's account | DNS for whitebirch.io: the certificate's validation CNAME and `mail` → CloudFront, both **DNS only** |

## 1. Google Cloud (Scott)

Do this in [console.cloud.google.com](https://console.cloud.google.com), signed in as the owner.

1. **Create a project.** Use the project picker → **New project**. Name it `whitebirch-mail`, with no organization.
2. **Enable the Gmail API.** Go to **APIs & Services → Library**, search for "Gmail API" and click **Enable**.
3. **Set up the consent screen.** Open **Google Auth Platform** (APIs & Services → OAuth consent screen).
   - **Branding:**
     - App name `Mail`;
     - support email and developer contact: the owner's address;
     - **Application home page:** `https://mail.whitebirch.io`;
     - **Application privacy policy link:** `https://mail.whitebirch.io/privacy` (a public page in the app);
     - **Authorized domains:** `whitebirch.io`;
     - leave the logo empty. A logo would trigger brand verification.

     Google requires the home page and privacy policy before an External app can be published.
   - **Audience:** User type **External**.
   - **Data Access → Add or remove scopes.** Add:
     - `openid`;
     - `.../auth/userinfo.email`;
     - `https://www.googleapis.com/auth/gmail.modify`. You may have to paste it under "Manually add scopes". It's listed as a restricted scope.

     Save.
   - **Audience → Publish app.** Confirm **Push to production**. Google will say the app needs verification, and it can stay unverified: that's fine for one user (fewer than 100).
     - **Don't leave it in Testing.** Testing refresh tokens expire after 7 days (SPEC.md, SC-8).
4. **Create the OAuth client.** Go to **Clients → Create client**, with type **Web application** and name `Mail`.
   - **Authorized redirect URIs:**
     - `https://mail.whitebirch.io/auth/callback`
     - `http://localhost:3000/auth/callback`
   - Leave **Authorized JavaScript origins** empty.
   - Create it, then copy the **Client ID** and **Client secret**.
5. **Store the credentials.** In the repo root `.env` (gitignored; start from `.env.example`):
   ```sh
   cp .env.example .env    # then fill in:
   GOOGLE_CLIENT_ID=….apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-…
   ```
   Then put the client id (it's public) in `infra/lib/config.ts` as `GOOGLE_CLIENT_ID`.
6. **First sign-in** (on any network, once there's a running app):
   - Google shows **"Google hasn't verified this app."** Click **Advanced → Go to Mail (unsafe)**.
   - On the consent screen, **leave the Gmail box ticked**. Mail refuses a sign-in without it.

**Check it locally:** run `npm run dev -w mail-web`, open http://localhost:3000 and sign in. It should say "Signed in as …". Any other Google account gets a 403.

## 2. GitHub (Scott)

1. Create **`whitebirchio/mail`**, public, with no README, licence or .gitignore (the repo brings its own).
2. Tell Claude it exists. Claude then:
   - reads the immutable OIDC subject (`gh api repos/whitebirchio/mail/actions/oidc/customization/sub`) into `infra/lib/config.ts` (`GITHUB_OIDC_SUBJECT_PREFIX`);
   - adds the remote and pushes `main`.

## 3. AWS (Scott runs these; each needs `aws sso login --profile whitebirch` first)

1. **Certificate** (`MailCerts`). Deploy it, then add its validation record in Cloudflare:
   ```sh
   npm run build -w mail-web   # synth needs the packaged app
   npm run deploy:certs -w mail-infra -- --profile whitebirch
   ```
   While this waits, look up the validation record. In another terminal:
   ```sh
   aws acm list-certificates --profile whitebirch --region us-east-1 --query "CertificateSummaryList[?DomainName=='mail.whitebirch.io'].CertificateArn" --output text
   aws acm describe-certificate --certificate-arn <arn> --profile whitebirch --region us-east-1 --query "Certificate.DomainValidationOptions[0].ResourceRecord"
   ```
   In Cloudflare, add a **CNAME** with name `_….mail` and target `_….acm-validations.aws.`, set to **DNS only**. **Keep it there**: it's how the certificate renews. The deploy finishes once ACM sees the record, usually within a few minutes.
2. **CI role** (`MailCi`). Deploy it after step 2.2, once the OIDC subject is in the config:
   ```sh
   npm run deploy:ci -w mail-infra -- --profile whitebirch --require-approval never
   ```
   (`--require-approval never`, because the `!` shell can't answer CDK's IAM prompt. Review `npx cdk diff MailCi` first.)

   The role trusts **only `main`** of `whitebirchio/mail`. Then set the repo variable:
   ```sh
   gh variable set AWS_DEPLOY_ROLE_ARN -R whitebirchio/mail -b "arn:aws:iam::$(aws sts get-caller-identity --profile whitebirch --query Account --output text):role/mail-github-deploy"
   ```
3. **Secrets.** This writes `GOOGLE_CLIENT_SECRET` and a generated `SESSION_KEY` from `.env` to SSM. It prints only names.
   ```sh
   scripts/set-secrets.sh
   ```
4. **First deploy:** push or merge to `main`, and CI deploys `MailProduction`. To deploy from the laptop instead, run `npm run build -w mail-web && npm run deploy -w mail-infra -- --profile whitebirch`.
5. **DNS:** in Cloudflare, add a `mail` **CNAME** to the stack output `Cname` (a `….cloudfront.net` name), set to **DNS only**.
6. **Verify:**
   - https://mail.whitebirch.io → Google sign-in → "Signed in as …".
   - A second Google account gets a 403.
   - The stack output `RawEndpoint` refuses you: `curl -s -o /dev/null -w '%{http_code}' <RawEndpoint>` prints `403`.

## Reference

- **Secrets:** stored in SSM under `/mail/production/` (`GOOGLE_CLIENT_SECRET`, `SESSION_KEY`). The function reads exactly these two, cached for 15 minutes.
  - **Rotate the client secret:** in Google Cloud, add a new secret to the client, put it in `.env`, run `scripts/set-secrets.sh`, wait 15 minutes, then disable the old secret.
  - **Rotate the session key:** delete `SESSION_KEY` from `.env`, run `scripts/set-secrets.sh`, and wait 15 minutes. **This signs everyone out.**
- **Sign out** revokes the Google grant. You can also revoke it by hand at [myaccount.google.com/connections](https://myaccount.google.com/connections) → Mail.
- **Logs** go to `/aws/lambda/web/mail-web` (and `.local`), kept for 30 days. Sign-ins log `signed in` or `sign-in refused` with a reason. Logs never contain mail content, addresses, queries or tokens (SPEC.md, Security model 7).
- **Rollback:** revert on `main` and push, and CI redeploys. To roll back faster, point the endpoint's `revisionWeights` at the previous revision in the console.

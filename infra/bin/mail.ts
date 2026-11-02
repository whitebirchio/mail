import { App } from "aws-cdk-lib";
import { fileURLToPath } from "node:url";
import { AppStack } from "../lib/app-stack.js";
import { CertsStack } from "../lib/certs-stack.js";
import { CiStack } from "../lib/ci-stack.js";
import { GITHUB_OIDC_SUBJECT_PREFIX, REGION } from "../lib/config.js";

// Account comes from the CLI profile (`--profile whitebirch` locally, the OIDC role in CI).
const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

if (GITHUB_OIDC_SUBJECT_PREFIX) new CiStack(app, "MailCi", { env, subjectPrefix: GITHUB_OIDC_SUBJECT_PREFIX });
// Deployed once from the laptop (DNS validation waits on the Cloudflare record); MailProduction references it.
const certs = new CertsStack(app, "MailCerts", { env });
// Built by `npm run build -w mail-web` before synth or deploy.
new AppStack(app, "MailProduction", { env, certificate: certs.certificate, codeDir: fileURLToPath(new URL("../../apps/web/dist/app", import.meta.url)) });

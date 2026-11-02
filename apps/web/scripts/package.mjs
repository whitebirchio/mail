// Turn Next's standalone output into the Lambda Web Function's code directory
// (dist/app; CDK zips it). The runtime loads index.js at the root and waits for
// a server on AWS_LAMBDA_HTTP_ENDPOINT; Next's server reads HOSTNAME and PORT.
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../dist/app/");
rmSync(here("../dist/"), { recursive: true, force: true });
cpSync(here("../.next/standalone/"), out, { recursive: true });
// Standalone output leaves static assets and public/ to the host.
cpSync(here("../.next/static/"), `${out}apps/web/.next/static/`, { recursive: true });
if (existsSync(here("../public/"))) cpSync(here("../public/"), `${out}apps/web/public/`, { recursive: true });
writeFileSync(
  `${out}index.js`,
  `const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? "127.0.0.1:3000";
const at = endpoint.lastIndexOf(":");
process.env.HOSTNAME = endpoint.slice(0, at);
process.env.PORT = endpoint.slice(at + 1);
// Lambda spins idle environments down with SIGTERM; Next's standalone server
// doesn't handle it, so exit cleanly instead of reporting a runtime error.
process.on("SIGTERM", () => process.exit(0));
await import("./apps/web/server.js");
`,
);
writeFileSync(`${out}package.json`, JSON.stringify({ type: "module", private: true }));
// Secrets come from SSM at runtime. Next's standalone output can carry .env
// files along; refuse to package one.
const envFiles = readdirSync(out, { recursive: true }).filter((f) => /(^|\/)\.env(\.|$)/.test(String(f)));
if (envFiles.length > 0) {
  console.error(`refusing to package env files: ${envFiles.join(", ")}`);
  process.exit(1);
}
console.log("packaged dist/app");

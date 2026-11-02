import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default function config(phase: string): NextConfig {
  // Local dev reads the repo-root .env (secrets included, gitignored). Deployed
  // builds never do: there, config comes from the Web Function and SSM.
  if (phase === PHASE_DEVELOPMENT_SERVER && existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);
  return {
    // A self-contained server for the Lambda Web Function.
    output: "standalone",
    // Trace from the repo root so the workspace's @mail/core is included.
    outputFileTracingRoot: root,
    turbopack: { root },
    transpilePackages: ["@mail/core"],
    poweredByHeader: false,
    // Behind CloudFront the function sees its own Host, so Next's Server
    // Action check must be told the public origin. Every action also checks
    // Origin itself (lib/origin.ts).
    experimental: { serverActions: { allowedOrigins: ["mail.whitebirch.io"] } },
  };
}

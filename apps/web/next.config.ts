import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the Lambda Web Function.
  output: "standalone",
  // Trace from the repo root so the workspace's @mail/core is included.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  turbopack: { root: fileURLToPath(new URL("../../", import.meta.url)) },
  transpilePackages: ["@mail/core"],
  poweredByHeader: false,
};

export default nextConfig;

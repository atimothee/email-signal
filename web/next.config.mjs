import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin tracing to the web/ folder so Next ignores the repo-root package.json
  // and the extension build at the root entirely.
  outputFileTracingRoot: __dirname,
  experimental: {
    optimizePackageImports: ["framer-motion"],
  },
};

export default nextConfig;

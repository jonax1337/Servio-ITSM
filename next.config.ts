import type { NextConfig } from "next";

// Applied to every route (pages, API, static assets).
const SECURITY_HEADERS = [
  // Harmless on plain-http dev; enforces HTTPS (incl. subdomains) in production.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No legitimate embed use-case exists (portal + public /survey are top-level pages).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Starter CSP — enable once inline scripts/styles have been audited. Next.js
  // injects inline bootstrap scripts, so a strict policy needs nonces/hashes;
  // this permissive-but-framed starter is a reasonable first step:
  // { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The Claude Agent SDK locates and spawns the Claude Code CLI at runtime; bundling it
  // makes Turbopack trace OS paths from its source (e.g. C:/Windows/System32/where.exe).
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

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

// proxy.ts runs on every request, so Next.js buffers request bodies for it — by
// default only the first 10 MB, silently dropping the rest. Uploads up to the
// 15 MB cap (MAX_UPLOAD_MB / Settings › Uploads) then failed as "could not parse".
// The limit is fixed at BUILD time; 32 MB covers the default cap plus multipart
// overhead without letting any request buffer far more than an upload can use.
// Raise it with PROXY_MAX_BODY_MB at build time if you allow bigger uploads.
const PROXY_MAX_BODY_MB = Number(process.env.PROXY_MAX_BODY_MB) || 32;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize: `${PROXY_MAX_BODY_MB}mb`,
  },
  // The Claude Agent SDK locates and spawns the Claude Code CLI at runtime; bundling it
  // makes Turbopack trace OS paths from its source (e.g. C:/Windows/System32/where.exe).
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

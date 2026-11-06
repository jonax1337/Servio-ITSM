import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

// ---------------------------------------------------------------------------
// SSRF guard for outbound webhooks. Admin-configured URLs are still attacker-
// influenced (a compromised manager, or a rule pointed at cloud metadata /
// internal services), so we resolve the host and refuse any private, loopback,
// link-local or reserved address before connecting, and never follow redirects.
// ---------------------------------------------------------------------------

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  if (a === 0) return true; // 0.0.0.0/8 ("this host")
  if (a === 10) return true; // 10/8 (RFC1918)
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 (RFC1918)
  if (a === 192 && b === 168) return true; // 192.168/16 (RFC1918)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24 (IETF)
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true; // loopback / unspecified
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isPrivateV4(mapped[1]);
  if (s.startsWith("fe80")) return true; // link-local
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique-local fc00::/7
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateV4(ip);
  if (fam === 6) return isPrivateV6(ip);
  return true; // not a literal IP → treat as unsafe
}

/**
 * Validate an outbound URL: http(s) only, and every resolved address must be a
 * public unicast address. Throws on anything unsafe. Returns the parsed URL.
 */
export async function assertSafePublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const addrs = await dnsLookup(url.hostname, { all: true });
  if (addrs.length === 0) throw new Error("Host did not resolve");
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new Error("URL resolves to a private/reserved address");
  }
  return url;
}

// ---------------------------------------------------------------------------
// safeFetch: SSRF-hard outbound HTTP that closes the DNS-rebinding / TOCTOU gap.
//
// assertSafePublicUrl() alone is racy: between the pre-check resolve and the
// actual fetch, DNS can rebind the host to an internal IP (or a round-robin set
// can hand the socket a private address). Here we resolve the host ONCE, pin the
// connection to a validated IP via a custom socket `lookup`, and — belt and
// braces — reject in the connect callback if the peer the socket actually
// reached is not in the validated set. The original Host/SNI is preserved so
// virtual-hosted and TLS endpoints still work. Redirects are never followed
// (a public host must not be able to 302 us onto an internal one).
// ---------------------------------------------------------------------------

const asFamily = (family: unknown): 4 | 6 | null => {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return null;
};

/**
 * A socket `lookup` that only ever answers with the already validated addresses, and
 * re-checks each one (defence in depth against a resolver that would otherwise return a
 * fresh, rebound answer). Node's connect (autoSelectFamily, the default since Node 20)
 * asks for every address (`all: true`) so it can fall back from IPv6 to IPv4; it rejects
 * a plain string answer with "Invalid IP address: undefined". A requested `family` is honoured.
 */
export function pinnedLookup(validated: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const family = asFamily(options.family);
    const usable = validated.filter(
      (a) => !isPrivateAddress(a.address) && (family === null || a.family === family),
    );
    if (usable.length === 0) {
      callback(new Error("URL resolves to a private/reserved address"), "", 0);
      return;
    }
    if (options.all) callback(null, usable.map(({ address, family: f }) => ({ address, family: f })));
    else callback(null, usable[0].address, usable[0].family);
  };
}

export type SafeFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  /** Hard cap on the response body we will buffer. Default 5 MiB. */
  maxBytes?: number;
};

export type SafeFetchResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB

/**
 * SSRF-hardened fetch. Resolves the host once, validates every candidate
 * address, pins the connection to those validated IPs, verifies the connected
 * peer, forbids redirects, and enforces a byte cap + timeout. Throws on any
 * unsafe condition (private target, rebinding, redirect, oversize, timeout).
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const url = await assertSafePublicUrl(rawUrl);
  const method = (opts.method ?? "GET").toUpperCase();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // The validated address set for THIS request. The custom lookup only ever
  // hands the socket layer one of these, and the connect check re-asserts it.
  const validated = (await dnsLookup(url.hostname, { all: true })).filter((a) => !isPrivateAddress(a.address));
  if (validated.length === 0) throw new Error("URL resolves to a private/reserved address");
  const validatedSet = new Set(validated.map((a) => a.address));

  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  // Preserve the original Host so virtual hosts / TLS SNI keep working even
  // though we connect by IP.
  headers.host = headers.host ?? url.host;

  return await new Promise<SafeFetchResponse>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname, // used for TLS SNI / certificate validation
        servername: isHttps ? url.hostname : undefined,
        port,
        method,
        path: `${url.pathname}${url.search}`,
        headers,
        lookup: pinnedLookup(validated),
        timeout: timeoutMs,
      },
      (res) => {
        // Verify the socket actually connected to a validated peer.
        const peer = res.socket.remoteAddress ?? "";
        const normalizedPeer = peer.replace(/^::ffff:/i, "");
        if (
          isPrivateAddress(normalizedPeer) ||
          (!validatedSet.has(peer) && !validatedSet.has(normalizedPeer))
        ) {
          res.destroy();
          req.destroy();
          done(() => reject(new Error("Connected peer is not a validated public address")));
          return;
        }
        // Never follow redirects: a validated host must not bounce us internal.
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.destroy();
          req.destroy();
          done(() => reject(new Error("Redirect responses are not allowed")));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            res.destroy();
            req.destroy();
            done(() => reject(new Error("Response exceeded the maximum allowed size")));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const outHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") outHeaders[k] = v;
            else if (Array.isArray(v)) outHeaders[k] = v.join(", ");
          }
          const status = res.statusCode ?? 0;
          done(() =>
            resolve({
              ok: status >= 200 && status < 300,
              status,
              headers: outHeaders,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        });
        res.on("error", (e) => done(() => reject(e)));
      },
    );

    req.on("timeout", () => {
      req.destroy();
      done(() => reject(new Error("Request timed out")));
    });
    req.on("error", (e) => done(() => reject(e)));

    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}

/**
 * SSRF-guarded fetch for webhooks: validates the URL, forbids redirects (so a
 * public host can't 302 to an internal one), and caps the request with a
 * timeout. Never throws for the caller's benefit is NOT assumed — wrap in
 * try/catch if best-effort.
 */
export async function safeWebhookFetch(rawUrl: string, body: unknown, timeoutMs = 5000): Promise<void> {
  // Route through safeFetch so the connection is IP-pinned (no DNS rebinding),
  // redirects are refused, and the response is capped.
  await safeFetch(rawUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
  });
}

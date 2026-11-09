/**
 * Dev-only local mail loop against a GreenMail server (no external mailbox).
 *
 * Start GreenMail first (Java standalone, ports SMTP 3025 / IMAP 3143), then:
 *   pnpm exec tsx --env-file=.env scripts/dev-mailtest.ts --send --subject "VPN kaputt" --text "Bitte helfen"
 *   pnpm exec tsx --env-file=.env scripts/dev-mailtest.ts --poll     # pull via real IMAP → tickets
 *
 * --send flags: --from --to --subject --text --inreplyto
 * Override endpoints: --smtp-host --smtp-port --imap-host --imap-port --user --pass
 * --poll flags: --folder --disposition seen|move|delete --processed-folder
 */
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { pollImap } from "@/lib/mail-inbound/imap";
import { parseDisposition } from "@/lib/mail-inbound/disposition";
import { processInboundMail } from "@/lib/mail-inbound/process";
import { setSetting } from "@/lib/settings";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function send() {
  const host = arg("smtp-host", "localhost")!;
  const port = Number(arg("smtp-port", "3025"));
  const to = arg("to", "support@localhost")!;
  const from = arg("from", "customer@example.com")!;
  const subject = arg("subject", "Test von einem Kunden")!;
  const text = arg("text", "Hallo Support,\n\ndies ist eine echte Test-Mail über GreenMail.\n\nDanke!")!;
  const inReplyTo = arg("inreplyto");

  const cc = (arg("cc", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const transport = nodemailer.createTransport({ host, port, secure: false });
  const info = await transport.sendMail({
    from,
    to,
    cc: cc.length ? cc : undefined,
    subject,
    text,
    headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: inReplyTo } : undefined,
  });
  console.log(`✓ sent to ${to}${cc.length ? ` (cc ${cc.join(", ")})` : ""} via ${host}:${port} — messageId ${info.messageId}`);
}

async function poll() {
  const res = await pollImap(
    {
      host: arg("imap-host", "localhost")!,
      port: Number(arg("imap-port", "3143")),
      secure: has("imap-secure"),
      user: arg("user", "support@localhost")!,
      pass: arg("pass", "test")!,
      folder: arg("folder", "INBOX")!,
      tlsRejectUnauthorized: false,
      disposition: parseDisposition(arg("disposition", "seen")),
      processedFolder: arg("processed-folder", "Processed")!,
      retentionDays: 0,
    },
    async (mail) => {
      const r = await processInboundMail(mail);
      const detail = "ticketId" in r && r.ticketId ? ` #${r.ticketId}` : "reason" in r ? ` (${r.reason})` : "";
      console.log(`  · ${mail.fromEmail} "${mail.subject}" → ${r.action}${detail}`);
    },
  );
  console.log(`✓ poll done — processed=${res.processed} failed=${res.failed}`);
}

/** Point Servio's SMTP + IMAP settings at the local GreenMail server. */
async function setup() {
  const pairs: [string, string][] = [
    ["SMTP_HOST", "localhost"], ["SMTP_PORT", "3025"], ["SMTP_SECURE", "false"],
    ["SMTP_FROM", "Servio Support <support@localhost>"],
    ["IMAP_ENABLED", "true"], ["IMAP_HOST", "localhost"], ["IMAP_PORT", "3143"],
    ["IMAP_SECURE", "false"], ["IMAP_USER", "support@localhost"], ["IMAP_PASS", "test"],
    ["IMAP_FOLDER", "INBOX"], ["IMAP_POLL_SECONDS", "15"], ["IMAP_TLS_REJECT_UNAUTHORIZED", "false"],
  ];
  for (const [k, v] of pairs) await setSetting(k, v);
  console.log("✓ Servio SMTP + IMAP now point at GreenMail (poll every 15s). Restart the dev server to pick up the scheduler interval.");
}

/** Remove the GreenMail overrides so nothing keeps polling after it stops. */
async function teardown() {
  for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_FROM", "IMAP_ENABLED", "IMAP_HOST", "IMAP_PORT", "IMAP_SECURE", "IMAP_USER", "IMAP_PASS", "IMAP_FOLDER", "IMAP_POLL_SECONDS", "IMAP_TLS_REJECT_UNAUTHORIZED"]) {
    await setSetting(k, "");
  }
  console.log("✓ GreenMail overrides removed (settings fall back to .env).");
}

async function main() {
  if (has("setup")) await setup();
  if (has("teardown")) await teardown();
  if (has("send")) await send();
  if (has("poll")) await poll();
  if (!has("send") && !has("poll") && !has("setup") && !has("teardown")) {
    console.log("Nothing to do — pass --setup / --send / --poll / --teardown");
  }
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect().catch(() => {}); process.exit(1); });

/**
 * Owner alerts through Cloudflare's send_email binding, which is free on every
 * plan when the destination is a verified address of the account. Without the
 * binding the alert is only logged, so the tick never depends on it.
 */
import type { Env } from "../types";
import { edgeGet, edgePut } from "../edgecache";

export async function alert(env: Env, kind: string, subject: string, text: string): Promise<void> {
  console.error(`[alert:${kind}] ${subject}\n${text}`);
  if (!env.ALERT || !env.ALERT_EMAIL) return;
  // One alert per kind per UTC day; the edge cache is per data centre, so a repeat may slip through, which is fine.
  const key = `alert:${kind}:${new Date().toISOString().slice(0, 10)}`;
  if (await edgeGet<string>(key)) return;
  await edgePut(key, "1", 26 * 3600);
  const from = `Today's Daf alerts <alerts@${env.CANONICAL_HOST ?? "daf-yomi.dev"}>`;
  try {
    await env.ALERT.send({ from, to: env.ALERT_EMAIL, subject: `[daf-yomi] ${subject}`, text });
  } catch (e) {
    // Fall back to a hand-built text/plain message if the structured form is refused.
    try {
      const { EmailMessage } = await import("cloudflare:email");
      const raw = [
        `From: ${from}`, `To: ${env.ALERT_EMAIL}`, `Subject: [daf-yomi] ${subject}`,
        `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${env.CANONICAL_HOST ?? "daf-yomi.dev"}>`,
        "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", text,
      ].join("\r\n");
      await env.ALERT.send(new EmailMessage(`alerts@${env.CANONICAL_HOST ?? "daf-yomi.dev"}`, env.ALERT_EMAIL, raw));
    } catch (e2) {
      console.error("[alert] send failed", e, e2);
    }
  }
}

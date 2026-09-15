import { loadConfig } from "../config/env.ts";
import { log } from "../logs/logger.ts";
import { markNewsletter, dueNewsletters, pendingDigest, type QueuedNewsletter } from "./queue.ts";
import type { Newsletter } from "./buildNewsletter.ts";

export interface DispatchResult {
  attempted: number;
  sent: number;
  failed: number;
  /** Set when nothing could be attempted at all — no provider, or no recipients. */
  blocked?: string;
}

/**
 * Sends what is due.
 *
 * There is no mail provider configured on this project, and one is not
 * invented here. When the configuration is absent this refuses to run and
 * says so: an issue stays `queued`, never silently marked `sent`. A
 * newsletter wrongly recorded as delivered is worse than one plainly
 * waiting — it is the kind of quiet false success that hides for weeks.
 */
export async function dispatchDue(now = new Date()): Promise<DispatchResult> {
  const due = dueNewsletters(now);
  const blocked = providerProblem();
  if (blocked) {
    log("NEWSLETTER", `Envoi impossible — ${blocked}. ${due.length} numéro(s) restent en file, aucun marqué envoyé.`);
    return { attempted: 0, sent: 0, failed: 0, blocked };
  }

  let sent = 0;
  let failed = 0;
  for (const entry of due) {
    try {
      await sendOne(entry.newsletter);
      markNewsletter(entry.id, { status: "sent", sentAt: new Date().toISOString() });
      sent++;
      log("NEWSLETTER", `Envoyé — ${entry.newsletter.subject}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markNewsletter(entry.id, { status: "failed", error: message });
      failed++;
      log("NEWSLETTER", `ÉCHEC — ${entry.newsletter.subject} — ${message}`);
    }
  }
  return { attempted: due.length, sent, failed };
}

/** Gathers everything waiting in digest mode into a single issue, without sending it — assembling and sending are separate decisions. */
export function buildDigest(): { issues: QueuedNewsletter[]; subject: string; html: string; text: string } | undefined {
  const pending = pendingDigest();
  if (pending.length === 0) return undefined;

  const subject = pending.length === 1 ? pending[0]!.newsletter.subject : `Journal WEBLACK — ${pending.length} articles`;
  const items = pending.map((entry) => entry.newsletter);

  return {
    issues: pending,
    subject,
    text: ["WEBLACK — Journal", "", ...items.flatMap((n) => [n.subject, n.preheader, n.articleUrl, ""])].join("\n"),
    html: digestHtml(items),
  };
}

function digestHtml(items: Newsletter[]): string {
  const entries = items
    .map(
      (n) => `<tr><td style="padding:0 32px 28px;">
        <h2 style="margin:0 0 8px;font-size:19px;line-height:1.3;font-weight:600;color:#141414;">${escapeHtml(n.subject)}</h2>
        <p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#57534b;">${escapeHtml(n.preheader)}</p>
        <a href="${escapeHtml(n.articleUrl)}" style="font-size:14px;color:#141414;">Lire l'article →</a>
      </td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f3f1;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f1;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
      <tr><td style="padding:32px 32px 24px;">
        <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8a8577;">WEBLACK — Journal</p>
      </td></tr>
      ${entries}
    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Returns the reason dispatch cannot proceed, or undefined when it can. */
export function providerProblem(): string | undefined {
  const config = loadConfig();
  if (!config.newsletterProvider) return "aucun NEWSLETTER_PROVIDER configuré (voir .env.example)";
  if (config.newsletterProvider !== "resend") return `fournisseur "${config.newsletterProvider}" non implémenté`;
  if (!config.newsletterApiKey) return "NEWSLETTER_API_KEY absent";
  if (!config.newsletterFrom) return "NEWSLETTER_FROM absent";
  if (config.newsletterAudienceId === undefined || config.newsletterAudienceId === "") return "NEWSLETTER_AUDIENCE_ID absent";
  return undefined;
}

async function sendOne(newsletter: Newsletter): Promise<void> {
  const config = loadConfig();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.newsletterApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.newsletterFrom,
      to: config.newsletterAudienceId,
      subject: newsletter.subject,
      html: newsletter.html,
      text: newsletter.text,
    }),
  });
  if (!response.ok) {
    // The body can echo request details; the key is never in it, and is never logged.
    throw new Error(`Resend a refusé l'envoi (HTTP ${response.status})`);
  }
}

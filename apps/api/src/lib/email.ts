import { env } from '../env.js';

export interface EmailMessage {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text?: string;
}

/** Test hook: every message "sent" while no Brevo key is configured. */
export const outbox: EmailMessage[] = [];

/**
 * Sends through Brevo's transactional API. Without a key (local dev, tests)
 * the message is logged and kept in `outbox` instead of sent.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean; id?: string }> {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    outbox.push(msg);
    if (outbox.length > 200) outbox.shift();
    if (env.NODE_ENV !== 'test') console.info('[email:dry-run]', msg.to.email, '-', msg.subject);
    return { sent: false };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
      to: [msg.to],
      subject: msg.subject,
      htmlContent: msg.html,
      ...(msg.text ? { textContent: msg.text } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { messageId?: string };
  return { sent: true, id: body.messageId };
}

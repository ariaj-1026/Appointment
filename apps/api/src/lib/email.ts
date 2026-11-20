import { env } from '../env.js';

export interface EmailMessage {
  to: { email: string; name?: string };
  subject: string;
  html: string;
}

/**
 * Sends through Brevo's transactional API. Without a key (local dev) the
 * message is logged instead, so flows can be tested without sending mail.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean; id?: string }> {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    console.info('[email:dry-run]', msg.to.email, '-', msg.subject);
    return { sent: false };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
      to: [msg.to],
      subject: msg.subject,
      htmlContent: msg.html,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { messageId?: string };
  return { sent: true, id: body.messageId };
}

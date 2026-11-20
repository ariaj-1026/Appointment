/**
 * Email templates. Plain, inline-styled HTML that renders in every mail client,
 * plus a text version. All interpolated values are HTML-escaped.
 */
import { env } from '../env.js';

export interface Email {
  subject: string;
  html: string;
  text: string;
}

export interface VisitInfo {
  patient_name: string;
  service: string;
  staff: string;
  /** e.g. "Mon 23 Nov 2026" */
  date: string;
  /** e.g. "09:00" */
  time: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const clinic = () => env.BREVO_SENDER_NAME;

function layout(heading: string, paragraphs: string[], cta?: { label: string; url: string }): Email {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0"><a href="${esc(cta.url)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:10px;padding:28px">
<tr><td><p style="margin:0 0 6px;font-size:13px;color:#6b7280">${esc(clinic())}</p>
<h1 style="margin:0 0 18px;font-size:20px">${esc(heading)}</h1>${body}${button}
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">This is an automated message — please do not reply.</p>
</td></tr></table></td></tr></table></body></html>`;
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const text = [heading, '', ...paragraphs.map(strip), ...(cta ? ['', `${cta.label}: ${cta.url}`] : [])].join('\n');
  return { subject: heading, html, text };
}

const visit = (v: VisitInfo) =>
  `<strong>${esc(v.service)}</strong> with <strong>${esc(v.staff)}</strong> on <strong>${esc(v.date)}</strong> at <strong>${esc(v.time)}</strong>`;
const portal = () => ({ label: 'View my appointments', url: `${env.WEB_ORIGIN}/portal` });
const hi = (v: VisitInfo) => `Hi ${esc(v.patient_name)},`;
const why = (reason?: string | null) => (reason ? [`Reason: ${esc(reason)}`] : []);

export const templates = {
  requestReceived: (v: VisitInfo) =>
    layout('We received your appointment request', [hi(v), `Your request for ${visit(v)} is waiting for confirmation from the clinic. We will email you once it is approved.`], portal()),

  approved: (v: VisitInfo) =>
    layout('Your appointment is confirmed', [hi(v), `Your appointment for ${visit(v)} has been approved. See you then!`], portal()),

  declined: (v: VisitInfo, reason?: string | null) =>
    layout('Your appointment request was declined', [hi(v), `Unfortunately the clinic could not accept your request for ${visit(v)}.`, ...why(reason), 'You are welcome to request another time.'], portal()),

  bookedByClinic: (v: VisitInfo) =>
    layout('An appointment was booked for you', [hi(v), `The clinic has booked ${visit(v)} for you.`], portal()),

  changedByClinic: (v: VisitInfo, previous: string, reason?: string | null) =>
    layout('Your appointment was changed', [hi(v), `The clinic moved your appointment (previously ${esc(previous)}). It is now ${visit(v)}.`, ...why(reason)], portal()),

  cancelledByClinic: (v: VisitInfo, reason?: string | null) =>
    layout('Your appointment was cancelled', [hi(v), `The clinic cancelled your appointment for ${visit(v)}.`, ...why(reason), 'Please request a new time if you still need a visit.'], portal()),

  cancelConfirmed: (v: VisitInfo) =>
    layout('Your appointment is cancelled', [hi(v), `As requested, your appointment for ${visit(v)} has been cancelled.`], portal()),

  rescheduleRequested: (v: VisitInfo) =>
    layout('We received your reschedule request', [hi(v), `You asked to move your appointment to ${visit(v)}. The clinic will confirm the new time by email.`], portal()),

  reminder: (v: VisitInfo, when: '24h' | '2h') =>
    layout(when === '2h' ? 'Your appointment is in 2 hours' : 'Appointment reminder: tomorrow', [hi(v), `This is a reminder of your appointment: ${visit(v)}.`, 'If you can no longer attend, please let the clinic know.'], portal()),

  passwordReset: (name: string, url: string) =>
    layout('Reset your password', [`Hi ${esc(name)},`, 'Someone (hopefully you) asked to reset the password for your account. The link below works for one hour.', 'If you did not ask for this, you can ignore this email.'], { label: 'Choose a new password', url }),

  staffWelcome: (name: string, email: string, role: string) =>
    layout('Your clinic account is ready', [`Hi ${esc(name)},`, `An administrator created a <strong>${esc(role)}</strong> account for you (<strong>${esc(email)}</strong>). Ask them for your temporary password, then sign in and change it.`], { label: 'Sign in', url: `${env.WEB_ORIGIN}/staff/login` }),
};

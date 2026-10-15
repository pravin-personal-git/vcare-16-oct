import 'server-only';

/**
 * The one part of OTP login that genuinely needs external setup: actually
 * sending the code. Everything else (generation, hashing, expiry, attempt
 * limits, verification) lives in `otp.ts` and is already fully real - this
 * file is deliberately the ONLY place that needs touching once a provider is
 * configured, per the explicit ask: least possible code changes later.
 *
 * SMS: MSG91 (decided - see PLATFORM-API-LAYER.md §5). Gated on
 * `MSG91_AUTH_KEY`/`MSG91_TEMPLATE_ID` existing in the environment. Until
 * they do: development logs the code to the console (and `otp.ts` echoes it
 * back in the API response so the whole flow is testable end to end with no
 * real phone), production refuses outright rather than silently pretending
 * to send something that never arrives.
 *
 * The MSG91 request body below matches their documented Send OTP v5 API
 * shape at the time this was written - MSG91 does occasionally revise field
 * names, so cross-check against the integration snippet on your own MSG91
 * dashboard before relying on this in production, the same way you'd check
 * any third-party API you haven't called from this exact codebase before.
 *
 * Email: no provider exists in this codebase at all yet (confirmed - no
 * `EmailProvider`/SMTP/API-based sender anywhere in `src/server`). Gated on
 * `OTP_EMAIL_PROVIDER_API_KEY` for the same reasoning; pick a provider
 * (Resend, SendGrid, plain SMTP - whatever's easiest) when you get there and
 * fill in the `fetch` call the same way as the SMS side.
 */

export class OtpDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpDeliveryError';
  }
}

const isProd = process.env.NODE_ENV === 'production';

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authKey || !templateId) {
    if (isProd) throw new OtpDeliveryError('SMS delivery is not configured yet.');
    console.log(`[otp-delivery] MSG91 not configured - SMS OTP for ${phone}: ${code}`);
    return;
  }

  const res = await fetch('https://control.msg91.com/api/v5/otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: authKey },
    body: JSON.stringify({
      template_id: templateId,
      mobile: phone.replace(/^\+/, ''), // MSG91 expects country code with no leading '+'
      otp: code,
      otp_length: code.length,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new OtpDeliveryError(`MSG91 send failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

/**
 * Email: Resend (6 Oct 2026), the same account and sender `server/notify.ts`
 * already uses for notification emails - RESEND_API_KEY, NOTIFY_FROM.
 */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (isProd) throw new OtpDeliveryError('Email delivery is not configured yet (RESEND_API_KEY).');
    console.log(`[otp-delivery] No email provider configured - Email OTP for ${email}: ${code}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || 'Atlas <notify@nairsolutions.org>',
      to: [email],
      subject: `Your Atlas sign-in code: ${code}`,
      html: `<p>Your sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>`
        + '<p>It works for 5 minutes. If you did not try to sign in, change your password and tell N.A.I.R.</p>',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new OtpDeliveryError(`Could not send the code by email (${res.status}): ${body.slice(0, 200)}`);
  }
}

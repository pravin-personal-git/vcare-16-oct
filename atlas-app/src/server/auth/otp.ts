import 'server-only';
import { createHash, randomInt } from 'node:crypto';
import { db } from '../db';
import { sendOtpSms, sendOtpEmail, OtpDeliveryError } from './otp-delivery';

/**
 * OTP login - generation, storage and verification. Purpose-agnostic (staff
 * `User` or portal `Party`) and channel-agnostic (sms or email); only the
 * actual "send it" step (`otp-delivery.ts`) is pending real provider
 * configuration - everything here is already real and fully testable.
 */

export class OtpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpError';
  }
}

const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60_000;
const REQUEST_COOLDOWN_MS = 60_000;
const MAX_VERIFY_ATTEMPTS = 5;

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

export type OtpChannel = 'sms' | 'email';
/** `platform_login`: the second step on /platform-login (6 Oct 2026), sent by email. */
export type OtpPurpose = 'staff_login' | 'customer_login' | 'platform_login';

export interface RequestOtpParams {
  channel: OtpChannel;
  destination: string;
  purpose: OtpPurpose;
  userId?: string;
  partyId?: string;
}

export interface RequestOtpResult {
  /** Only ever set outside production - lets the whole flow be tested with no real SMS/email provider. */
  devCode?: string;
}

export async function requestOtp(params: RequestOtpParams): Promise<RequestOtpResult> {
  const { channel, destination, purpose, userId, partyId } = params;

  const recent = await db.otpCode.findFirst({
    where: { destination, purpose, createdAt: { gt: new Date(Date.now() - REQUEST_COOLDOWN_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (recent) throw new OtpError('Please wait a moment before requesting another code.');

  const code = generateCode();
  await db.otpCode.create({
    data: {
      channel, destination, purpose, codeHash: hash(code),
      userId: userId ?? null, partyId: partyId ?? null,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  try {
    if (channel === 'sms') await sendOtpSms(destination, code);
    else await sendOtpEmail(destination, code);
  } catch (e) {
    if (e instanceof OtpDeliveryError) throw new OtpError(e.message);
    throw e;
  }

  return process.env.NODE_ENV === 'production' ? {} : { devCode: code };
}

export interface VerifyOtpParams {
  destination: string;
  purpose: OtpPurpose;
  code: string;
}

export interface VerifyOtpResult {
  userId: string | null;
  partyId: string | null;
}

export async function verifyOtp(params: VerifyOtpParams): Promise<VerifyOtpResult> {
  const { destination, purpose, code } = params;

  const row = await db.otpCode.findFirst({
    where: { destination, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw new OtpError('That code has expired. Request a new one.');

  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    // Consumed without succeeding - blocks further guesses against this code specifically.
    await db.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    throw new OtpError('Too many incorrect attempts. Request a new code.');
  }

  if (hash(code) !== row.codeHash) {
    await db.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new OtpError('Incorrect code.');
  }

  await db.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return { userId: row.userId, partyId: row.partyId };
}

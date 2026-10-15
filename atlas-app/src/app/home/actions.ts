'use server';

import { headers } from 'next/headers';
import { LandingLeadError, submitLandingLead } from '@/server/landing-leads';

/** In-memory brake per address: the form is public. Five in ten minutes is plenty for a person. */
const seen = new Map<string, number[]>();

export async function landingLeadAction(input: {
  name: string; phone: string; business: string; businessType: string; city: string; teamSize: string;
  interest: string[]; message: string; lang: 'en' | 'hi'; website: string;
}): Promise<{ ok?: boolean; error?: string }> {
  // A hidden field people never see; bots fill it.
  if (input.website) return { ok: true };
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const recent = (seen.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 5) return { error: 'Too many requests. Please try again in a few minutes.' };
  seen.set(ip, [...recent, now]);
  try {
    await submitLandingLead({
      name: input.name, phone: input.phone, business: input.business || null, businessType: input.businessType || null,
      city: input.city || null, teamSize: input.teamSize || null, interest: input.interest.slice(0, 10).map((s) => s.slice(0, 40)),
      message: input.message || null, lang: input.lang === 'hi' ? 'hi' : 'en',
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof LandingLeadError) return { error: e.message };
    console.error('[landing] lead failed', e);
    return { error: 'Something went wrong. Please call or WhatsApp us.' };
  }
}

import Constants from 'expo-constants';

/**
 * Customer login by OTP is shown from day one but switched on from a launch
 * date (decided 25 Sep 2026: 1 December 2026, while DLT registration for SMS
 * completes). The date lives in app.json `extra.otpLaunchDate`, so moving it
 * is a config change, not a code change.
 */
const configured = (Constants.expoConfig?.extra as { otpLaunchDate?: string } | undefined)?.otpLaunchDate ?? '2026-12-01';

export const OTP_LAUNCH = new Date(`${configured}T00:00:00+05:30`);

export function otpAvailable(now = new Date()): boolean {
  return now.getTime() >= OTP_LAUNCH.getTime();
}

/** "1 December 2026" / "1 दिसंबर 2026" - written out, never a bare number format that reads two ways. */
export function otpLaunchLabel(lang: 'en' | 'hi'): string {
  return OTP_LAUNCH.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

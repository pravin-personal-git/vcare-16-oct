import { staff, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { registerPushToken } from '@/server/notify';

/**
 * Vcare registers its Expo push token here after sign-in (27 Sep 2026,
 * NOTIFICATIONS-APPROVALS-SPEC.md §2), so approvals, renewals and reminders
 * can reach the phone. One token belongs to one person; signing in as
 * someone else on the same phone moves it.
 */
export async function POST(req: Request) {
  return staff(req, null, async (ctx) => {
    const b = await jsonBody(req);
    const token = str(b.token, 200);
    if (!token) throw new V1Error('No push token.');
    await registerPushToken(ctx.user.id, token, str(b.deviceName, 80), b.fullScreen === true);
    return { ok: true };
  });
}

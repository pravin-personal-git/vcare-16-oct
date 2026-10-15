import { jsonBody, staff, V1Error } from '@/server/auth/v1-staff';
import { completeReminder, deleteReminder, ReminderError, snoozeReminder } from '@/server/reminders';

type Params = { params: Promise<{ id: string }> };

/** Snooze choices on the alarm card (decision 15). */
const SNOOZE_MIN = [5, 10, 30];

/**
 * Done / Snooze / Delete from the phone (G-40). The alarm card's buttons are
 * sent here - straight away with signal, from the phone's queue once it is
 * back (the alarm itself already stopped and re-set on the phone).
 * `at`: when the button was pressed, so a snooze queued offline counts from
 * then, not from when it finally reached us.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return staff(req, null, async (ctx) => {
    const b = await jsonBody(req);
    const op = String(b.op ?? '');
    try {
      const pressed = new Date(String(b.at ?? ''));
      const pressedAt = Number.isNaN(pressed.getTime()) ? undefined : pressed;
      if (op === 'done') await completeReminder(ctx.scope, ctx.user.id, id, pressedAt);
      else if (op === 'delete') await deleteReminder(ctx.scope, ctx.user.id, id);
      else if (op === 'snooze') {
        const minutes = Number(b.minutes);
        if (!SNOOZE_MIN.includes(minutes)) throw new V1Error('Snooze for 5, 10 or 30 minutes.');
        const from = !pressedAt || pressedAt.getTime() > Date.now() ? Date.now() : pressedAt.getTime();
        // Reached us after the snooze already ran out: ring again a minute from now.
        const until = new Date(Math.max(from + minutes * 60_000, Date.now() + 60_000));
        await snoozeReminder(ctx.scope, ctx.user.id, id, until);
      } else throw new V1Error('Unknown reminder action.');
      return { ok: true };
    } catch (e) {
      if (e instanceof ReminderError) {
        // Already done or deleted elsewhere: the phone's job is finished either way.
        if (/not found/i.test(e.message)) return { ok: true, gone: true };
        throw new V1Error(e.message);
      }
      throw e;
    }
  });
}

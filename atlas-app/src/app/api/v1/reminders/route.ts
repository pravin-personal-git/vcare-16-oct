import { jsonBody, staff, str, V1Error } from '@/server/auth/v1-staff';
import { addReminder, myReminders, reminderTargets, ReminderError, remindersISetForOthers } from '@/server/reminders';
import { businessSettings } from '@/server/notify';

/**
 * Reminders on the phone (G-40, 13 Oct 2026). GET is what the phone sets its
 * own alarms from - every reminder of mine still to ring, with the moment
 * (`ringAt`) and the key it shares with the server's backup push - plus who
 * I may set one for and the business's alarm sound. POST adds one.
 *
 * Everyone: a reminder is personal, like My Desk - no permission, no section.
 */
export async function GET(req: Request) {
  return staff(req, null, async (ctx) => {
    const storeId = ctx.scope.kind === 'single' ? ctx.scope.storeId : ctx.scope.storeIds[0];
    const [reminders, forOthers, targets, settings] = await Promise.all([
      myReminders(ctx.scope, ctx.user.id),
      remindersISetForOthers(ctx.scope, ctx.user.id),
      reminderTargets(ctx.scope, ctx.user.id, ctx.permissions),
      storeId ? businessSettings(storeId) : null,
    ]);
    return { reminders, forOthers, targets, defaultTone: settings?.alarmTone ?? 'bell', now: new Date().toISOString() };
  });
}

export async function POST(req: Request) {
  return staff(req, null, async (ctx) => {
    const b = await jsonBody(req);
    const dueAt = new Date(String(b.dueAt ?? ''));
    try {
      const r = await addReminder(ctx.scope, ctx.user.id, {
        title: str(b.title, 200) ?? '', note: str(b.note, 1000), dueAt,
        repeat: str(b.repeat, 10) ?? 'none', forUserId: str(b.forUserId, 40),
      }, ctx.permissions);
      return { ok: true, id: r.id };
    } catch (e) {
      if (e instanceof ReminderError) throw new V1Error(e.message);
      throw e;
    }
  });
}

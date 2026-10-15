import 'server-only';
import { db } from './db';
import { JOB_SETTINGS_DEFAULTS, parseJobSettings, type JobSettingsValue } from '@/lib/job-settings';

/**
 * A branch's field-job settings (workflow spec §5), with defaults for
 * anything never set. The settings page itself is slice 2.
 */
export async function getJobSettings(storeId: string): Promise<JobSettingsValue> {
  const row = await db.jobSettings.findUnique({ where: { storeId }, select: { settings: true } });
  return row ? parseJobSettings(row.settings) : structuredClone(JOB_SETTINGS_DEFAULTS);
}

export async function saveJobSettings(storeId: string, value: unknown, userId: string | null): Promise<JobSettingsValue> {
  const clean = parseJobSettings(value);
  await db.jobSettings.upsert({
    where: { storeId },
    create: { storeId, settings: clean as unknown as object, updatedBy: userId },
    update: { settings: clean as unknown as object, updatedBy: userId },
  });
  return clean;
}

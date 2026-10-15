/**
 * The alarm sounds Vcare 1.0.19+ rings reminders with (G-40, decision 13,
 * 13 Oct 2026). The phone makes them itself - a struck bell, a beeping clock,
 * a rising siren, a soft chime - so there are no audio files to license or
 * ship; "phone" is the phone's own alarm-clock sound. The business sets the
 * default (Settings > Approval Rules & Notifications); each person can pick
 * their own on the phone. Shared by the server, the website and the phone.
 */
export const ALARM_TONES = ['bell', 'classic', 'siren', 'chime', 'phone'] as const;
export type AlarmTone = typeof ALARM_TONES[number];

export const ALARM_TONE_LABEL: Record<AlarmTone, string> = {
  bell: 'Temple bell',
  classic: 'Classic alarm clock',
  siren: 'Siren',
  chime: 'Soft chime',
  phone: "The phone's own alarm sound",
};

export const isAlarmTone = (v: unknown): v is AlarmTone => (ALARM_TONES as readonly unknown[]).includes(v);

import { requireOptionalNativeModule } from 'expo';

export interface PhoneCall { number: string; type: number; startedAtMs: number; durationSec: number }

interface CallLogNative {
  hasPermission(): boolean;
  getCalls(sinceMs: number, limit: number): Promise<PhoneCall[]>;
}

/** Null outside an Android build (web preview, Expo Go). */
export const CallLogModule = requireOptionalNativeModule<CallLogNative>('MaalikCallLog');

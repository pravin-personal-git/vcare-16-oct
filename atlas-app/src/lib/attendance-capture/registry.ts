import type { VendorAdapter } from './contract';
import { zktecoBioTime } from './adapters/zkteco-biotime';
import { hikvisionIsapi } from './adapters/hikvision-isapi';
import { csvFile } from './adapters/csv-file';
import { selfie } from './adapters/selfie';

/**
 * EVERY ATTENDANCE VENDOR WE SPEAK TO (F2.5, decision D13).
 *
 * Four, deliberately covering all four transports:
 *
 *   pull    ZKTeco BioTime - we ask, on a schedule
 *   push    Hikvision ISAPI - the device tells us
 *   file    a daily CSV - the vendor emails one
 *   device  our own phone - no vendor at all
 *
 * Three would have proved less. Two vendors that both poll would only show
 * that the contract fits polling; one of each is what shows the contract is
 * actually vendor-shaped rather than ZKTeco-shaped with the names changed.
 *
 * ADDING eSSL, REALTIME OR MATRIX IS ONE FILE. If a fifth vendor needs
 * anything outside `VendorAdapter`, that is a signal the contract is wrong -
 * fix the contract, not the caller.
 */
export const ADAPTERS: readonly VendorAdapter[] = [
  zktecoBioTime,
  hikvisionIsapi,
  csvFile,
  selfie,
];

const BY_VENDOR = new Map(ADAPTERS.map((a) => [a.vendor, a]));

export const adapterFor = (vendor: string): VendorAdapter | undefined => BY_VENDOR.get(vendor);

/** For the device-setup dropdown. */
export const adapterChoices = () =>
  ADAPTERS.map((a) => ({ value: a.vendor, label: a.label, hint: a.hint, transport: a.transport }));

export class UnknownVendorError extends Error {
  constructor(vendor: string) {
    super(
      `No adapter for "${vendor}". Add one under lib/attendance-capture/adapters and list it in the registry.`,
    );
  }
}

export function requireAdapter(vendor: string): VendorAdapter {
  const a = BY_VENDOR.get(vendor);
  if (!a) throw new UnknownVendorError(vendor);
  return a;
}

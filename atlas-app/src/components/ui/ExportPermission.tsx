'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether this person may export lists here (F1b, 6 Oct 2026). Decided once
 * on the server in the app layout (server/can-export: office/admin level and
 * exports not switched off for the business), so a screen adding Export does
 * not have to thread a prop through. The server routes still check again.
 */
const ExportAllowed = createContext(false);

export function ExportPermissionProvider({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <ExportAllowed.Provider value={allowed}>{children}</ExportAllowed.Provider>;
}

export const useExportAllowed = () => useContext(ExportAllowed);

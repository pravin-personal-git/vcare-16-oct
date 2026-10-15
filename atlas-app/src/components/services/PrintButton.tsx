'use client';

import { Button } from '@/components/ui/Button';

/** Print, or save as PDF from the print dialog. */
export function PrintButton() {
  return <Button variant="primary" icon="printer" onClick={() => window.print()}>Print / save as PDF</Button>;
}

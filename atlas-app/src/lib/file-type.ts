/**
 * What a file is allowed to be, and whether it is telling the truth.
 *
 * Pure functions, in lib/ rather than server/, so they can be tested without a
 * database or a request. The rules here decide what reaches storage, which
 * makes them exactly the rules worth having tests for.
 */

/**
 * What a browser may send us.
 *
 * An allowlist, not a blocklist. A blocklist is a promise to have thought of
 * every dangerous extension, which nobody can keep - and the one you forget is
 * the one that gets uploaded.
 */
export const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/webp': 'WebP image',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'text/csv': 'CSV',
  // A technician's voice note from Vcare (13 Oct 2026): AAC in an MP4 box, .m4a.
  'audio/mp4': 'Voice note (M4A)',
};

/** 10 MB. Large enough for a scanned PO, small enough not to bankrupt storage. */
export const MAX_BYTES = 10 * 1024 * 1024;

/**
 * What the file actually is, read from its first bytes.
 *
 * The browser sends a `type` on every upload and it is trivially wrong: it is
 * derived from the file extension, so renaming `payload.exe` to `invoice.pdf`
 * makes the browser announce `application/pdf` in good faith. Trusting it means
 * the allowlist above checks a label the attacker wrote.
 *
 * Magic bytes are what the file says about itself from the inside. Not
 * foolproof - a valid PDF can still contain something unpleasant - but it
 * closes the gap between "called a PDF" and "is a PDF", which is the gap that
 * actually gets used.
 *
 * Returns null when the bytes match nothing known, which for our allowlist
 * means only CSV, since plain text has no signature.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i];
  const starts = (...sig: number[]) => sig.every((b, i) => at(i) === b);

  if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';            // %PDF
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';

  // RIFF....WEBP
  if (starts(0x52, 0x49, 0x46, 0x46)
    && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return 'image/webp';
  }

  // XLSX and DOCX are both zip archives, so the signature cannot tell them
  // apart. Either is acceptable, so the declared type decides which - the
  // damage a wrong label does here is a wrong icon.
  if (starts(0x50, 0x4b, 0x03, 0x04)) return 'application/zip';

  // ISO media (MP4 / M4A): a box size, then "ftyp" at byte 4. The box cannot
  // tell audio from video (phone recorders write generic brands such as
  // isom / mp42), so any ISO media file reads as audio/mp4 - a stated hole
  // like CSV's: the worst it can be is a short video under the 10 MB cap.
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) return 'audio/mp4';

  return null;
}

const ZIP_BACKED = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * Does the declared type survive contact with the actual bytes?
 *
 * CSV is the one exception: plain text has no signature, so there is nothing to
 * check. That is an accepted, stated hole rather than a forgotten one - a CSV
 * is text either way, and the worst it can be is a spreadsheet formula, which
 * is a problem for whoever opens it in Excel, not for this server.
 */
export function bytesMatchType(declared: string, bytes: Uint8Array): string | null {
  if (declared === 'text/csv') return null;

  const actual = sniffMime(bytes);
  if (actual === null) {
    return 'That file does not look like the type it claims to be.';
  }
  if (actual === 'application/zip') {
    return ZIP_BACKED.has(declared)
      ? null
      : 'That file is a zip archive, not the type it claims to be.';
  }
  if (actual !== declared) {
    return `That file says it is ${ALLOWED_MIME[declared] ?? declared}, but its contents are ${ALLOWED_MIME[actual] ?? actual}.`;
  }
  return null;
}

export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Rejects a file before it is stored, and says why in words the person can act
 * on. "Invalid file" tells them nothing; "PowerPoint is not one of the types we
 * accept" tells them to export a PDF.
 */
export function rejectReason(mimeType: string, size: number): string | null {
  if (!ALLOWED_MIME[mimeType]) {
    return `That file type is not accepted. Allowed: ${[...new Set(Object.values(ALLOWED_MIME))].join(', ')}.`;
  }
  if (size > MAX_BYTES) {
    return `That file is ${describeSize(size)}. The limit is ${describeSize(MAX_BYTES)}.`;
  }
  if (size === 0) return 'That file is empty.';
  return null;
}

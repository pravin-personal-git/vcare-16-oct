import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The picture WhatsApp and other apps show when the link is shared. */
export const alt = 'Vcare - Business Operating System';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), 'public', 'vcare-logo.png'));
  const src = `data:image/png;base64,${logo.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#ffffff' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={958} height={410} alt="" />
        <div style={{ marginTop: 36, fontSize: 44, fontWeight: 700, color: '#0b2a4a' }}>Business Operating System</div>
      </div>
    ),
    size,
  );
}

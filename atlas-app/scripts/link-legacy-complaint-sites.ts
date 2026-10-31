// Link migrated complaints to the customer's saved site (31 Oct 2026, Vcare).
//
// The old system kept a complaint's site in map_link.siteName; the migration
// copied the customers' sites (PartySite, 995 of them) but never pointed the
// complaints at them, so COMP202602286 shows no site although the old one says
// "MARODA CL". This matches the old name to ONE active site of the same
// customer (letters and digits only, case ignored) and links it. Nothing else
// is touched: a complaint that already has a site, or whose name matches none
// or several sites, is listed and left alone.
//
//   Dry run (default, read-only):  npx tsx scripts/link-legacy-complaint-sites.ts <old complaints.json> [out.csv]
//   Apply:                         ... --apply
//
// Needs DIRECT_URL. Every change is one complaint row plus one activity line.
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export const normSite = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
assert.equal(normSite('Maroda c.l '), 'MARODACL');
assert.equal(normSite('F.L ANDA'), normSite('fl anda'));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [snapshot, outCsv] = args.filter((a) => !a.startsWith('--'));
if (!snapshot) { console.error('usage: link-legacy-complaint-sites.ts <complaints.json> [out.csv] [--apply]'); process.exit(2); }

const url = process.env.DIRECT_URL ?? '';
if (!url) { console.error('DIRECT_URL is not set'); process.exit(2); }
const db = new PrismaClient({ datasourceUrl: url + (url.includes('?') ? '&' : '?') + 'connection_limit=1' });

type Old = { complaint_id: string; map_link?: { siteName?: string } };

async function main() {
  if (!apply) await db.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const old = JSON.parse(readFileSync(snapshot, 'utf8')) as Old[];
  const oldSite = new Map(old.map((o) => [o.complaint_id, (o.map_link?.siteName ?? '').trim()]));

  const complaints = await db.complaint.findMany({
    where: { deletedAt: null, legacyRef: { not: null }, siteId: null },
    select: { id: true, complaintNo: true, legacyRef: true, storeId: true, customerId: true, siteLocation: true, siteLat: true },
  });
  const sites = await db.partySite.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, storeId: true, partyId: true, name: true, address: true, latitude: true, longitude: true },
  });
  const byParty = new Map<string, typeof sites>();
  for (const s of sites) (byParty.get(s.partyId) ?? byParty.set(s.partyId, []).get(s.partyId)!).push(s);

  const rows: string[] = ['complaint,old_site,result,linked_site'];
  const tally = { linked: 0, noOldSite: 0, noMatch: 0, several: 0 };
  for (const c of complaints) {
    const name = oldSite.get(c.legacyRef!) ?? '';
    if (!name) { tally.noOldSite++; continue; }
    const hits = (byParty.get(c.customerId) ?? []).filter((s) => s.storeId === c.storeId && normSite(s.name) === normSite(name));
    if (hits.length !== 1) {
      hits.length ? tally.several++ : tally.noMatch++;
      rows.push(`${c.complaintNo},"${name.replace(/"/g, '""')}",${hits.length ? 'several sites match' : 'no saved site of this name'},`);
      continue;
    }
    const s = hits[0];
    tally.linked++;
    rows.push(`${c.complaintNo},"${name.replace(/"/g, '""')}",linked,"${s.name.replace(/"/g, '""')}"`);
    if (!apply) continue;
    const pinned = c.siteLat === null && s.latitude !== null && s.longitude !== null;
    await db.$transaction([
      db.complaint.update({
        where: { id: c.id },
        data: {
          siteId: s.id,
          // The words stay if the complaint has its own; the pin only fills an empty one.
          ...(c.siteLocation ? {} : { siteLocation: [s.name, s.address].filter(Boolean).join(' - ') }),
          ...(pinned ? { siteLat: s.latitude, siteLng: s.longitude, siteSource: 'site' } : {}),
        },
      }),
      db.complaintActivity.create({
        data: { complaintId: c.id, kind: 'site_changed', createdBy: null, visibleToPortal: false, body: `Site linked from the old system: ${s.name}` },
      }),
    ]);
  }
  if (outCsv) writeFileSync(outCsv, rows.join('\n') + '\n');
  console.log(apply ? 'APPLIED' : 'DRY RUN (nothing written)', tally, outCsv ? `list: ${outCsv}` : '');
}
main().finally(() => db.$disconnect());

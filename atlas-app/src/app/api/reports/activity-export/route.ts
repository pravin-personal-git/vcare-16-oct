import { NextResponse } from 'next/server';
import { getContext } from '@/server/context';
import { canOpenRoute } from '@/lib/route-access';
import { listAuditEvents, listSignInEvents, type AuditFilters } from '@/server/audit-log';
import { AREA_LABEL, isAuditArea } from '@/lib/audit-areas';

/** CSV of the activity log with the same filters as the page (up to 10,000 rows). */
const MAX = 10_000;

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (!canOpenRoute('/reports/activity-log', ctx.permissions)) {
    return NextResponse.json({ error: 'You do not have access to the activity log.' }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const day = (s: string | null, end = false) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? '23:59:59' : '00:00:00'}+05:30`) : null);
  const area = sp.get('area');
  const f: AuditFilters = {
    area: isAuditArea(area) || area === 'other' ? area : null,
    person: sp.get('person'), table: sp.get('table'), action: sp.get('action'), row: sp.get('row'),
    q: sp.get('q'), from: day(sp.get('from')), to: day(sp.get('to'), true),
  };
  const storeIds = ctx.stores.map((s) => s.id);
  const lines: string[] = [];
  if (sp.get('tab') === 'signins') {
    const { rows } = await listSignInEvents(ctx.scope, storeIds, f, 0, MAX);
    lines.push('When,Type,Person,IP,Description');
    for (const r of rows) lines.push([r.at, r.type, r.actor, r.ip, r.description].map(cell).join(','));
  } else {
    const { rows } = await listAuditEvents(ctx.scope, storeIds, f, 0, MAX);
    lines.push('When,Area,Action,Record type,Record,About,Person,Via,IP,Changes');
    for (const r of rows) {
      const changes = r.changes.map((c) => `${c.field}: ${c.from ?? '(empty)'} -> ${c.to ?? '(empty)'}`).join('; ');
      lines.push([r.at, r.area ? AREA_LABEL[r.area] : 'Other', r.action, r.tableLabel, r.label ?? r.rowId, r.context, r.actor, r.via, r.ip, changes].map(cell).join(','));
    }
  }
  return new NextResponse('﻿' + lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

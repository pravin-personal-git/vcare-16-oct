// Self-check for a person's own access level (lib/role-modules applyPersonalLevel).
//   npx tsx scripts/user-access-check.ts
import assert from 'node:assert/strict';
import { applyPersonalLevel, moduleByKey, moduleState } from '../src/lib/role-modules';

const inv = moduleByKey('invoice')!;
const role = new Set(['invoice.view', 'invoice.create', 'invoice.edit', 'invoice.costTrail', 'invoice.approve', 'leads.view']);

// Down to View: only see; the other modules are untouched.
const view = applyPersonalLevel(role, inv, 'view');
assert.deepEqual([...view].sort(), ['invoice.view', 'leads.view']);
// Off: nothing of the module is left.
assert.ok(![...applyPersonalLevel(role, inv, 'none')].some((k) => k.startsWith('invoice.')));
// Up from nothing to Edit: view + create + edit + cost trail, not approve.
const edit = applyPersonalLevel(new Set(['leads.view']), inv, 'edit');
assert.equal(moduleState(inv, edit).level, 'edit');
assert.ok(!edit.has('invoice.approve'));
// Delete and extras survive only from Edit up: Quotations' delete goes with View.
const q = moduleByKey('quotation')!;
const qRole = new Set(['quotation.view', 'quotation.create', 'quotation.edit', 'quotation.delete']);
assert.ok(!applyPersonalLevel(qRole, q, 'view').has('quotation.delete'));
assert.ok(applyPersonalLevel(qRole, q, 'approve').has('quotation.delete'));
// Extras (Returns: give money back) are dropped when switched off.
const r = moduleByKey('returns')!;
assert.ok(!applyPersonalLevel(new Set(['returns.view', 'returns.edit', 'returns.credit']), r, 'none').has('returns.credit'));
console.log('user-access-check: all good');

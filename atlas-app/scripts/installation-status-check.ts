// Self-check: an installation's status moves like a complaint's (30 Oct 2026).
//   npx tsx scripts/installation-status-check.ts
import assert from 'node:assert/strict';
import { autoStatus, legacyStatus, normaliseStage, stageLabel } from '../src/lib/installation-stages';

const f = { status: 'pending', isInvoiced: false, notBilledReason: null, team: 0, visits: 0, onSite: false };

assert.equal(autoStatus('received', f), 'received');
assert.equal(autoStatus('received', { ...f, team: 1 }), 'assigned');
// A visit booked before the technician accepts does not skip Accept, as on a complaint.
assert.equal(autoStatus('assigned', { ...f, team: 1, visits: 1 }), 'assigned');
assert.equal(autoStatus('accepted', { ...f, team: 1, visits: 1 }), 'scheduled');
assert.equal(autoStatus('on_the_way', { ...f, team: 1, visits: 1 }), 'on_the_way');
assert.equal(autoStatus('scheduled', { ...f, team: 1, visits: 1, onSite: true }), 'on_site');
assert.equal(autoStatus('in_progress', { ...f, team: 1, onSite: true }), 'in_progress');
assert.equal(autoStatus('on_site', { ...f, status: 'work_done', team: 1 }), 'awaiting_customer');
assert.equal(autoStatus('resolved', { ...f, status: 'work_done', team: 1 }), 'resolved');
assert.equal(autoStatus('resolved', { ...f, status: 'rejected', team: 1 }), 'in_progress');
assert.equal(autoStatus('resolved', { ...f, status: 'work_done', isInvoiced: true }), 'closed');
assert.equal(autoStatus('awaiting_customer', { ...f, notBilledReason: 'goodwill' }), 'closed');
assert.equal(autoStatus('assigned', f), 'received');
assert.equal(autoStatus('cancelled', { ...f, team: 3 }), 'cancelled');

// The old stages read as job statuses.
assert.equal(normaliseStage('fitting'), 'on_site');
assert.equal(normaliseStage('work_done'), 'resolved');
assert.equal(normaliseStage('billed'), 'closed');
assert.equal(stageLabel('technician'), 'Waiting for technician');
assert.equal(stageLabel('awaiting_customer'), 'Waiting for customer confirmation');

assert.equal(legacyStatus('resolved', 'pending'), 'work_done');
assert.equal(legacyStatus('in_progress', 'work_done'), 'pending');
assert.equal(legacyStatus('cancelled', 'pending'), 'pending');

console.log('installation status: ok');

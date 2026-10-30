/**
 * Self-check for Settings > Operations & approvals (30 Oct 2026): a rule saved
 * there - owners skip, an amount limit - is decided by the engine as Vcare
 * asked. Run: npx tsx scripts/approval-choices-check.ts
 */
import assert from 'node:assert/strict';
import { evaluateRule, requestType, type Rule } from '../src/lib/approval-rules';

const rule: Rule = {
  needsApproval: true, thresholdPaise: 2000_00, skipRoleIds: ['owner-role'], skipUserIds: [],
  levels: [{ level: 1, approverKind: 'manager', roleId: null, userId: null, minAmountPaise: null }],
  nudgeHours: 24, escalateHours: 48, escalateTo: 'owner',
};
const asks = (roleIds: string[], amountPaise: number | null) => !evaluateRule(rule, { userId: 'u', roleIds, amountPaise }).auto;

assert.equal(asks(['owner-role'], 9000_00), false, 'an owner never waits');
assert.equal(asks(['tech'], 1000_00), false, 'below the limit goes through');
assert.equal(asks(['tech'], 3000_00), true, 'above the limit waits');
assert.equal(asks(['tech'], null), true, 'an unknown amount (a part with no MRP) waits');
assert.equal(evaluateRule({ ...rule, needsApproval: false }, { userId: 'u', roleIds: ['tech'], amountPaise: 3000_00 }).auto, true, 'switched off = nothing waits');
assert.equal(requestType('job_challan')?.hasAmount, true, 'a parts challan carries an amount');
console.log('approval-choices-check: all good');

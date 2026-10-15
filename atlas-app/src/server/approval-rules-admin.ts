import 'server-only';
import { isAlarmTone } from '@/lib/alarm-tones';
import { db } from './db';
import { loadRule } from './approvals';
import { businessSettings, saveBusinessSettings, type BusinessNotificationSettings } from './notify';
import { presetRule, REQUEST_TYPES, requestType, type ApproverKind, type Rule } from '@/lib/approval-rules';

/**
 * Settings > Approval Rules (27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md §4).
 * One row per request type, per branch. No saved rule = the setup that was
 * there before (reporting line / role chain), described so the owner can see
 * what happens today before changing anything.
 */
export class ApprovalRuleError extends Error {}

export interface RuleRow {
  type: string;
  label: string;
  group: string;
  hasAmount: boolean;
  /** Discount % / margin % can be conditions too. */
  hasPricing: boolean;
  rule: Rule | null;
  /** What happens with no rule saved. */
  current: string;
}

export async function listRules(storeId: string): Promise<RuleRow[]> {
  const chains = await db.approvalChain.findMany({ where: { storeId }, orderBy: { level: 'asc' } });
  const roles = new Map((await db.role.findMany({ where: { storeId }, select: { id: true, name: true } })).map((r) => [r.id, r.name]));
  const out: RuleRow[] = [];
  for (const t of REQUEST_TYPES) {
    const rule = await loadRule(storeId, t.key);
    const chain = chains.filter((c) => c.entityType === t.key);
    const current = t.legacy === 'hierarchy'
      ? "Goes up the requester's reporting line (Team Setup); the owner if they have no manager."
      : chain.length
        ? `Role chain: ${chain.map((c) => roles.get(c.approverRoleId) ?? 'a role').join(' → ')}.`
        : 'Decided on its own screen by anyone allowed to; the owner is notified.';
    out.push({ type: t.key, label: t.label, group: t.group, hasAmount: t.hasAmount, hasPricing: !!t.hasPricing, rule, current });
  }
  return out;
}

export interface RuleInput extends Rule { type: string }

export async function saveRule(storeId: string, input: RuleInput) {
  const t = requestType(input.type);
  if (!t) throw new ApprovalRuleError('Unknown request type.');
  if (input.needsApproval && !input.levels.length) throw new ApprovalRuleError('Add at least one approver level, or turn approval off.');
  for (const l of input.levels) {
    if (l.approverKind === 'role' && !l.roleId) throw new ApprovalRuleError(`Level ${l.level}: choose the role.`);
    if (l.approverKind === 'user' && !l.userId) throw new ApprovalRuleError(`Level ${l.level}: choose the person.`);
  }
  if (input.nudgeHours < 1 || input.escalateHours < input.nudgeHours) throw new ApprovalRuleError('Escalate after the reminder, not before.');
  const data = {
    needsApproval: input.needsApproval,
    thresholdPaise: t.hasAmount ? input.thresholdPaise : null,
    maxDiscountPct: t.hasPricing ? input.maxDiscountPct ?? null : null,
    minMarginPct: t.hasPricing ? input.minMarginPct ?? null : null,
    skipRoleIds: input.skipRoleIds, skipUserIds: input.skipUserIds,
    nudgeHours: Math.round(input.nudgeHours), escalateHours: Math.round(input.escalateHours),
    escalateTo: input.escalateTo,
  };
  await db.$transaction(async (tx) => {
    const rule = await tx.approvalRule.upsert({
      where: { storeId_requestType: { storeId, requestType: input.type } },
      create: { storeId, requestType: input.type, ...data },
      update: data,
    });
    await tx.approvalRuleLevel.deleteMany({ where: { ruleId: rule.id } });
    if (input.needsApproval) {
      await tx.approvalRuleLevel.createMany({
        data: input.levels.map((l, i) => ({
          ruleId: rule.id, level: i + 1, approverKind: l.approverKind as ApproverKind,
          roleId: l.approverKind === 'role' ? l.roleId : null, userId: l.approverKind === 'user' ? l.userId : null,
          minAmountPaise: t.hasAmount ? l.minAmountPaise : null,
        })),
      });
    }
  });
}

/** Back to the setup from before rules (reporting line / role chain). Requests already waiting keep going. */
export async function resetRule(storeId: string, type: string, userId: string | null = null) {
  /**
   * Tombstoned, not removed (3 Oct 2026). A deleted approval rule that comes back
   * from another machine starts demanding approvals somebody switched off - so the
   * row stays and stops being read (`server/soft-delete`).
   *
   * `deletedAt: null` is explicit here because this is an `updateMany`, which the
   * filter does not touch: without it, resetting twice would rewrite the
   * tombstone date on rules already removed and lose when they actually went.
   */
  await db.approvalRule.updateMany({
    where: { storeId, requestType: type, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
}

export async function applyPreset(storeId: string, preset: 'strict' | 'balanced' | 'relaxed') {
  for (const t of REQUEST_TYPES) {
    const existing = await loadRule(storeId, t.key);
    await saveRule(storeId, {
      type: t.key, ...presetRule(preset, t),
      skipRoleIds: existing?.skipRoleIds ?? [], skipUserIds: existing?.skipUserIds ?? [],
    });
  }
}

export async function ruleChoices(storeId: string) {
  const [roles, users] = await Promise.all([
    db.role.findMany({ where: { storeId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.user.findMany({ where: { isActive: true, storeRoles: { some: { storeId } } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }),
  ]);
  return { roles, users };
}

export async function notificationDefaults(storeId: string) {
  return businessSettings(storeId);
}

export async function saveNotificationDefaults(storeId: string, patch: Partial<BusinessNotificationSettings>) {
  if (patch.renewalOffsets) {
    const clean = [...new Set(patch.renewalOffsets.filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort((a, b) => b - a);
    if (!clean.length) throw new ApprovalRuleError('Keep at least one reminder day.');
    patch = { ...patch, renewalOffsets: clean };
  }
  if (patch.alarmTone !== undefined && !isAlarmTone(patch.alarmTone)) throw new ApprovalRuleError('Choose one of the alarm sounds.');
  await saveBusinessSettings(storeId, patch);
}

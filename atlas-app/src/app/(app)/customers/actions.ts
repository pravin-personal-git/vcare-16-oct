'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { heldMessage, rupeesText } from '@/server/approval-actions';
import { createParty, type PartyInput } from '@/server/parties';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { hashPassword } from '@/server/auth/password';
import { generateTempPassword } from '@/server/portal-auth/temp-password';
import { missingStandard, readSubmittedValues, writeValues } from '@/server/custom-fields';
import { asCustomValues } from '@/lib/custom-fields';

export interface CustomerFormState {
  error?: string;
  warning?: string;
  ok?: boolean;
}

const paise = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const int = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? '0'));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};
const date = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function addCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('customers.create')) {
      return { error: 'You do not have permission to add customers.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before adding a customer.' };
    }

    const firstName = String(formData.get('firstName') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim();

    if (!firstName) return { error: 'First name is required.' };
    if (!/^\d{10}$/.test(phone)) return { error: 'Phone must be a 10-digit number.' };

    const gstin = str(formData.get('gstin'));
    if (gstin && gstin.length !== 15) {
      return { error: 'GSTIN must be exactly 15 characters.' };
    }

    // Settings > Custom Fields: mandatory built-ins and the owner's extra fields.
    const stdMissing = await missingStandard(ctx.scope, 'customer', formData);
    if (stdMissing) return { error: stdMissing };
    const custom = await readSubmittedValues(ctx.scope, 'customer', formData);
    if (custom.error) return { error: custom.error };

    const input: PartyInput = {
      isCustomer: true,
      isSupplier: formData.get('isSupplier') === 'on',
      supplierType: (formData.get('supplierType') as string) || null,
      paymentTermsDays: int(formData.get('paymentTermsDays')),
      companyName: str(formData.get('companyName')),
      gstin,
      title: str(formData.get('title')),
      firstName,
      lastName: str(formData.get('lastName')),
      designation: str(formData.get('designation')),
      phone,
      altPhone: str(formData.get('altPhone')),
      email: str(formData.get('email')),
      website: str(formData.get('website')),
      customerTypeId: str(formData.get('customerTypeId')),
      source: str(formData.get('source')),
      birthday: date(formData.get('birthday')),
      weddingAnniversary: date(formData.get('weddingAnniversary')),
      addressLine1: str(formData.get('addressLine1')),
      state: str(formData.get('state')),
      city: str(formData.get('city')),
      pincode: str(formData.get('pincode')),
      deliveryAddress: str(formData.get('deliveryAddress')),
      deliverySameAsBilling: formData.get('deliverySameAsBilling') === 'on',
      creditLimitPaise: paise(formData.get('creditLimit')),
      creditLimitDays: int(formData.get('creditLimitDays')),
      subscribeSms: formData.get('subscribeSms') === 'on',
    };

    const { party, duplicateOf } = await createParty(ctx.scope, input);
    await writeValues('customer', party.id, custom.values);

    await db.activityLog.create({
      data: {
        storeId: party.storeId,
        userId: ctx.user.id,
        activityType: 'Create',
        entityType: 'Party',
        entityId: party.id,
        description: `Party '${party.firstName}' created (${party.partyCode})`,
      },
    }).catch((e) => console.error('[customers] audit write failed (non-fatal)', e));

    revalidatePath('/customers');
    return {
      ok: true,
      warning: duplicateOf
        ? `Saved. Note: this phone number already exists on ${duplicateOf}.`
        : undefined,
    };
  } catch (err) {
    console.error('[customers] create failed', err);
    return { error: 'Could not save the customer. Please try again.' };
  }
}

export async function loadParty(id: string) {
  const ctx = await requireContext();
  const { getParty } = await import('@/server/parties');
  const p = await getParty(ctx.scope, id);
  if (!p) return null;
  return {
    id: p.id,
    partyCode: p.partyCode,
    isCustomer: p.isCustomer,
    isSupplier: p.isSupplier,
    supplierType: p.supplierType,
    paymentTermsDays: p.paymentTermsDays,
    companyName: p.companyName,
    gstin: p.gstin,
    title: p.title,
    firstName: p.firstName,
    lastName: p.lastName,
    designation: p.designation,
    phone: p.phone,
    altPhone: p.altPhone,
    email: p.email,
    website: p.website,
    customerTypeId: p.customerTypeId,
    source: p.source,
    birthday: p.birthday ? p.birthday.toISOString().slice(0, 10) : '',
    weddingAnniversary: p.weddingAnniversary ? p.weddingAnniversary.toISOString().slice(0, 10) : '',
    addressLine1: p.addressLine1,
    state: p.state,
    city: p.city,
    pincode: p.pincode,
    deliveryAddress: p.deliveryAddress,
    deliverySameAsBilling: p.deliverySameAsBilling,
    creditLimit: p.creditLimitPaise / 100,
    creditLimitDays: p.creditLimitDays,
    subscribeSms: p.subscribeSms,
    customFields: asCustomValues(p.customFields),
  };
}

export async function editCustomer(
  id: string, _prev: CustomerFormState, formData: FormData,
): Promise<CustomerFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('customers.edit')) {
      return { error: 'You do not have permission to edit customers.' };
    }

    const firstName = String(formData.get('firstName') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim();
    if (!firstName) return { error: 'First name is required.' };
    if (!/^\d{10}$/.test(phone)) return { error: 'Phone must be a 10-digit number.' };

    const gstin = str(formData.get('gstin'));
    if (gstin && gstin.length !== 15) return { error: 'GSTIN must be exactly 15 characters.' };

    const stdMissing = await missingStandard(ctx.scope, 'customer', formData);
    if (stdMissing) return { error: stdMissing };
    const custom = await readSubmittedValues(ctx.scope, 'customer', formData);
    if (custom.error) return { error: custom.error };

    const input: PartyInput = {
      isCustomer: formData.get('isCustomer') !== 'off',
      isSupplier: formData.get('isSupplier') === 'on',
      supplierType: (formData.get('supplierType') as string) || null,
      paymentTermsDays: int(formData.get('paymentTermsDays')),
      companyName: str(formData.get('companyName')),
      gstin,
      title: str(formData.get('title')),
      firstName,
      lastName: str(formData.get('lastName')),
      designation: str(formData.get('designation')),
      phone,
      altPhone: str(formData.get('altPhone')),
      email: str(formData.get('email')),
      website: str(formData.get('website')),
      customerTypeId: str(formData.get('customerTypeId')),
      source: str(formData.get('source')),
      birthday: date(formData.get('birthday')),
      weddingAnniversary: date(formData.get('weddingAnniversary')),
      addressLine1: str(formData.get('addressLine1')),
      state: str(formData.get('state')),
      city: str(formData.get('city')),
      pincode: str(formData.get('pincode')),
      deliveryAddress: str(formData.get('deliveryAddress')),
      deliverySameAsBilling: formData.get('deliverySameAsBilling') === 'on',
      creditLimitPaise: paise(formData.get('creditLimit')),
      creditLimitDays: int(formData.get('creditLimitDays')),
      subscribeSms: formData.get('subscribeSms') === 'on',
    };

    // Raising a customer's credit limit or credit days can need approval
    // (Settings > Approval Rules). Everything else saves now; the higher limit
    // waits and is applied once approved.
    let heldNote: string | null = null;
    if (ctx.scope.kind === 'single') {
      const before = await db.party.findFirst({
        where: { id, storeId: ctx.scope.storeId },
        select: { firstName: true, companyName: true, creditLimitPaise: true, creditLimitDays: true },
      });
      const raised = before && (input.creditLimitPaise > before.creditLimitPaise || input.creditLimitDays > before.creditLimitDays);
      if (before && raised) {
        heldNote = await heldMessage(ctx.scope, ctx.user.id, {
          type: 'credit_limit', entityId: id, amountPaise: input.creditLimitPaise,
          title: `Credit limit ${rupeesText(before.creditLimitPaise)} -> ${rupeesText(input.creditLimitPaise)}, ${before.creditLimitDays} -> ${input.creditLimitDays} days`,
          summary: before.companyName || before.firstName,
          payload: { creditLimitPaise: input.creditLimitPaise, creditLimitDays: input.creditLimitDays },
        });
        if (heldNote) {
          input.creditLimitPaise = before.creditLimitPaise;
          input.creditLimitDays = before.creditLimitDays;
        }
      }
    }

    const { updateParty } = await import('@/server/parties');
    const { party, duplicateOf } = await updateParty(ctx.scope, id, input);
    await writeValues('customer', party.id, custom.values);

    await db.activityLog.create({
      data: {
        storeId: party.storeId, userId: ctx.user.id,
        activityType: 'Update', entityType: 'Party', entityId: party.id,
        description: `Party '${party.firstName}' updated (${party.partyCode})`,
      },
    }).catch(() => undefined);

    revalidatePath('/customers');
    revalidatePath('/suppliers');
    const warnings = [
      duplicateOf ? `Note: ${duplicateOf} also has this phone number.` : null,
      heldNote ? `The higher credit limit was ${heldNote.charAt(0).toLowerCase()}${heldNote.slice(1)}` : null,
    ].filter(Boolean);
    return {
      ok: true,
      warning: warnings.length ? `Saved. ${warnings.join(' ')}` : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save the changes.';
    console.error('[customers] edit failed', err);
    return { error: msg };
  }
}

// ------------------------------------------------------------ portal access

export interface PortalStatus {
  portalEnabled: boolean;
  portalActivatedAt: string | null;
  portalMustReset: boolean;
}

export async function loadPortalStatus(id: string): Promise<PortalStatus | null> {
  const ctx = await requireContext();
  const party = await db.party.findFirst({
    where: { id, ...scopeWhere(ctx.scope) },
    select: { portalEnabled: true, portalActivatedAt: true, portalMustReset: true },
  });
  if (!party) return null;
  return {
    portalEnabled: party.portalEnabled,
    portalActivatedAt: party.portalActivatedAt ? party.portalActivatedAt.toISOString() : null,
    portalMustReset: party.portalMustReset,
  };
}

export interface PortalCredentialState {
  error?: string;
  tempPassword?: string;
}

/**
 * Shared by enable and reset - both end the same way: a fresh temporary
 * password, hashed and stored, shown to staff exactly once in the response
 * (never persisted in plain text, never logged).
 */
async function issueTempPassword(id: string, markEnabled: boolean): Promise<PortalCredentialState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('customers.edit')) {
    return { error: 'You do not have permission to manage portal access.' };
  }

  const party = await db.party.findFirst({ where: { id, ...scopeWhere(ctx.scope) }, select: { id: true, phone: true } });
  if (!party) return { error: 'That customer is not in your scope.' };

  // A phone number is how a customer logs in, so two portal-enabled parties
  // sharing one would make login ambiguous. Blocked here rather than with a
  // database constraint because the same phone legitimately appears on
  // multiple NON-portal contacts (e.g. two people at the same company).
  const clash = await db.party.findFirst({
    where: { phone: party.phone, portalEnabled: true, id: { not: id } },
    select: { id: true, firstName: true, companyName: true },
  });
  if (clash) {
    return { error: `Phone ${party.phone} already has portal access on another account (${clash.companyName || clash.firstName}). Disable that one first, or correct the phone number here.` };
  }

  const tempPassword = generateTempPassword();
  const portalPasswordHash = await hashPassword(tempPassword);

  await db.party.update({
    where: { id },
    data: {
      portalPasswordHash,
      portalMustReset: true,
      portalFailedLogins: 0,
      portalLockedUntil: null,
      ...(markEnabled ? { portalEnabled: true, portalActivatedAt: new Date() } : {}),
    },
  });

  revalidatePath('/customers');
  return { tempPassword };
}

export async function enablePortalAccess(id: string): Promise<PortalCredentialState> {
  return issueTempPassword(id, true);
}

export async function resetPortalPassword(id: string): Promise<PortalCredentialState> {
  return issueTempPassword(id, false);
}

export async function disablePortalAccess(id: string): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('customers.edit')) {
    return { error: 'You do not have permission to manage portal access.' };
  }
  const party = await db.party.findFirst({ where: { id, ...scopeWhere(ctx.scope) }, select: { id: true } });
  if (!party) return { error: 'That customer is not in your scope.' };

  await db.party.update({
    where: { id },
    data: { portalEnabled: false, portalPasswordHash: null },
  });
  // Revoke every live session immediately - disabling access must not leave
  // an already-logged-in browser tab still able to read data for a minute.
  await db.partyLoginSession.updateMany({
    where: { partyId: id, isRevoked: false },
    data: { isRevoked: true, loggedOutAt: new Date() },
  });

  revalidatePath('/customers');
  return { ok: true };
}

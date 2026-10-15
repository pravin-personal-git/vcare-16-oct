import 'server-only';
import { db } from './db';
import { allocateBlock } from './sync/number-blocks';
import { formatDocumentNumber, parseDocumentNumber } from './document-number';
import { getFinancialYear } from '@/lib/financial-year';

/**
 * INVOICE NUMBERS A PHONE CAN GIVE OFFLINE (13 Oct 2026, native admin app part
 * 3, F-13 decision Q3: "final number from a block").
 *
 * Each phone is a node (F2): `phone:<user>:<device>`. While online it is handed
 * a block of the branch's invoice sequence (sync/number-blocks `allocateBlock` -
 * the hub advances the sequence by the whole block, so no other phone, node or
 * the website can ever issue those numbers) and the numbers ready-formatted, so
 * the phone never needs the numbering rule. Offline it gives the next one to an
 * invoice on the spot - a GST number the customer can be handed.
 *
 * When the invoice arrives, `claimPhoneNumber` accepts the number only if it
 * is in a block of THIS person's phones and not on an invoice already; the
 * database's unique (store, invoice number) is the last guard. Numbers a phone
 * never used stay in the gap register, explained by the block (F2).
 */
const TOP_UP_BELOW = 8;
const BLOCK_SIZE = 25;

export class PhoneNumberError extends Error {}

const nodeOf = (userId: string, deviceKey: string) => `phone:${userId}:${deviceKey.replace(/[^\w-]/g, '').slice(0, 40) || 'phone'}`;

async function blockNumbers(storeId: string, nodeIdPrefix: string, exact: boolean) {
  const blocks = await db.numberBlock.findMany({
    where: { storeId, docType: 'INV', ...(exact ? { nodeId: nodeIdPrefix } : { nodeId: { startsWith: nodeIdPrefix } }) },
    orderBy: [{ financialYear: 'asc' }, { fromSeq: 'asc' }],
    select: { id: true, financialYear: true, fromSeq: true, toSeq: true, nextSeq: true, exhaustedAt: true },
  });
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { branchCode: true } });
  const pads = new Map<number, number>();
  for (const fy of new Set(blocks.map((b) => b.financialYear))) {
    const seq = await db.documentSequence.findUnique({
      where: { storeId_docType_financialYear: { storeId, docType: 'INV', financialYear: fy } }, select: { padding: true },
    });
    pads.set(fy, seq?.padding ?? 4);
  }
  return { blocks, fmt: (fy: number, n: number) => formatDocumentNumber({ docType: 'INV', branchCode: store.branchCode, financialYear: fy, sequence: n, padding: pads.get(fy) ?? 4 }) };
}

/** The unused numbers this phone holds for the current year, topping its block up first. */
export async function phoneInvoiceNumbers(storeId: string, userId: string, deviceKey: string, now: Date = new Date()) {
  const node = nodeOf(userId, deviceKey);
  const fy = getFinancialYear(now);
  const unused = async () => {
    const { blocks, fmt } = await blockNumbers(storeId, node, true);
    const all = blocks.filter((b) => b.financialYear === fy).flatMap((b) => {
      const out: string[] = [];
      for (let n = Math.max(b.fromSeq, b.nextSeq); n <= b.toSeq; n++) out.push(fmt(fy, n));
      return out;
    });
    if (!all.length) return [];
    const used = new Set((await db.invoice.findMany({ where: { storeId, invoiceNo: { in: all } }, select: { invoiceNo: true } })).map((i) => i.invoiceNo));
    return all.filter((n) => !used.has(n));
  };
  let numbers = await unused();
  if (numbers.length < TOP_UP_BELOW) {
    await allocateBlock(storeId, 'INV', fy, node, BLOCK_SIZE);
    numbers = await unused();
  }
  return { financialYear: fy, numbers };
}

/**
 * An invoice from a phone arrives with a number it gave offline. Accepted only
 * when that number is in a block of one of this person's phones and no invoice
 * has it yet. The block's `nextSeq` moves past it, so the hub's view of what is
 * left stays true.
 */
export async function claimPhoneNumber(storeId: string, userId: string, invoiceNo: string) {
  const parts = parseDocumentNumber(invoiceNo);
  if (!parts || parts.docType !== 'INV') throw new PhoneNumberError('That is not an invoice number.');
  const { blocks, fmt } = await blockNumbers(storeId, `phone:${userId}:`, false);
  const block = blocks.find((b) => b.financialYear === parts.financialYear && parts.sequence >= b.fromSeq && parts.sequence <= b.toSeq
    && fmt(b.financialYear, parts.sequence) === invoiceNo);
  if (!block) throw new PhoneNumberError(`${invoiceNo} was not given to your phone. Make the invoice again online.`);
  if (await db.invoice.findFirst({ where: { storeId, invoiceNo }, select: { id: true } })) {
    throw new PhoneNumberError(`${invoiceNo} is already on another invoice.`);
  }
  if (block.nextSeq <= parts.sequence) {
    await db.numberBlock.update({
      where: { id: block.id },
      data: { nextSeq: parts.sequence + 1, ...(parts.sequence >= block.toSeq ? { exhaustedAt: new Date() } : {}) },
    });
  }
  return parts;
}

/**
 * Written only once the invoice exists: an allocation row with no invoice is
 * what the website treats as a burnt number it may hand out again.
 */
export async function recordPhoneNumber(storeId: string, userId: string, invoiceNo: string) {
  const parts = parseDocumentNumber(invoiceNo);
  if (!parts) return;
  await db.documentNumberAllocation.create({
    data: { storeId, docType: 'INV', financialYear: parts.financialYear, sequence: parts.sequence, number: invoiceNo, allocatedBy: userId },
  }).catch(() => undefined);
}

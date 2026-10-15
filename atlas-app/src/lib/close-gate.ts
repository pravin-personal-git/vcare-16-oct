/**
 * WHEN A COMPLAINT MAY CLOSE (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 6).
 *
 * The live test of 9 Oct closed a complaint while the customer's camera was
 * still at the supplier. A job is done only when everything taken away has
 * come back to the customer, and no visit is still booked. Pure, so the office
 * dropdown, the technician's "work done", the customer's confirmation and the
 * close itself all ask the same question.
 *
 * An item never taken away ("open") does not block: it was fixed on site.
 */

/** Item states that mean the customer does not have it back yet. */
export const ITEM_STILL_OUT: Readonly<Record<string, string>> = {
  picked_up: 'picked up, not sent yet',
  with_supplier: 'with the supplier',
  back: 'back with us, not handed over',
  supplier_closed: 'closed by the supplier - the customer has nothing back yet',
};

export function closeBlockers(
  items: { equipmentName: string; serialNo: string | null; status: string }[],
  visits: { status: string; scheduledAt: Date }[] = [],
): string[] {
  const out: string[] = [];
  for (const i of items) {
    const why = ITEM_STILL_OUT[i.status];
    if (why) out.push(`${i.equipmentName}${i.serialNo ? ` (S/N ${i.serialNo})` : ''} is ${why}.`);
  }
  const booked = visits.filter((v) => v.status === 'scheduled').length;
  if (booked) out.push(`${booked} visit${booked === 1 ? ' is' : 's are'} still booked - finish or cancel ${booked === 1 ? 'it' : 'them'} first.`);
  return out;
}

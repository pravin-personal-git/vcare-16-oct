/**
 * WHERE THE CUSTOMER'S ITEM IS, IN THEIR WORDS (10 Oct 2026, repair flow
 * stage 8) - for the no-login link, the portal and the customer app.
 *
 * A customer whose camera was taken away asks one thing: "where is it and
 * when do I get it back". This answers it per item, from what Atlas already
 * records, and says nothing about suppliers' quotes, couriers, case numbers or
 * costs. The pickup receipt and the hand-back GDN are named because the
 * customer signed them.
 */
export interface CustomerItemInput {
  equipmentName: string;
  serialNo: string | null;
  status: string;
  /** The supplier's result, once something came back. */
  outcome: string | null;
  closedOn: string | null;
  newSerialNo: string | null;
  pickupNo: string | null;
  handbackGdnNo: string | null;
}

export interface CustomerItem {
  name: string;
  serialNo: string | null;
  /** One line: where it is now. */
  where: string;
  /** done = back with them; wait = with us or away; open = not taken. */
  tone: 'open' | 'wait' | 'done';
  doc: string | null;
}

export function customerItem(i: CustomerItemInput): CustomerItem | null {
  const base = { name: i.equipmentName, serialNo: i.serialNo };
  switch (i.status) {
    case 'cancelled':
      return null;
    case 'picked_up':
      return { ...base, where: 'Taken for repair - with us', tone: 'wait', doc: i.pickupNo };
    case 'with_supplier':
      return { ...base, where: 'Sent to the company for repair', tone: 'wait', doc: i.pickupNo };
    case 'back':
      return {
        ...base, tone: 'wait', doc: i.pickupNo,
        where: i.outcome === 'replaced'
          ? `Replaced by the company with a new unit${i.newSerialNo ? ` (S/N ${i.newSerialNo})` : ''} - ready to bring back`
          : i.outcome === 'returned_unrepaired' ? 'Back from the company - it could not be repaired' : 'Repaired - ready to bring back',
      };
    case 'supplier_closed':
      return { ...base, where: 'The company could not return it - we will give you a unit from our stock', tone: 'wait', doc: i.pickupNo };
    case 'handed_back':
      return {
        ...base, tone: 'done', doc: i.handbackGdnNo,
        where: i.outcome === 'replaced' && i.newSerialNo ? `Handed back - new unit S/N ${i.newSerialNo}, with a full new warranty`
          : i.closedOn ? 'Handed back - a unit from our stock, with a full new warranty'
          : 'Handed back to you',
      };
    case 'declined':
      return { ...base, where: 'Returned to you without repair', tone: 'done', doc: i.handbackGdnNo };
    default:
      return { ...base, where: 'On this complaint', tone: 'open', doc: null };
  }
}

import 'server-only';
import { stageNamer } from './order-stages';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { publicBrandUrl } from './storage';
import type { FulfilmentStatus } from '@/lib/sales-order-status';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Goods Dispatch Note - a register and a printable document, not a second
 * place to move stock.
 *
 * Stock already moves at exactly one moment - a sales order's `dispatched`
 * transition, in `sales-orders.ts::moveFulfilment` - and courier/AWB are
 * already captured there. A GDN screen that also wrote stock or its own
 * dispatch record would be a second source of truth for a fact that only
 * has one home; this module only reads what the order already says, framed
 * for whoever hands the parcel to the courier rather than whoever is
 * tracking payment.
 *
 * That is also why there is no `create`/`update` here: dispatching an order
 * IS raising its GDN. The action lives on the order (`advanceOrder` to
 * `dispatched`, which already asks for the AWB), not duplicated here.
 */

const DISPATCHED_STATES: FulfilmentStatus[] = [
  'dispatched', 'shipped', 'delivered', 'damage_or_lost', 'returned', 'refunded',
];

export interface DispatchListRow {
  id: string;
  orderNo: string;
  /** The customer record (G-35). Null for a walk-in. */
  partyId: string | null;
  customerName: string;
  organizationName: string | null;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  fulfilmentStatus: FulfilmentStatus;
  courierName: string | null;
  awbNo: string | null;
  deliveryMode: string | null;
  grandTotalPaise: number;
}

export async function listDispatches(scope: StoreScope): Promise<DispatchListRow[]> {
  const orders = await db.salesOrder.findMany({
    where: { ...scopeWhere(scope), fulfilmentStatus: { in: DISPATCHED_STATES } },
    select: {
      id: true, orderNo: true, partyId: true, customerName: true, organizationName: true,
      orderDate: true, expectedDeliveryDate: true, fulfilmentStatus: true,
      courierId: true, awbNo: true, deliveryMode: true, grandTotalPaise: true,
    },
    orderBy: { orderDate: 'desc' },
    take: LIST_MAX_ROWS,
  });

  const courierIds = [...new Set(orders.map((o) => o.courierId).filter((id): id is string => !!id))];
  const couriers = courierIds.length
    ? await db.courier.findMany({
      where: { ...scopeWhere(scope), id: { in: courierIds } },
      select: { id: true, name: true },
    })
    : [];
  const courierName = new Map(couriers.map((c) => [c.id, c.name]));

  return orders.map((o) => ({
    id: o.id, orderNo: o.orderNo, partyId: o.partyId, customerName: o.customerName, organizationName: o.organizationName,
    orderDate: o.orderDate, expectedDeliveryDate: o.expectedDeliveryDate,
    fulfilmentStatus: o.fulfilmentStatus as FulfilmentStatus,
    courierName: o.courierId ? courierName.get(o.courierId) ?? null : null,
    awbNo: o.awbNo, deliveryMode: o.deliveryMode, grandTotalPaise: o.grandTotalPaise,
  }));
}

export interface GdnItem {
  srNo: number;
  productId: string | null;
  productName: string;
  productCode: string | null;
  qty: number;
}

export interface GdnDetail {
  /** The business's own name for the stage (G3). */
  stageLabel: string;
  id: string;
  orderNo: string;
  fulfilmentStatus: FulfilmentStatus;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  customerName: string;
  organizationName: string | null;
  phone: string;
  shippingAddress: string | null;
  billingAddress: string | null;
  cityId: string | null;
  stateId: string | null;
  courierName: string | null;
  deliveryMode: string | null;
  awbNo: string | null;
  items: GdnItem[];
  storeName: string;
  storeAddress: string | null;
  org: { name: string; logoUrl: string | null };
}

export async function getDispatchDetail(scope: StoreScope, id: string): Promise<GdnDetail | null> {
  const order = await db.salesOrder.findFirst({
    where: { id, ...scopeWhere(scope), fulfilmentStatus: { in: DISPATCHED_STATES } },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      store: { include: { organization: true } },
    },
  });
  if (!order) return null;

  const courier = order.courierId
    ? await db.courier.findFirst({ where: { ...scopeWhere(scope), id: order.courierId }, select: { name: true } })
    : null;

  const name = await stageNamer(scope);
  return {
    id: order.id, orderNo: order.orderNo, fulfilmentStatus: order.fulfilmentStatus as FulfilmentStatus,
    stageLabel: name(order.fulfilmentStatus),
    orderDate: order.orderDate, expectedDeliveryDate: order.expectedDeliveryDate,
    customerName: order.customerName, organizationName: order.organizationName, phone: order.phone,
    shippingAddress: order.shippingAddress, billingAddress: order.billingAddress,
    cityId: order.cityId, stateId: order.stateId,
    courierName: courier?.name ?? null, deliveryMode: order.deliveryMode, awbNo: order.awbNo,
    items: order.items.map((i) => ({
      srNo: i.srNo, productId: i.productId, productName: i.productName, productCode: i.productCode, qty: i.qty,
    })),
    storeName: order.store.name, storeAddress: order.store.address,
    org: { name: order.store.organization.name, logoUrl: publicBrandUrl(order.store.organization.logoPath) },
  };
}

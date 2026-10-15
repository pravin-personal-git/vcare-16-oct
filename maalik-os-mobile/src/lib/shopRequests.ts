import { authed } from './api';
import { send } from './outbox';

/** What customers asked for in the online shop (13 Oct 2026) - atlas-app server/shop-requests. */
export interface ShopRequest {
  id: string; kind: 'buy' | 'visit'; at: string;
  customer: { id: string | null; name: string; phone: string | null };
  items: { name: string; qty: number }[]; goodsPaise: number; message: string | null;
  state: 'new' | 'picked' | 'closed'; ownerName: string | null;
  lead: { id: string; code: string } | null; complaint: { id: string; no: string; status: string } | null;
}
export const shopRequests = () => authed<{ requests: ShopRequest[]; canPickUp: boolean }>('/api/v1/shop-requests');
/** "I'll take it" - the request's lead becomes mine. Through the outbox, so it works offline. */
export const pickUpShopRequest = (id: string) =>
  send<{ ok: true; leadId: string; message: string }>('/api/v1/shop-requests', { id }, { label: 'Shop request picked up', target: `shop:${id}` });

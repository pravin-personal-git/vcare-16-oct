import AsyncStorage from '@react-native-async-storage/async-storage';
import { authed, openGet } from './api';

/**
 * The shop in Vcare (3 Oct 2026, decision 9: browse on the web AND in the
 * app). Same items, prices and rules as the website's /shop/<name>: product
 * price only, never "out of stock", nothing paid in the app.
 */

export interface ShopItem {
  kind: 'product' | 'combo';
  id: string;
  name: string;
  blurb: string | null;
  categoryName: string | null;
  brandName: string | null;
  warrantyMonths: number | null;
  readyDays: number | null;
  pricePaise: number;
  deliveryNote: string | null;
  offerLabel: string | null;
  imageUrls: string[];
  contains: string[];
}

export interface ShopListLine { id: string; kind: 'product' | 'combo'; refId: string; name: string; qty: number; pricePaise: number; imageUrl: string | null }
export interface ShopList { id: string; lines: ShopListLine[]; goodsPaise: number }

export interface CustomerShop { business: string; items: ShopItem[]; categories: string[]; list: ShopList | null }

const json = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

/** The signed-in customer's own business's shop, and their list. */
export const customerShop = () => authed<CustomerShop>('/api/v1/customer/shop');
export const addToList = (kind: 'product' | 'combo', refId: string) =>
  authed<{ ok: true; list: ShopList | null }>('/api/v1/customer/shop', json({ action: 'add', kind, refId }));
export const setListQty = (itemId: string, qty: number) =>
  authed<{ ok: true; list: ShopList | null }>('/api/v1/customer/shop', json({ action: 'qty', itemId, qty }));
export const sendList = (message: string) =>
  authed<{ ok: true; sent: true }>('/api/v1/customer/shop', json({ action: 'send', message }));

/** Somebody's shop, before anybody signs in. Read only. */
export const browseShop = (slug: string) =>
  openGet<{ business: string; slug: string; items: ShopItem[]; categories: string[] }>(`/api/v1/shop/${encodeURIComponent(slug)}`);

/** The last shop name somebody browsed, so the app opens it again. */
const LAST_SHOP = 'maalik.lastShop';
export const rememberShop = (slug: string) => AsyncStorage.setItem(LAST_SHOP, slug).catch(() => undefined);
export const lastShop = () => AsyncStorage.getItem(LAST_SHOP).catch(() => null);

/** "₹2,150" - whole rupees where there are no paise, as on the website's shop. */
export function shopRupees(paise: number): string {
  const r = paise / 100;
  return `₹${r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

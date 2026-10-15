import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { publicBrandUrl } from './storage';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The shop.
 *
 * Decisions 9, 11 and 14. Browsing is public; acting needs an account. The
 * price shown is the PRODUCT price with "installation and other charges may
 * apply" beside it, and a combo is a grouping of real products, never a
 * product of its own.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO PRICE IN THIS FILE
 *
 * Every number the shop shows comes from `ProductPrice` - the same row the
 * quotation and the invoice read. A catalogue that kept its own price would
 * drift from the one being charged within a week, and the first anybody would
 * know is a customer quoting a figure nobody can find.
 *
 * An offer here is a LABEL, not a discount. "10% off" is what the customer
 * reads; what they are actually charged is settled on the quotation by a
 * person. A catalogue that silently changed prices would be applying discounts
 * nobody approved.
 */

/* -------------------------------------------------------------------------- */
/*  Admin: what is in the shop                                                */
/* -------------------------------------------------------------------------- */

export interface AdminListingRow {
  id: string | null;
  productId: string;
  productCode: string;
  productName: string;
  categoryName: string | null;
  pricePaise: number;
  isListed: boolean;
  headline: string | null;
  deliveryNote: string | null;
  offerLabel: string | null;
  blurb: string | null;
  shopGroup: string | null;
  imageCount: number;
  sort: number;
}

/**
 * Every product, with its listing where it has one.
 *
 * The product list is the spine rather than the listing list, because the
 * question on this screen is "what should we be showing?" and a screen that
 * only lists what is already shown cannot answer it. Unlisted products come
 * back with `id: null`, which is what the UI uses to tell "never listed" from
 * "listed and switched off".
 */
export async function catalogueAdmin(
  scope: StoreScope,
  opts: { listedOnly?: boolean } = {},
): Promise<AdminListingRow[]> {
  const products = await db.product.findMany({
    where: {
      ...scopeWhere(scope),
      isActive: true,
      ...(opts.listedOnly ? { catalogueListing: { isNot: null } } : {}),
    },
    orderBy: { productName: 'asc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, productCode: true, productName: true,
      category: { select: { name: true } },
      prices: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { dlpPaise: true } },
      catalogueListing: {
        select: {
          id: true, isListed: true, headline: true, deliveryNote: true,
          offerLabel: true, blurb: true, shopGroup: true, sort: true, _count: { select: { images: { where: { deletedAt: null } } } },
        },
      },
    },
  });

  return products.map((p) => ({
    id: p.catalogueListing?.id ?? null,
    productId: p.id,
    productCode: p.productCode,
    productName: p.productName,
    categoryName: p.category?.name ?? null,
    pricePaise: p.prices[0]?.dlpPaise ?? 0,
    isListed: p.catalogueListing?.isListed ?? false,
    headline: p.catalogueListing?.headline ?? null,
    deliveryNote: p.catalogueListing?.deliveryNote ?? null,
    offerLabel: p.catalogueListing?.offerLabel ?? null,
    blurb: p.catalogueListing?.blurb ?? null,
    shopGroup: p.catalogueListing?.shopGroup ?? null,
    imageCount: p.catalogueListing?._count.images ?? 0,
    sort: p.catalogueListing?.sort ?? 0,
  }));
}

export interface ListingInput {
  productId: string;
  isListed: boolean;
  headline?: string | null;
  blurb?: string | null;
  deliveryNote?: string | null;
  offerLabel?: string | null;
  /** The heading on the shop. Blank = the product's category. */
  shopGroup?: string | null;
  sort?: number;
}

/**
 * Create or change a listing.
 *
 * An upsert because the screen has no "add to catalogue" step - somebody ticks
 * a product and writes a headline, and whether a row existed already is a
 * detail of ours, not a question to put to them.
 */
export async function saveListing(scope: StoreScope, input: ListingInput, userId: string) {
  const storeId = scopeForWrite(scope);

  const product = await db.product.findFirst({
    where: { id: input.productId, ...scopeWhere(scope) },
    select: { id: true, productName: true, kind: true },
  });
  if (!product) throw new Error('Product not found in your scope.');

  /**
   * A service cannot be listed.
   *
   * The shop sells things that are delivered; "INSTALLATION" in a basket is a
   * line nobody can fulfil, and the price beside it would be read as the whole
   * job. Decision 11 already says installation is quoted separately.
   */
  if (product.kind === 'service') {
    throw new Error(`${product.productName} is a service, so it cannot go in the catalogue. Prices there are for goods only.`);
  }

  const data = {
    isListed: input.isListed,
    headline: input.headline?.trim() || null,
    blurb: input.blurb?.trim() || null,
    deliveryNote: input.deliveryNote?.trim() || null,
    offerLabel: input.offerLabel?.trim() || null,
    shopGroup: input.shopGroup?.trim() || null,
    sort: input.sort ?? 0,
  };

  return db.catalogueListing.upsert({
    where: { productId: input.productId },
    create: { storeId, productId: input.productId, createdBy: userId, ...data },
    update: data,
    select: { id: true, isListed: true },
  });
}

/** Take a listing off the shop without losing the copy somebody wrote. */
export async function setListed(scope: StoreScope, listingId: string, isListed: boolean) {
  const found = await db.catalogueListing.findFirst({
    where: { id: listingId, ...scopeWhere(scope) },
    select: { id: true },
  });
  if (!found) throw new Error('Listing not found in your scope.');
  return db.catalogueListing.update({ where: { id: listingId }, data: { isListed } });
}

export async function addListingImage(
  scope: StoreScope,
  input: { listingId: string; path: string; alt?: string | null },
) {
  const listing = await db.catalogueListing.findFirst({
    where: { id: input.listingId, ...scopeWhere(scope) },
    select: { id: true, _count: { select: { images: { where: { deletedAt: null } } } } },
  });
  if (!listing) throw new Error('Listing not found in your scope.');
  // Six is already more than anybody scrolls on a phone, and each one is a
  // file somebody has to store and serve.
  if (listing._count.images >= 6) throw new Error('Six pictures is the limit on one product.');

  return db.catalogueImage.create({
    data: {
      listingId: listing.id,
      path: input.path,
      alt: input.alt?.trim() || null,
      sort: listing._count.images,
    },
    select: { id: true },
  });
}

export async function removeListingImage(scope: StoreScope, imageId: string, userId: string) {
  const img = await db.catalogueImage.findFirst({
    where: { id: imageId, listing: scopeWhere(scope) },
    select: { id: true },
  });
  if (!img) throw new Error('Picture not found in your scope.');
  // Tombstoned, not deleted, like everything else that syncs. The file itself
  // stays in the bucket: somebody removing a picture from a page is not
  // necessarily throwing it away, and a storage delete cannot be undone.
  return db.catalogueImage.update({
    where: { id: imageId },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
}

/**
 * The listing for a product, made (unlisted) if it has none yet.
 *
 * Photos are usually added before a product goes on the shop - nobody wants a
 * picture-less card live while they find the photo - so uploading must not
 * require the listing to have been saved first.
 */
export async function ensureListing(scope: StoreScope, productId: string, userId: string): Promise<string> {
  const storeId = scopeForWrite(scope);
  const product = await db.product.findFirst({
    where: { id: productId, ...scopeWhere(scope) },
    select: { id: true, kind: true, productName: true, catalogueListing: { select: { id: true } } },
  });
  if (!product) throw new Error('Product not found in your scope.');
  if (product.catalogueListing) return product.catalogueListing.id;
  if (product.kind === 'service') {
    throw new Error(`${product.productName} is a service, so it cannot go in the catalogue.`);
  }
  const made = await db.catalogueListing.create({
    data: { storeId, productId, isListed: false, createdBy: userId },
    select: { id: true },
  });
  return made.id;
}

/** A listing's photos, cover first, with the URLs the page shows. */
export async function listingImages(scope: StoreScope, productId: string) {
  const listing = await db.catalogueListing.findFirst({
    where: { productId, ...scopeWhere(scope) },
    select: { id: true, images: { where: { deletedAt: null }, orderBy: { sort: 'asc' }, select: { id: true, path: true, alt: true } } },
  });
  return {
    listingId: listing?.id ?? null,
    images: (listing?.images ?? []).map((i) => ({ id: i.id, alt: i.alt, url: publicBrandUrl(i.path) })),
  };
}

/**
 * Make one photo the cover - the one on the card. Renumbers the rest after it
 * in their existing order, so "cover" is simply "first".
 */
export async function setCoverImage(scope: StoreScope, imageId: string) {
  const img = await db.catalogueImage.findFirst({
    where: { id: imageId, listing: scopeWhere(scope) },
    select: { id: true, listingId: true },
  });
  if (!img) throw new Error('Picture not found in your scope.');
  const all = await db.catalogueImage.findMany({
    where: { listingId: img.listingId }, orderBy: { sort: 'asc' }, select: { id: true },
  });
  const order = [img.id, ...all.map((a) => a.id).filter((id) => id !== img.id)];
  await db.$transaction(order.map((id, i) => db.catalogueImage.update({ where: { id }, data: { sort: i } })));
}

/* -------------------------------------------------------------------------- */
/*  Admin: combos                                                             */
/* -------------------------------------------------------------------------- */

export interface ComboInput {
  id?: string | null;
  name: string;
  blurb?: string | null;
  deliveryNote?: string | null;
  offerLabel?: string | null;
  pricePaise?: number | null;
  isListed: boolean;
  items: { productId: string; qty: number }[];
}

export async function saveCombo(scope: StoreScope, input: ComboInput, userId: string) {
  const storeId = scopeForWrite(scope);
  const name = input.name.trim();
  if (!name) throw new Error('Give the combo a name.');

  const items = input.items.filter((i) => i.productId && i.qty > 0);
  if (items.length < 2) {
    throw new Error('A combo is two or more products. One product on its own is just a product.');
  }

  const ids = [...new Set(items.map((i) => i.productId))];
  const found = await db.product.findMany({
    where: { id: { in: ids }, ...scopeWhere(scope), isActive: true },
    select: { id: true, kind: true, productName: true },
  });
  if (found.length !== ids.length) throw new Error('One of those products is not in your scope.');

  const service = found.find((p) => p.kind === 'service');
  if (service) {
    throw new Error(`${service.productName} is a service, so it cannot be part of a combo.`);
  }

  const data = {
    name,
    blurb: input.blurb?.trim() || null,
    deliveryNote: input.deliveryNote?.trim() || null,
    offerLabel: input.offerLabel?.trim() || null,
    pricePaise: input.pricePaise ?? null,
    isListed: input.isListed,
  };

  // The lines are replaced wholesale rather than diffed. A combo has two to
  // five lines and nothing hangs off them - no stock has moved, no money - so
  // a diff would be machinery guarding nothing.
  return db.$transaction(async (tx) => {
    const combo = input.id
      ? await tx.catalogueCombo.update({ where: { id: input.id }, data, select: { id: true } })
      : await tx.catalogueCombo.create({
        data: { storeId, createdBy: userId, ...data }, select: { id: true },
      });

    await tx.catalogueComboItem.deleteMany({ where: { comboId: combo.id } });
    await tx.catalogueComboItem.createMany({
      data: items.map((i) => ({ comboId: combo.id, productId: i.productId, qty: i.qty })),
    });
    return combo;
  });
}

export async function listCombos(scope: StoreScope) {
  const combos = await db.catalogueCombo.findMany({
    where: scopeWhere(scope),
    orderBy: [{ sort: 'asc' }, { name: 'asc' }],
    take: LIST_MAX_ROWS,
    select: {
      id: true, name: true, blurb: true, deliveryNote: true, offerLabel: true,
      isListed: true, pricePaise: true, sort: true,
      items: {
        select: {
          qty: true, productId: true,
          product: {
            select: {
              productName: true, productCode: true,
              prices: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { dlpPaise: true } },
            },
          },
        },
      },
    },
  });

  return combos.map((c) => {
    const parts = c.items.map((i) => ({
      productId: i.productId,
      productName: i.product.productName,
      productCode: i.product.productCode,
      qty: i.qty,
      pricePaise: i.product.prices[0]?.dlpPaise ?? 0,
    }));
    return {
      ...c,
      items: parts,
      // What the parts add up to, so the screen can show what a bundle price
      // is actually saving. Derived, never stored - a stored total is wrong
      // the first time a price list changes.
      partsPaise: parts.reduce((t, p) => t + p.qty * p.pricePaise, 0),
    };
  });
}

export async function deleteCombo(scope: StoreScope, comboId: string, userId: string) {
  const found = await db.catalogueCombo.findFirst({
    where: { id: comboId, ...scopeWhere(scope) },
    select: { id: true },
  });
  if (!found) throw new Error('Combo not found in your scope.');
  // Tombstoned like everything else: a basket may still point at it, and a row
  // that vanishes leaves that basket describing something nobody can look up.
  return db.catalogueCombo.update({
    where: { id: comboId },
    data: { deletedAt: new Date(), deletedBy: userId, isListed: false },
  });
}

/* -------------------------------------------------------------------------- */
/*  The public shop                                                           */
/* -------------------------------------------------------------------------- */

export interface ShopItem {
  kind: 'product' | 'combo';
  id: string;
  name: string;
  blurb: string | null;
  /**
   * The heading it sits under on the shop: the listing's shop group where one
   * is set, else the product category. Combos sit under "Combos".
   */
  categoryName: string | null;
  brandName: string | null;
  warrantyMonths: number | null;
  /** From the product's delivery estimate, for "usually ready in N days". */
  readyDays: number | null;
  pricePaise: number;
  deliveryNote: string | null;
  offerLabel: string | null;
  imageUrls: string[];
  /** For a combo: what is in it, in plain words. */
  contains: string[];
}

/**
 * Everything on show, for a visitor who has not signed in.
 *
 * Takes a plain storeId rather than a `StoreScope`: there is no session here
 * and nothing to scope against. The caller resolves which shop this is - one
 * client, one deployment, one organisation - and this answers for that store
 * and no other.
 *
 * Stock is NOT shown. A camera being out today says nothing about whether it
 * can be delivered on Thursday, and a shop that says "out of stock" on a line
 * the branch can get by tomorrow loses the enquiry for no reason.
 */
export async function publicShop(storeId: string): Promise<ShopItem[]> {
  const [listings, combos] = await Promise.all([
    db.catalogueListing.findMany({
      where: { storeId, isListed: true, product: { isActive: true } },
      orderBy: [{ sort: 'asc' }],
      take: LIST_MAX_ROWS,
      select: {
        id: true, headline: true, blurb: true, deliveryNote: true, offerLabel: true, shopGroup: true,
        // Relation reads are not tombstone-filtered (server/soft-delete), so a
        // removed picture must be excluded here or it stays on the shop.
        images: { where: { deletedAt: null }, orderBy: { sort: 'asc' }, select: { path: true } },
        product: {
          select: {
            productName: true, warrantyMonths: true, deliveryEstimateDays: true,
            brand: { select: { name: true } },
            category: { select: { name: true } },
            prices: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { dlpPaise: true } },
          },
        },
      },
    }),
    db.catalogueCombo.findMany({
      where: { storeId, isListed: true },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      take: LIST_MAX_ROWS,
      select: {
        id: true, name: true, blurb: true, deliveryNote: true, offerLabel: true, pricePaise: true,
        items: {
          select: {
            qty: true,
            product: {
              select: {
                productName: true,
                prices: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { dlpPaise: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const products: ShopItem[] = listings.map((l) => ({
    kind: 'product',
    id: l.id,
    name: l.headline?.trim() || l.product.productName,
    blurb: l.blurb,
    categoryName: l.shopGroup?.trim() || l.product.category?.name || null,
    brandName: l.product.brand?.name ?? null,
    warrantyMonths: l.product.warrantyMonths ?? null,
    readyDays: l.product.deliveryEstimateDays ?? null,
    pricePaise: l.product.prices[0]?.dlpPaise ?? 0,
    deliveryNote: l.deliveryNote,
    offerLabel: l.offerLabel,
    imageUrls: l.images.map((i) => publicBrandUrl(i.path)).filter((u): u is string => !!u),
    contains: [],
  }));

  const bundles: ShopItem[] = combos.map((c) => ({
    kind: 'combo',
    id: c.id,
    name: c.name,
    blurb: c.blurb,
    categoryName: 'Combos',
    brandName: null,
    warrantyMonths: null,
    readyDays: null,
    // The bundle price where one is set, otherwise the parts added up. Never a
    // stored total: that is wrong the first time a price list changes.
    pricePaise: c.pricePaise
      ?? c.items.reduce((t, i) => t + i.qty * (i.product.prices[0]?.dlpPaise ?? 0), 0),
    deliveryNote: c.deliveryNote,
    offerLabel: c.offerLabel,
    imageUrls: [],
    contains: c.items.map((i) => `${i.qty} × ${i.product.productName}`),
  }));

  return [...products, ...bundles];
}

/** The headings on show, for the chips. Built from what is listed; Combos last. */
export function shopCategories(items: ShopItem[]): string[] {
  const all = [...new Set(items.map((i) => i.categoryName).filter((c): c is string => !!c))];
  return all.filter((c) => c !== 'Combos').sort().concat(all.includes('Combos') ? ['Combos'] : []);
}

/** One listed item, for its own page. Null when it is not on the shop. */
export async function shopItem(storeId: string, kind: 'product' | 'combo', id: string): Promise<ShopItem | null> {
  const all = await publicShop(storeId);
  return all.find((i) => i.kind === kind && i.id === id) ?? null;
}

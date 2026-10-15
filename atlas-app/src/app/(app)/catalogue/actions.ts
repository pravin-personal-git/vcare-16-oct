'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  addListingImage, deleteCombo, ensureListing, listingImages, removeListingImage, saveCombo,
  saveListing, setCoverImage, setListed, type ComboInput, type ListingInput,
} from '@/server/catalogue';
import { putCatalogueImage } from '@/server/storage';

export interface CatalogueState {
  error?: string;
  ok?: boolean;
  message?: string;
}

/**
 * Gated on `products.edit`, not on a catalogue permission of its own.
 *
 * Deciding what the shop shows and what it is called is the same authority as
 * deciding what a product IS. Inventing a second permission would mean every
 * client has to find and grant it before the shop works, and the first thing
 * they would do is give it to whoever already edits products.
 */
async function gate() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('products.edit')) {
    throw new Error('You do not have permission to change the catalogue.');
  }
  if (ctx.scope.kind === 'all') {
    throw new Error('Select a single store before changing the catalogue.');
  }
  return ctx;
}

function refresh() {
  revalidatePath('/catalogue');
  // The shop lives under /shop/<name> and inside the portal now; revalidate
  // the whole layout below each rather than guessing the slug here.
  revalidatePath('/shop', 'layout');
  revalidatePath('/portal', 'layout');
}

export async function saveListingAction(input: ListingInput): Promise<CatalogueState> {
  try {
    const ctx = await gate();
    const r = await saveListing(ctx.scope, input, ctx.user.id);
    refresh();
    return { ok: true, message: r.isListed ? 'On the shop now.' : 'Saved, not shown yet.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save it.' };
  }
}

export async function setListedAction(listingId: string, isListed: boolean): Promise<CatalogueState> {
  try {
    const ctx = await gate();
    await setListed(ctx.scope, listingId, isListed);
    refresh();
    return { ok: true, message: isListed ? 'Shown on the shop.' : 'Taken off the shop.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not change it.' };
  }
}

/**
 * Upload photos for a product (3 Oct 2026).
 *
 * Replaces an action that took a storage PATH from the browser and saved it as
 * given - which let anybody with products.edit point a listing at any file in
 * the bucket. The server now stores the file itself and decides its key.
 */
export async function uploadImagesAction(formData: FormData): Promise<CatalogueState> {
  try {
    const ctx = await gate();
    const productId = String(formData.get('productId') ?? '');
    const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    if (!productId) return { error: 'Choose a product first.' };
    if (files.length === 0) return { error: 'Choose at least one photo.' };
    const listingId = await ensureListing(ctx.scope, productId, ctx.user.id);
    let added = 0;
    for (const file of files) {
      const { storagePath } = await putCatalogueImage(ctx.organization.id, listingId, {
        type: file.type, bytes: await file.arrayBuffer(),
      });
      await addListingImage(ctx.scope, { listingId, path: storagePath, alt: null });
      added += 1;
    }
    refresh();
    return { ok: true, message: added === 1 ? 'Photo added.' : `${added} photos added.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not add the photo.' };
  }
}

export async function listImagesAction(productId: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('products.edit')) return { listingId: null, images: [] };
  return listingImages(ctx.scope, productId);
}

export async function setCoverAction(imageId: string): Promise<CatalogueState> {
  try {
    const ctx = await gate();
    await setCoverImage(ctx.scope, imageId);
    refresh();
    return { ok: true, message: 'Cover photo changed.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not change the cover.' };
  }
}

export async function removeImageAction(imageId: string): Promise<CatalogueState> {
  try {
    const ctx = await gate();
    await removeListingImage(ctx.scope, imageId, ctx.user.id);
    refresh();
    return { ok: true, message: 'Picture removed from the page. The file is kept.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not remove the picture.' };
  }
}

export async function saveComboAction(input: ComboInput): Promise<CatalogueState> {
  try {
    const ctx = await gate();
    await saveCombo(ctx.scope, input, ctx.user.id);
    refresh();
    return { ok: true, message: 'Combo saved.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the combo.' };
  }
}

export async function deleteComboAction(comboId: string): Promise<CatalogueState> {
  try {
    const ctx = await gate();
    await deleteCombo(ctx.scope, comboId, ctx.user.id);
    refresh();
    return { ok: true, message: 'Combo removed from the shop.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not remove the combo.' };
  }
}

/** Approve, hide or answer a shop review (5 Oct 2026). Same authority as the catalogue itself. */
export async function decideReviewAction(
  id: string, input: { status?: 'approved' | 'hidden'; reply?: string | null },
): Promise<CatalogueState> {
  try {
    const ctx = await gate();
    const { decideReview } = await import('@/server/shop-extras');
    await decideReview(ctx.scope, id, input, ctx.user.id);
    revalidatePath('/catalogue');
    return { ok: true, message: input.status === 'approved' ? 'Review published.' : input.status === 'hidden' ? 'Review hidden.' : 'Reply saved.' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save that.' };
  }
}

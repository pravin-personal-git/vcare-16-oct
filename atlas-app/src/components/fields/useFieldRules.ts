'use client';

import { useEffect, useState } from 'react';
import { fieldSetupAction } from '@/app/actions/custom-fields';
import { EMPTY_SETUP, stdRequired, stdShown, type FieldEntity, type FieldSetup } from '@/lib/custom-fields';

/**
 * The branch's Field rules for a document form (5 Oct 2026).
 *
 * Complaints get their rules threaded down from the page, because that screen
 * has one place that opens the dialog. Quotations, sales orders and invoices
 * each open their form from two or three places, across list screens and
 * detail screens, so threading would mean editing ten files to pass one small,
 * per-branch, rarely-changing object. This fetches it once instead and keeps
 * it in a module-level cache for the rest of the visit.
 *
 * WHAT THE FIRST FRAME SHOWS. Until the rules arrive the hook reports the
 * defaults - every field shown, nothing mandatory - which is exactly how these
 * forms behaved before this existed. So the worst case is that a field the
 * owner switched off is visible for the moment it takes to answer, never that
 * a field is missing or that a save slips through: the server checks the same
 * rules again before writing, and that check is the one that counts.
 */

const cache = new Map<FieldEntity, FieldSetup>();
const inFlight = new Map<FieldEntity, Promise<FieldSetup>>();

async function load(entity: FieldEntity): Promise<FieldSetup> {
  const hit = cache.get(entity);
  if (hit) return hit;
  const running = inFlight.get(entity);
  if (running) return running;
  const p = fieldSetupAction(entity)
    .then((setup) => {
      cache.set(entity, setup);
      inFlight.delete(entity);
      return setup;
    })
    .catch(() => {
      // A failed read must not lock anybody out of raising a document.
      inFlight.delete(entity);
      return EMPTY_SETUP;
    });
  inFlight.set(entity, p);
  return p;
}

export interface FieldRules {
  /** Is this built-in field on the form? Unset means yes. */
  show: (key: string) => boolean;
  /** Must it be filled in? Unset means no. */
  need: (key: string) => boolean;
  /** False until the branch's rules have arrived. */
  loaded: boolean;
}

export function useFieldRules(entity: FieldEntity): FieldRules {
  const [setup, setSetup] = useState<FieldSetup | null>(() => cache.get(entity) ?? null);

  useEffect(() => {
    let alive = true;
    void load(entity).then((s) => { if (alive) setSetup(s); });
    return () => { alive = false; };
  }, [entity]);

  const s = setup ?? EMPTY_SETUP;
  return {
    show: (key) => stdShown(s, key),
    need: (key) => stdShown(s, key) && stdRequired(s, key),
    loaded: setup !== null,
  };
}

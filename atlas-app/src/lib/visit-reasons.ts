/**
 * WHY A TECHNICIAN IS GOING OUT (Vcare meeting wave 3, 7 Oct 2026).
 *
 * Pravin: "visits need an assignable reason - new installation, or an existing
 * complaint - PURA HI NAYA SYSTEM HONA CHAHIYE."
 *
 * The data said the same thing more bluntly. Vcare's database holds **2**
 * service visits. In the same period: 906 installation challans, 887 with a
 * technician named on them, and 3,552 complaints. The scheduler was not
 * under-used, it was unusable for half the work - a visit could only hang off
 * a complaint, so a new installation had nowhere to be booked and the office
 * went on telling customers a date over the phone.
 *
 * So a visit now says what it is about, and that answer decides what it must
 * be attached to. `subject` is the load-bearing part of each row: the server
 * reads it rather than carrying its own `if` per reason, which is what keeps
 * adding a seventh reason to this file a one-line change.
 *
 * `purpose` on ServiceVisit is NOT this. Purpose says what kind of trip it is
 * - attend the site, or collect information. The reason says what brought it
 * about. A survey trip for a new installation has purpose `info_collection`
 * and reason `new_installation`, and both facts are worth having.
 */

import type { IconName } from '@/components/ui/Icon';

export type VisitSubject = 'complaint' | 'installation';

export interface VisitReason {
  key: string;
  /** What the coordinator picks from. Plain words, not a system term. */
  label: string;
  /** One line under the label, saying when to choose it. */
  hint: string;
  /** Which record the visit must be attached to. */
  subject: VisitSubject;
  icon: IconName;
}

export const VISIT_REASONS: VisitReason[] = [
  {
    key: 'new_installation',
    label: 'New installation',
    hint: 'Fitting something for the first time, against an installation challan.',
    subject: 'installation',
    icon: 'package',
  },
  {
    key: 'installation_survey',
    label: 'Survey before installing',
    hint: 'Going to look at the site and measure up before the fitting date.',
    subject: 'installation',
    icon: 'map-pin',
  },
  {
    key: 'existing_complaint',
    label: 'Existing complaint',
    hint: 'A customer has reported a fault and somebody has to attend.',
    subject: 'complaint',
    icon: 'wrench',
  },
  {
    key: 'follow_up',
    label: 'Follow-up on a complaint',
    hint: 'A second trip for a job that was already attended once.',
    subject: 'complaint',
    icon: 'rotate-ccw',
  },
  {
    key: 'maintenance',
    label: 'Contract service',
    hint: 'A scheduled service the customer pays for under a maintenance contract.',
    subject: 'complaint',
    icon: 'shield-check',
  },
  {
    key: 'refit',
    label: 'Fitting a repaired item back',
    hint: 'Taking an item back from the supplier to the customer and fitting it (pickup and refit are two visits).',
    subject: 'complaint',
    icon: 'wrench',
  },
  {
    key: 'part_collection',
    label: 'Collecting a faulty part',
    hint: 'Going only to pick a faulty item up and bring it back.',
    subject: 'complaint',
    icon: 'box',
  },
];

export const visitReason = (key: string): VisitReason | undefined =>
  VISIT_REASONS.find((r) => r.key === key);

/**
 * What a visit with this reason must be attached to.
 *
 * An unknown key answers `complaint`, which is how every visit behaved before
 * this file existed. A reason that has been retired must not make an old
 * visit undrawable.
 */
export const visitSubject = (key: string): VisitSubject =>
  visitReason(key)?.subject ?? 'complaint';

/** For a list column or a badge. Falls back to the stored key, never blank. */
export const visitReasonLabel = (key: string): string =>
  visitReason(key)?.label ?? key;

export const VISIT_REASON_KEYS = VISIT_REASONS.map((r) => r.key);

/** The reasons that go with a given subject, for the form's picker. */
export const reasonsFor = (subject: VisitSubject): VisitReason[] =>
  VISIT_REASONS.filter((r) => r.subject === subject);

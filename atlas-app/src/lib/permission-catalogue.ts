/**
 * EVERY PERMISSION ATLAS HAS - THE ONE LIST (10 Oct 2026).
 *
 * This lived in three places: `prisma/seed.ts`, `prisma/provision-prod.ts`
 * and `prisma/sync-tenant-defaults.ts`, each with a comment telling the next
 * person to keep it in step with the other two. They had drifted: seed was
 * missing ten keys and provision-prod fourteen, among them every `purchase.*`
 * and every `attendance.*`.
 *
 * That is not a cosmetic drift. The Roles editor only offers a module whose
 * keys exist as `Permission` rows, so a freshly seeded dev database - or a
 * freshly provisioned tenant, until the next `db:defaults` run - had a Roles
 * screen with no Purchase and no Attendance at all, and no way to tell that
 * something was missing rather than absent by design.
 *
 * So the three lists are now one import. `lib/__tests__/permission-catalogue.test.ts`
 * fails the build if a prisma script grows its own copy again.
 *
 * In `src/lib` rather than `prisma/` because the tests and the Roles editor
 * read it too, and `sync-tenant-defaults` already imports from here.
 */

export const PERMISSION_CATALOGUE = [
  'dashboard.view',
  'leads.view', 'leads.create', 'leads.edit', 'leads.delete',
  'customers.view', 'customers.create', 'customers.edit',
  'quotation.view', 'quotation.create', 'quotation.edit',
  'quotation.approve', 'quotation.delete',
  'orders.view', 'orders.create', 'orders.edit', 'orders.approve',
  'invoice.view', 'invoice.create', 'invoice.edit', 'invoice.approve',
  // WHAT THIS BILL COST US. Added 2 Oct 2026.
  //
  // An invoice shows a customer the charge and what it is for. An employee
  // holding this can open any line and see which challan, which order and
  // which physical unit it came from - and from there, what we paid for it.
  //
  // Separate from `invoice.view` because the two answer to different people.
  // The person who raises bills and chases payment needs to read an invoice all
  // day; what the goods cost the business, and therefore what the margin is on
  // this customer, is not the same information and plenty of shops do not want
  // it on the same desk.
  'invoice.costTrail',
  // Goods coming back and money going back are separate authorities. In most
  // shops the person at the counter can accept a return, and only a manager can
  // credit it - one permission for both makes that arrangement impossible to
  // express, which is why `returns.edit` and `returns.credit` are distinct.
  'returns.view', 'returns.edit', 'returns.credit',
  // Call logs. `calls.view` is a manager's report on their team; `calls.manage`
  // pairs and revokes the phones themselves, which is a device-trust decision.
  'calls.view', 'calls.manage',
  // Vcare: pairing an employee's phone - the device-trust decision on its
  // own, so an admin can let a supervisor pair phones without the call reports.
  'devices.pair',
  // Attendance is deliberately NOT folded into `calls.view`.
  //
  // They come from the same phone and arrive in the same sync, so lumping them
  // together is tempting. But they answer to different people: a sales manager
  // reads call activity, and who worked which hours - and where they were -
  // belongs to whoever runs payroll. Some shops those are one person; plenty
  // they are not, and a single permission makes the split impossible to
  // express.
  //
  // `attendance.locate` is separated again because a location trail is the most
  // invasive thing this product holds. Someone can be allowed to see that Rahul
  // worked 08:12 to 19:40 without being allowed to see everywhere he went.
  //
  // `attendance.edit` is the only WRITE on that screen - correcting a shift
  // somebody forgot to close. It changes a number that becomes a wage, so
  // plenty of people should see attendance and very few should be able to
  // change it after the fact.
  'attendance.view', 'attendance.locate', 'attendance.edit',
  // Purchases. Three authorities, not one, because in most shops they are
  // genuinely three people:
  //   `purchase.view`  - see what was bought and what it cost
  //   `purchase.edit`  - enter and post a bill, which puts stock in and
  //                      creates a liability
  //   `purchase.pay`   - send money out
  // Whoever receives the goods should not necessarily be able to pay for them;
  // that separation is the oldest control in accounting and folding it into one
  // permission makes it impossible to express.
  'purchase.view', 'purchase.edit', 'purchase.pay', 'purchase.approve',
  'products.view', 'products.edit',
  'stock.view', 'stock.adjust',
  'accounts.view', 'accounts.edit',
  'hrm.view', 'hrm.edit',
  'payroll.view', 'payroll.process', 'payroll.configure',
  'settings.view', 'settings.edit',
  // Superadmin-roadmap §1.2 stop-gap, 21 Sep 2026 - gates "Create a new
  // business"/"Link another account" in UserMenu.tsx, previously reachable
  // by any signed-in user. New key picked up by the loop below and auto-
  // granted to every existing tenant's isSystem (Admin) role on the next
  // deploy, same as any other permission added here - see seed.ts's fuller
  // comment on this same key. Slice 8 replaces this with a real per-tenant
  // flag; this is the same-day fix for the immediate symptom.
  'business.selfService',
  'users.view', 'users.edit',
  // Vcare, 9 Oct 2026: read a user's sealed password copy
  // (server/password-copy.ts). Auto-granted to Admin on the next deploy like
  // every key here; any other role has to be given it on purpose.
  'users.viewPasswords',
  'tasks.edit',
  // Services & Complaints. One edit permission covers raising a complaint,
  // assigning a technician, deciding the resolution, scheduling or completing
  // a visit, and raising a repair challan - all of it is the same "runs the
  // service desk" authority. `complaints.view` is separate so a read-only
  // report on complaint volume can be granted without also granting the
  // ability to reassign one.
  'complaints.view', 'complaints.edit',
  // 28 Sep 2026: approve job challans (parts) and job closes when no Approval
  // Rule is set - so an employee, not only the owner, can run the parts desk.
  'complaints.approve',
  // Helpdesk - internal employee tickets, distinct from `complaints.*` which
  // is the customer-facing service desk. `helpdesk.view` sees every ticket
  // in the store (the support queue); raising and commenting on your OWN
  // ticket needs neither permission, the same as `asset_request`.
  'helpdesk.view', 'helpdesk.edit',
  // 27 Sep 2026 (streamline S3): four modules that rode on broader keys get
  // their own, so the owner can grant them separately - policy renewals (was
  // HR), AMC contracts and installation challans (were Complaints), company
  // assets (were HR/Settings/Stock). SPLIT_MODULE_GRANTS moves every role
  // over once, exactly as it could already act, when the keys first appear.
  'renewals.view', 'renewals.edit',
  'amc.view', 'amc.edit',
  'installations.view', 'installations.edit',
  'assets.view', 'assets.edit',
] as const;

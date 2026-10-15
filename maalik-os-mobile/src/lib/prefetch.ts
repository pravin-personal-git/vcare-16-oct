import { loadSession } from './session';
import { loadAccess } from './access';
import { isOfflineNow } from './net';
import {
  complaintDetail, installation, myComplaints, myInstallations, myJobs, myLeads, myTasks, myVan, waitingApprovals, myDesk,
} from './jobs';
import { fetchReminders } from './reminders';
import { officeJobs, ownerSummary } from './owner';
import { invoices, orders, quotations, refreshNumbers, salesCatalogue } from './sales';
import { customers, stockOnHand } from './customers';
import { moneyPage, teamToday } from './people';
import { shopRequests } from './shopRequests';

/**
 * OFFLINE, PART 3 - DOWNLOAD BEFORE IT IS NEEDED (F-13, 13 Oct 2026).
 *
 * The last-good-copy (lib/net) only helps for screens already opened. So while
 * there is signal, the phone quietly reads what this person may need in a
 * basement: their lists, and the full page of every job and installation in
 * My work - not the whole branch. Each read is kept by `authed` as usual.
 * At most every 10 minutes, one request at a time (gentle on a weak signal),
 * and never while offline. Nothing here can fail loudly.
 */
const EVERY_MS = 10 * 60_000;
let last = 0;
let running = false;

const quietly = async (f: () => Promise<unknown>) => { try { await f(); } catch { /* not allowed or no signal - skip */ } };

export async function prefetchForOffline(force = false) {
  if (running || isOfflineNow()) return;
  if (!force && Date.now() - last < EVERY_MS) return;
  const s = await loadSession();
  if (!s || s.kind !== 'user') return;
  running = true;
  last = Date.now();
  try {
    const a = await loadAccess();
    const perms = new Set(s.permissions ?? []);
    const has = (...k: string[]) => k.some((x) => perms.has(x));
    // Sales (native admin app part 2): the catalogue and quotations, so a quotation can be made offline.
    if (has('quotation.view', 'quotation.create', 'orders.create', 'invoice.create')) await quietly(salesCatalogue);
    if (has('quotation.view', 'quotation.create')) await quietly(() => quotations('active'));
    // Part 3: this phone's invoice numbers (topped up while online) and the lists.
    if (has('invoice.create')) await quietly(refreshNumbers);
    if (has('invoice.view', 'invoice.create')) await quietly(() => invoices('active'));
    if (has('orders.view', 'orders.create', 'orders.edit')) await quietly(() => orders('active'));
    // Part 4: customers and stock on hand.
    if (has('customers.view', 'customers.create', 'customers.edit')) await quietly(customers);
    if (has('stock.view', 'purchase.view', 'purchase.edit')) await quietly(stockOnHand);
    // Part 5: team today and money.
    if (has('attendance.view')) await quietly(teamToday);
    if (has('accounts.view', 'accounts.edit')) await quietly(moneyPage);
    if (has('leads.view', 'leads.edit', 'leads.create', 'complaints.edit')) await quietly(shopRequests);
    if (s.home === 'owner') {
      await quietly(officeJobs);
      await quietly(ownerSummary);
      await quietly(waitingApprovals);
      await quietly(fetchReminders);
      return;
    }
    const mine = await myJobs().catch(() => null);
    for (const j of mine?.jobs ?? []) {
      if (isOfflineNow()) break;
      await quietly(() => (j.kind === 'complaint' ? complaintDetail(j.id) : installation(j.id)));
    }
    if (a.sections.complaints && has('complaints.view', 'complaints.edit')) await quietly(() => myComplaints(false));
    if (a.sections.installations && has('orders.view', 'orders.edit')) await quietly(() => myInstallations(false));
    if (a.sections.tasks) await quietly(() => myTasks(false));
    if (a.sections.leads && has('leads.view', 'leads.edit', 'leads.create')) await quietly(() => myLeads(false));
    if (a.sections.van) await quietly(myVan);
    await quietly(waitingApprovals);
    await quietly(myDesk);
    await quietly(fetchReminders);
  } finally {
    running = false;
  }
}

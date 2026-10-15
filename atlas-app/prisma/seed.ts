/**
 * Seed data for Phase 0.
 *
 * Creates one organisation, two stores, the 17-group menu tree, a permission
 * set, two roles with deliberately different menu access, and two users.
 *
 * The point is to make the Phase 0 exit criteria demonstrable: two users log in
 * and see genuinely different navigation, and switching stores changes scope.
 *
 * Run:  npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { PERMISSION_CATALOGUE } from '../src/lib/permission-catalogue';

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;
const db = new PrismaClient();

/**
 * Seeding is destructive-adjacent: it creates demo users with a known password
 * and eighty fake customers. Running it against production would be a bad day.
 *
 * The guard is deliberately opt-out rather than opt-in, so a forgotten
 * environment variable fails safe.
 */
function assertNotProduction(): void {
  const appEnv = process.env.APP_ENV ?? 'development';
  const override = process.env.ALLOW_PROD_SEED === 'yes-i-am-sure';

  if (appEnv === 'production' && !override) {
    console.error(
      '\n  REFUSING TO SEED.\n\n' +
      '  APP_ENV is "production". This seed creates demo users with a known\n' +
      '  password and 80 fake customers.\n\n' +
      '  If you genuinely intend this, set:\n' +
      '      ALLOW_PROD_SEED=yes-i-am-sure\n',
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL ?? '';
  const host = url.match(/@([^:/?]+)/)?.[1] ?? 'unknown host';
  console.log(`  target: ${host}  (APP_ENV=${appEnv})\n`);
}


async function hash(plain: string) {
  const salt = randomBytes(16);
  const h = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

const code = (n: number) =>
  randomBytes(n).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, n);

/** The 17 sidebar groups and their children, per 00-architecture.md §6. */
interface MenuTreeNode {
  label: string;
  route: string | null;
  children?: MenuTreeNode[];
}

const MENU_TREE: MenuTreeNode[] = [
  /*
    THE ORDER PRAVIN ASKED FOR (14 Oct 2026). The work follows the day: sell
    it, service it, then what you hold, then what you spend and what you owe,
    then people, then the lists nobody opens daily.

    This array's POSITION is the sort order a new tenant gets (createMenuTree
    below numbers them as it walks). The migration
    20261015010000_menu_order_pravin sets the same order on tenants that
    already exist - change one and you have to change the other, or a new
    client gets a different sidebar from everybody else.
  */
  { label: 'Dashboard', route: '/dashboard' },
  { label: 'Sales', route: null, children: [
    { label: 'Leads', route: '/crm/leads' },
    { label: 'Customers', route: '/customers' },
    { label: 'Quotation', route: '/quotation' },
    { label: 'Sales Orders', route: '/sales/orders' },
    { label: 'Invoices', route: '/invoices' },
    { label: 'My Target', route: '/my/target' },
    { label: 'Sales Team Calls', route: '/call-logs?team=sales' },
  ]},
  /*
    CUSTOMER SERVICE, in Pravin's order (7 Oct 2026, finished 8 Oct).

    A new tenant must be seeded with the menu the migrations produce, or it
    starts life needing them. The old group name and the four old labels used
    to live here; they are what the sync kept rebuilding on top of a renamed
    tenant until both files were brought into line.

    Team Performance is NOT here - it moved to HRM, where people are measured.
  */
  { label: 'Customer Service', route: null, children: [
    { label: 'Jobs Dashboard', route: '/services/board' },
    { label: 'Visit Scheduler', route: '/services/visits' },
    { label: 'New Installations', route: '/services/installations' },
    { label: 'Complaints Tracker', route: '/services/complaints' },
    { label: 'Maintenance Contracts', route: '/services/amc' },
    { label: 'Repairs & Replacements', route: '/services/replacements' },
    { label: 'Repair challans (history)', route: '/services/repairs' },
    { label: 'Service Team Calls', route: '/call-logs?team=service' },
  ]},
  { label: 'Inventory', route: null, children: [
    { label: 'Stock', route: '/reports/product-stock' },
    { label: 'Production Order', route: '/manufacturing/orders' },
    { label: 'Product BOM', route: '/manufacturing/bom' },
    { label: 'Goods Dispatch Note', route: '/goods-dispatch', children: [
      { label: 'Complaint GDNs', route: '/goods-dispatch/complaint-gdns' },
    ] },
    { label: 'Goods Receipt Note', route: '/goods-receipt' },
    { label: 'Product History', route: '/product-journey' },
  ]},
  { label: 'Products', route: '/products' },
  // The shop: its catalogue and what customers asked for in it (13 Oct 2026).
  { label: 'Office Expenses', route: '/transactions' },
  { label: 'Accounts', route: null, children: [
    { label: 'Dashboard', route: '/accounts/dashboard' },
    // First of the records because it is the one people open daily. The
    // reference had no equivalent - it hung payments off invoices, which is the
    // model this replaces.
    { label: 'Receipts', route: '/receipts' },
    { label: 'GST Computation', route: '/reports/gst' },
    { label: 'Supplier Account', route: '/supplier/account' },
    { label: 'Customer Account', route: '/customer/account' },
    { label: 'Staff Account', route: '/user/account' },
    { label: 'Courier & Shipping', route: '/courier' },
    // The read-only copies - recorded under Returns & Refunds.
    { label: 'Sales Return', route: '/accounts/sales-return' },
    { label: 'Credit Notes', route: '/accounts/credit-notes' },
    { label: 'Sales Incentive', route: '/employee/incentive' },
    { label: 'Bank Statement', route: '/bank/summary' },
    { label: 'Close the Books', route: '/settings/period-lock' },
  ]},
  // Its own group, not buried in Accounts: this is a daily job (9 Oct 2026).
  { label: 'Purchase', route: null, children: [
    { label: 'Purchase Return', route: '/purchase-return' },
    { label: 'Purchase Order', route: '/purchase/orders' },
  ]},
  // The 14-row HRM accordion, per the HRM-in-Atlas roadmap's §4.1 (Phase 0,
  // shipped 20 Sep 2026) - matches atlas-hrns's own sidebar order. Rows 3-6
  // and 14 are themselves accordions (nested children); the rest are plain
  // links, several of them one-page stand-ins for a module a later phase
  // (Recruitment/Payroll gain more children in Phase 3, Project in Phase 4,
  // Reports in Phase 5) will turn into a real accordion once it has more
  // than one destination.
  { label: 'Returns & Refunds', route: null, children: [
    { label: 'Sales Return', route: '/sales-return' },
    { label: 'Credit Notes', route: '/credit-notes' },
  ]},
  { label: 'HRM', route: null, children: [
    { label: 'HRM Homescreen', route: '/hrm' },
    { label: 'Dashboard', route: '/hrm/dashboard' },
    { label: 'Employee', route: null, children: [
      { label: 'Employees', route: '/settings/employees' },
      { label: 'Organization Chart', route: '/hierarchy' },
      { label: 'Work Schedules', route: '/hrm/work-schedules' },
      { label: 'Policies & Discipline', route: '/hrm/discipline' },
      { label: 'Configuration', route: '/hrm/employee-config' },
    ]},
    { label: 'Attendance', route: null, children: [
      { label: 'Monthly Grid', route: '/attendance/grid' },
      { label: 'Team Today', route: '/attendance/team-today' },
      { label: 'Shift Log', route: '/attendance/shifts' },
      { label: 'Daily Work Status', route: '/attendance/daily-status' },
      { label: 'Check-in/Check-out Log', route: '/attendance/checkin-log' },
      { label: 'Late Arrival & Early Departure', route: '/attendance/late-early' },
      { label: 'Monthly Summary', route: '/attendance/monthly-summary' },
      { label: 'Time Policies', route: '/settings/attendance' },
      { label: 'Attendance Devices', route: '/settings/attendance/devices' },
      { label: 'Attendance Permissions', route: '/settings/attendance/permissions' },
      { label: 'Clock-in Rules', route: '/settings/attendance/clock-in-rules' },
    ]},
    { label: 'Leave', route: '/holiday/leave-types' },
    { label: 'Payroll', route: null, children: [
      { label: 'Dashboard', route: '/hrm/payroll' },
      { label: 'Salary Structure', route: '/hrm/salary' },
      { label: 'Contracts', route: '/hrm/payroll/contracts' },
      { label: 'Loans & Advances', route: '/hrm/loans' },
      { label: 'Encashments & Reimbursements', route: '/hrm/payroll/claims' },
      { label: 'Travel Allowance', route: '/hrm/payroll/travel' },
      { label: 'Income Tax', route: '/hrm/payroll/income-tax' },
    ]},
    { label: 'Recruitment', route: null, children: [
      { label: 'Candidates', route: '/hrm/recruitment' },
      { label: 'Interviews', route: '/hrm/recruitment/interviews' },
      { label: 'Talent Pool', route: '/hrm/recruitment/talent-pool' },
    ]},
    { label: 'Onboarding', route: '/hrm/onboarding' },
    { label: 'Offboarding', route: '/hrm/offboarding' },
    { label: 'Project', route: '/hrm/project' },
    { label: 'Assets', route: '/assets' },
    { label: 'Helpdesk', route: null, children: [
      { label: 'Tickets', route: '/helpdesk' },
      { label: 'FAQs', route: '/helpdesk/faqs' },
    ]},
    { label: 'Reports', route: '/hrm/reports' },
    { label: 'Insurance and Policy', route: '/hrm/renewal' },
    /*
      It measures people, and HRM is where people are measured (7 Oct 2026).
      The route keeps its old name so no bookmark or link breaks.
    */
    { label: 'Team Performance', route: '/services/technicians' },
  ]},
  { label: 'Financial Reports', route: null, children: [
    { label: 'Profit & Loss', route: '/reports/profit-loss' },
    { label: 'Balance Sheet', route: '/reports/balance-sheet' },
    { label: 'Document Numbers', route: '/reports/document-numbers' },
  ]},
  { label: 'Suppliers', route: '/suppliers' },
  // ACCOUNTS IS A PLACE TO READ (9 Oct 2026). Nothing is recorded from this
  // group: spending goes to Office Expenses, returns and credit notes to
  // Returns & Refunds, loans and advances to HRM. A CA or an owner opens this
  // menu to understand the books, not to change them.
  { label: 'Task Manager', route: '/tasks' },
  { label: 'Catalogue', route: null, children: [
    { label: 'Catalogue', route: '/catalogue' },
    { label: 'Shop Requests', route: '/sales/shop-requests' },
  ]},
  { label: 'Common Hub', route: null, children: [
    { label: 'Notices & Announcements', route: '/notices' },
    { label: 'Shared Files & Docs', route: '/files' },
    { label: 'Terms & Policy', route: '/terms' },
    /*
      The header rail's four link icons moved into the menu on 14 Oct 2026.
      Terms & Policy above was the rail's "Notes"; these two are the SOP
      Guidebook (which was top-level only because the rail's help icon
      pointed at it) and Messages, the one page in the whole rail that the
      sidebar had never listed.
    */
    { label: 'SOP Guidebook', route: '/handbook/sop' },
    { label: 'Messages', route: '/messages' },
  ]},
  // Settings open from one place since 5 Oct 2026 (lib/settings-only-routes).
  { label: 'Settings', route: '/settings/hub' },
];

/**
 * Every permission Atlas has, from the ONE list (10 Oct 2026).
 *
 * This used to be its own copy, with a comment asking the next person to
 * keep it in step with the other two. It had drifted - see
 * src/lib/permission-catalogue.ts for what that cost.
 */
const PERMISSIONS: readonly string[] = PERMISSION_CATALOGUE;

/** Sales sees only Dashboard and Sales. Admin sees everything. */
const SALES_MENUS = ['Dashboard', 'Sales'];

async function main() {
  assertNotProduction();
  console.log('Seeding…');

  // The platform-ownership spine (D048/D049) - one root PLATFORM account and
  // its config, the same singletons `backfill-platform-root.ts` creates
  // against an already-running database. A fresh `npm run db:seed` needs
  // this to exist too, since every Organization below requires one.
  let platformRoot = await db.platformAccount.findFirst({
    where: { type: 'PLATFORM', parentAccountId: null },
  });
  if (!platformRoot) {
    const created = await db.platformAccount.create({
      data: {
        type: 'PLATFORM', parentAccountId: null, rootPlatformId: '', path: '',
        name: 'Atlas Platform', accountCode: 'PLATFORM-ROOT', lifecycleState: 'ACTIVE',
      },
    });
    platformRoot = await db.platformAccount.update({
      where: { id: created.id },
      data: { rootPlatformId: created.id, path: created.id },
    });
  }
  if (!(await db.platformConfig.findFirst())) {
    await db.platformConfig.create({ data: { maxResellerDepth: 1 } });
  }

  /**
   * `themeTokens` is deliberately in BOTH `update` and `create`.
   *
   * A tenant row only carries the tokens it actually overrides - the palette
   * itself lives in globals.css. But an org seeded before a palette change
   * still holds the old values, and because they are injected as `:root`
   * overrides they beat the stylesheet: the app keeps rendering the previous
   * brand no matter what you change in CSS. Resetting them on every seed is
   * what makes `npm run db:seed` a reliable way back to the current default.
   */
  const org = await db.organization.upsert({
    where: { orgCode: 'ORG-2026-0001' },
    update: { themeTokens: {} },
    create: {
      orgCode: 'ORG-2026-0001',
      name: 'Atlas Demo Company',
      orgSize: '10-49',
      industry: 'Retail',
      email: 'demo@atlas.local',
      countryCode: '+91',
      themeTokens: {},
      platformAccountId: platformRoot.id,
    },
  });

  // D046 - every Store needs a LegalEntity. One default per organisation,
  // same convention as `backfill-legal-entity.ts`/`provisioning.ts`.
  const legalEntity = await db.legalEntity.upsert({
    where: { organizationId_name: { organizationId: org.id, name: org.name } },
    update: {},
    create: { organizationId: org.id, name: org.name, status: 'APPROVED', approvedAt: new Date() },
  });

  const storeA = await db.store.upsert({
    where: { organizationId_branchCode: { organizationId: org.id, branchCode: 'BR001' } },
    update: {},
    create: {
      organizationId: org.id, legalEntityId: legalEntity.id, name: 'Bhilai Main', branchCode: 'BR001',
      stateId: 'CG', cityId: 'Bhilai', address: 'Nehru Nagar, Bhilai',
    },
  });

  const storeB = await db.store.upsert({
    where: { organizationId_branchCode: { organizationId: org.id, branchCode: 'BR002' } },
    update: {},
    create: {
      organizationId: org.id, legalEntityId: legalEntity.id, name: 'Raipur Branch', branchCode: 'BR002',
      stateId: 'CG', cityId: 'Raipur', address: 'Pandri, Raipur',
    },
  });

  // ---- permissions
  for (const key of PERMISSIONS) {
    const [module, action] = key.split('.');
    await db.permission.upsert({
      where: { key }, update: {}, create: { key, module, action },
    });
  }
  // Store-scoped roles never receive a platform-level permission
  // (`platformTenant.*`/`platformReseller.*`, granted only via
  // PlatformRolePermission below) - `db.permission.findMany()` returns every
  // Permission row regardless of which script created it, so this must
  // filter explicitly rather than assume only PERMISSIONS' own keys exist.
  // Same fix as `sync-tenant-defaults.ts`'s `storeGrantable`, found the same
  // way: db:defaults (which creates the platform rows) had already run
  // against this database before db:seed did, and every one of them leaked
  // onto the tenant Admin role.
  const allPerms = (await db.permission.findMany()).filter((p) => !p.module.startsWith('platform'));
  /**
   * Sales may raise and progress work but not sign it off.
   *
   * Whoever books an order should not be the person who approves it, and
   * whoever raises an invoice should not be the person who cancels it - a
   * cancellation with no second pair of eyes is how revenue quietly disappears.
   * That separation is the entire point of having an approval step, so the
   * two `.approve` keys are withheld deliberately.
   *
   * `dashboard` deliberately NOT included, unlike before 21 Sep 2026 - the
   * Admin Dashboard is now actually gated on `dashboard.view` (it used to
   * exist as a permission key nothing ever checked), so granting it here
   * would put every demo Sales login back on the company-wide financial
   * dashboard instead of their own landing page. Sales still gets a
   * `Dashboard` menu link (see `SALES_MENUS` below) - it just resolves to
   * their own view now, not the Admin one.
   */
  const salesPerms = allPerms.filter(
    (p) =>
      ['leads', 'customers', 'quotation', 'orders', 'invoice'].includes(p.module) &&
      !['orders.approve', 'invoice.approve'].includes(p.key),
  );

  // ---- menu tree (shared across stores)
  //
  // Recursive so a group like HRM can nest its own accordion rows (Employee,
  // Attendance, ...) rather than stopping at one flat level of children.
  async function createMenuTree(nodes: MenuTreeNode[], parentId: string | null) {
    let sort = 0;
    for (const node of nodes) {
      const m = await db.menu.create({
        data: { parentId, label: node.label, route: node.route, sort: sort++, platform: 'WEB' },
      });
      if (node.children?.length) await createMenuTree(node.children, m.id);
    }
  }

  const existingMenus = await db.menu.count();
  if (existingMenus === 0) {
    await createMenuTree(MENU_TREE, null);
  }
  const menus = await db.menu.findMany({ orderBy: { sort: 'asc' } });
  const rootByLabel = new Map(menus.filter((m) => !m.parentId).map((m) => [m.label, m]));

  // ---- roles, per store
  for (const store of [storeA, storeB]) {
    const admin = await db.role.upsert({
      where: { storeId_name: { storeId: store.id, name: 'Admin' } },
      update: {},
      create: {
        storeId: store.id, name: 'Admin', description: 'Full access', isSystem: true,
        designationCode: 'ADMIN', level: 1,
      },
    });
    const sales = await db.role.upsert({
      where: { storeId_name: { storeId: store.id, name: 'Sales' } },
      update: {},
      create: { storeId: store.id, name: 'Sales', description: 'Sales module only' },
    });

    for (const p of allPerms) {
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: admin.id, permissionId: p.id } },
        update: {}, create: { roleId: admin.id, permissionId: p.id },
      });
    }
    for (const p of salesPerms) {
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: sales.id, permissionId: p.id } },
        update: {}, create: { roleId: sales.id, permissionId: p.id },
      });
    }

    // Store enables every menu…
    for (const m of menus) {
      await db.storeMenuConfig.upsert({
        where: { storeId_menuId: { storeId: store.id, menuId: m.id } },
        update: { isEnabled: true },
        create: { storeId: store.id, menuId: m.id, isEnabled: true },
      });
    }

    // …and each role narrows within it.
    const salesMenuIds = new Set<string>();
    for (const label of SALES_MENUS) {
      const root = rootByLabel.get(label);
      if (!root) continue;
      salesMenuIds.add(root.id);
      for (const child of menus.filter((m) => m.parentId === root.id)) {
        salesMenuIds.add(child.id);
      }
    }

    for (const m of menus) {
      await db.roleMenuConfig.upsert({
        where: { storeId_roleId_menuId: { storeId: store.id, roleId: admin.id, menuId: m.id } },
        update: { isVisible: true },
        create: { storeId: store.id, roleId: admin.id, menuId: m.id, isVisible: true },
      });
      await db.roleMenuConfig.upsert({
        where: { storeId_roleId_menuId: { storeId: store.id, roleId: sales.id, menuId: m.id } },
        update: { isVisible: salesMenuIds.has(m.id) },
        create: {
          storeId: store.id, roleId: sales.id, menuId: m.id,
          isVisible: salesMenuIds.has(m.id),
        },
      });
    }
  }

  // ---- departments
  for (const d of [['Sales', 'SALES'], ['Accounts', 'ACCTS'], ['Admin', 'ADMIN']]) {
    await db.department.upsert({
      where: { storeId_code: { storeId: storeA.id, code: d[1] } },
      update: {}, create: { storeId: storeA.id, name: d[0], code: d[1] },
    });
  }

  // ---- users
  const pwd = await hash('Atlas@2026');

  const admin = await db.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      userCode: code(6), organizationId: org.id, fullName: 'Demo Admin',
      username: 'admin', email: 'admin@atlas.local', passwordHash: pwd,
    },
  });

  const sales = await db.user.upsert({
    where: { username: 'sales' },
    update: {},
    create: {
      userCode: code(6), organizationId: org.id, fullName: 'Demo Salesperson',
      username: 'sales', email: 'sales@atlas.local', passwordHash: pwd,
    },
  });

  // ---- platform owner (D045) - a login with no tenant at all, only a
  // Membership onto the root PLATFORM account. Demonstrates the
  // `/platform/*` shell exists independently of every tenant screen above.
  const PLATFORM_PERM_KEYS = [
    'platformTenant.view', 'platformTenant.create', 'platformTenant.suspend', 'platformTenant.access',
    'platformTenant.manageCredentials', 'platformTenant.manageFlags',
    'platformConfig.edit', 'platformAudit.view',
    'platformReseller.view', 'platformReseller.create', 'platformReseller.suspend',
  ];
  for (const key of PLATFORM_PERM_KEYS) {
    const [module, action] = key.split('.');
    await db.permission.upsert({ where: { key }, update: {}, create: { key, module, action } });
  }
  const platformOwnerRole = await db.platformRole.upsert({
    where: { key: 'PLATFORM_OWNER' },
    update: {},
    create: { key: 'PLATFORM_OWNER', name: 'Platform Owner', scopeType: 'PLATFORM', isSystem: true },
  });
  for (const key of PLATFORM_PERM_KEYS) {
    const permission = await db.permission.findUniqueOrThrow({ where: { key } });
    await db.platformRolePermission.upsert({
      where: { platformRoleId_permissionId: { platformRoleId: platformOwnerRole.id, permissionId: permission.id } },
      update: {}, create: { platformRoleId: platformOwnerRole.id, permissionId: permission.id },
    });
  }
  const platformOwner = await db.user.upsert({
    where: { username: 'platform_owner' },
    update: {},
    create: {
      userCode: code(6), organizationId: null, fullName: 'Demo Platform Owner',
      username: 'platform_owner', email: 'platform@atlas.local', passwordHash: pwd,
    },
  });
  // No natural unique key on (userId, platformRoleId, platformAccountId) -
  // find-then-create instead, same idempotence as every other
  // upsert-lacking loop in this file.
  const existingMembership = await db.membership.findFirst({
    where: { userId: platformOwner.id, platformRoleId: platformOwnerRole.id, platformAccountId: platformRoot.id },
  });
  if (!existingMembership) {
    await db.membership.create({
      data: { userId: platformOwner.id, platformRoleId: platformOwnerRole.id, platformAccountId: platformRoot.id },
    });
  }

  const adminRoleA = await db.role.findFirstOrThrow({ where: { storeId: storeA.id, name: 'Admin' } });
  const adminRoleB = await db.role.findFirstOrThrow({ where: { storeId: storeB.id, name: 'Admin' } });
  const salesRoleA = await db.role.findFirstOrThrow({ where: { storeId: storeA.id, name: 'Sales' } });

  // Admin: both stores. Sales: one store only - proves scoping visibly.
  for (const [u, s, r] of [
    [admin.id, storeA.id, adminRoleA.id],
    [admin.id, storeB.id, adminRoleB.id],
    [sales.id, storeA.id, salesRoleA.id],
  ] as const) {
    await db.userStoreRole.upsert({
      where: { userId_storeId_roleId: { userId: u, storeId: s, roleId: r } },
      update: {}, create: { userId: u, storeId: s, roleId: r },
    });
  }

  // ---- document sequences
  for (const store of [storeA, storeB]) {
    for (const t of ['QT', 'SO', 'INV', 'PO', 'GRN', 'GDN']) {
      await db.documentSequence.upsert({
        where: { storeId_docType_financialYear: { storeId: store.id, docType: t, financialYear: 2026 } },
        update: {}, create: { storeId: store.id, docType: t, financialYear: 2026 },
      });
    }
  }


  // ---- product catalogue (store A only, so store scoping is visible)
  const CATS: [string, string, string[]][] = [
    ['CCTV & Surveillance', 'CAM', ['HD Bullet Camera', 'IP Bullet Camera', 'HD Dome Camera', 'WiFi Camera']],
    ['Networking', 'NET', ['Media Converter', 'Switch']],
    ['Gate Automation', 'GAT', ['Gate Wheel', 'Gear Rack']],
    ['Cables & Wires', 'CBL', ['CAT-6', 'Fire Alarm Cable']],
    ['Power & UPS', 'PWR', ['Power Adapter']],
  ];

  const catIds = new Map<string, string>();
  for (const [name, prefix, subs] of CATS) {
    // Prisma cannot match a composite unique that contains NULL, and root
    // categories have parentId = null - so upsert is not usable here.
    let parent = await db.category.findFirst({
      where: { storeId: storeA.id, name, parentId: null },
    });
    if (parent) {
      parent = await db.category.update({
        where: { id: parent.id }, data: { codePrefix: prefix },
      });
    } else {
      parent = await db.category.create({
        data: { storeId: storeA.id, name, codePrefix: prefix },
      });
    }
    catIds.set(name, parent.id);
    for (const sub of subs) {
      const child =
        (await db.category.findFirst({
          where: { storeId: storeA.id, name: sub, parentId: parent.id },
        })) ??
        (await db.category.create({
          data: { storeId: storeA.id, name: sub, parentId: parent.id, codePrefix: prefix },
        }));
      catIds.set(sub, child.id);
    }
  }

  const brandIds = new Map<string, string>();
  for (const b of ['CP Plus', 'Hikvision', 'D-Link', 'Polycab', 'Livfuture']) {
    const brand = await db.brand.upsert({
      where: { storeId_name: { storeId: storeA.id, name: b } },
      update: {}, create: { storeId: storeA.id, name: b },
    });
    brandIds.set(b, brand.id);
  }

  const day = 86_400_000;
  //            code          name                              cat                sub                  brand        mrp    dlp   cost  qty  reorder  lastSold(days ago|null)
  const PRODUCTS: [string, string, string, string, string, number, number, number, number, number, number | null][] = [
    ['CAM-00001', 'HD Active Bullet Camera 3MP',      'CCTV & Surveillance', 'HD Bullet Camera', 'CP Plus',   2800, 2100, 1750, 42,  10, 3],
    ['CAM-00002', 'HD Active IP 6MP Audio Bullet',    'CCTV & Surveillance', 'IP Bullet Camera', 'Hikvision', 5400, 4200, 3600, 8,   10, 12],
    ['CAM-00003', 'HD Active 2.4MP Dome Camera',      'CCTV & Surveillance', 'HD Dome Camera',   'CP Plus',   2200, 1650, 1400, 0,   15, 45],
    ['CAM-00004', 'EZVIZ WiFi Camera 3MP',            'CCTV & Surveillance', 'WiFi Camera',      'Hikvision', 3600, 2900, 2400, 25,  8,  1],
    ['NET-00001', 'Media Convertor Optic Vision',     'Networking',          'Media Converter',  'D-Link',    1800, 1350, 1100, 14,  5,  120],
    ['NET-00002', 'D-Link 8 Port Gigabit Switch',     'Networking',          'Switch',           'D-Link',    2400, 1900, 1600, 6,   6,  200],
    ['GAT-00001', 'Livfuture Swing Gate Wheel 3 inch','Gate Automation',     'Gate Wheel',       'Livfuture', 950,  700,  560,  60,  20, 400],
    ['GAT-00002', 'Livfuture Gear Rack 12mm',         'Gate Automation',     'Gear Rack',        'Livfuture', 1400, 1050, 850,  3,   10, null],
    ['CBL-00001', 'Cable CAT-6 Outdoor Premium AWG24','Cables & Wires',      'CAT-6',            'D-Link',    7200, 5400, 4400, 120, 30, 5],
    ['CBL-00002', 'Polycab FRLSH Fire Alarm 2Cx1.5',  'Cables & Wires',      'Fire Alarm Cable', 'Polycab',   6800, 5100, 4200, 0,   25, null],
    ['PWR-00001', 'Adapter 12V 5AMP',                 'Power & UPS',         'Power Adapter',    'CP Plus',   650,  480,  380,  85,  20, 2],
  ];

  for (const [code, name, cat, sub, brand, mrp, dlp, cost, qty, reorder, soldDaysAgo] of PRODUCTS) {
    const existing = await db.product.findUnique({
      where: { storeId_productCode: { storeId: storeA.id, productCode: code } },
    });
    if (existing) continue;

    await db.product.create({
      data: {
        storeId: storeA.id,
        productCode: code,
        productName: name,
        categoryId: catIds.get(cat) ?? null,
        subCategoryId: catIds.get(sub) ?? null,
        brandId: brandIds.get(brand) ?? null,
        hsnCode: '85258900',
        unit: 'pcs',
        isInOffer: code === 'CAM-00004',
        isCombo: code === 'CAM-00001',
        prices: {
          create: {
            mrpPaise: mrp * 100,
            dlpPaise: dlp * 100,
            retailPaise: Math.round(mrp * 0.9) * 100,
            wholesalePaise: Math.round(dlp * 0.95) * 100,
            costPaise: cost * 100,
            taxRatePct: 18,
          },
        },
        balances: {
          create: {
            openingQty: qty,
            currentQty: qty,
            reorderLevel: reorder,
            lastSoldAt: soldDaysAgo === null ? null : new Date(Date.now() - soldDaysAgo * day),
            lastMovementAt: new Date(),
          },
        },
      },
    });
  }


  // ---- customers (store A only) - enough rows to exercise the grid honestly
  for (const t of ['Regular', 'Wholesale', 'VIP', 'Corporate']) {
    await db.customerType.upsert({
      where: { storeId_name: { storeId: storeA.id, name: t } },
      update: {}, create: { storeId: storeA.id, name: t },
    });
  }
  const custTypes = await db.customerType.findMany({ where: { storeId: storeA.id } });

  const FIRST = ['Rajesh','Sunita','Manan','Arvind','Kanha','Anil','Priya','Vikas','Neha','Amit',
                 'Pooja','Ramesh','Kavita','Suresh','Deepa','Manoj','Anita','Sanjay','Meera','Rahul'];
  const LAST  = ['Kumar','Sahu','Agrawal','Yadav','Verma','Sharma','Nirmalkar','Thakur','Sen','Dewangan'];
  const CITIES: [string, string][] = [
    ['Bhilai','Chhattisgarh'],['Durg','Chhattisgarh'],['Raipur','Chhattisgarh'],
    ['Bilaspur','Chhattisgarh'],['Rajnandgaon','Chhattisgarh'],
  ];
  const COMPANIES = ['Enterprises','Traders','Solutions','Industries','& Sons','Agencies'];

  const existingParties = await db.party.count({ where: { storeId: storeA.id } });
  if (existingParties === 0) {
    const day = 86_400_000;
    for (let i = 0; i < 80; i++) {
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i * 3) % LAST.length];
      const [city, state] = CITIES[i % CITIES.length];
      const type = custTypes[i % custTypes.length];

      // Deliberately varied so every KPI card has something in it.
      const hasBalance = i % 3 === 0;
      const balance = hasBalance ? (i + 1) * 4500 * 100 : 0;
      const creditLimit = i % 4 === 0 ? 50_000 * 100 : i % 4 === 1 ? 25_000 * 100 : 0;
      const creditDays = creditLimit > 0 ? [15, 30, 45][i % 3] : 0;
      const overdueBy = hasBalance && i % 5 === 0 ? [10, 40, 70][i % 3] : null;

      await db.party.create({
        data: {
          storeId: storeA.id,
          partyCode: `CUST-${String(i + 1).padStart(5, '0')}`,
          companyName: i % 3 === 0 ? `${last} ${COMPANIES[i % COMPANIES.length]}` : null,
          title: i % 7 === 0 ? 'Mrs' : 'Mr',
          firstName: first,
          lastName: last,
          phone: `9${String(800000000 + i * 137).slice(0, 9)}`,
          email: i % 2 === 0 ? `${first.toLowerCase()}.${last.toLowerCase()}@example.com` : null,
          gstin: i % 6 === 0 ? `22ABCDE${String(1000 + i)}F1Z${i % 10}` : null,
          customerTypeId: type?.id ?? null,
          city, state,
          addressLine1: `Plot ${i + 1}, Sector ${(i % 9) + 1}`,
          pincode: `49${String(1001 + i).slice(0, 4)}`,
          customerSince: new Date(Date.now() - (400 - i * 3) * day),
          creditLimitPaise: creditLimit,
          creditLimitDays: creditDays,
          currentBalancePaise: balance,
          dueDate: overdueBy ? new Date(Date.now() - overdueBy * day) : null,
          rewardPoints: (i * 17) % 500,
          // spread so No Order / No Comm / dormant buckets all populate
          lastPurchaseAt: i % 4 === 0 ? null : new Date(Date.now() - (i * 2) * day),
          lastCommunicationAt: i % 5 === 0 ? null : new Date(Date.now() - (i * 3) * day),
          birthday: new Date(1985 + (i % 20), (new Date().getMonth() + (i % 3 === 0 ? 0 : 4)) % 12, ((i % 27) + 1)),
          status: i % 11 === 0 ? 'dormant' : 'active',
          // every 7th party also supplies to us - proves the dual role
          isCustomer: true,
          isSupplier: i % 7 === 0,
          supplierType: i % 7 === 0 ? (i % 14 === 0 ? 'Service' : 'Product') : null,
          payablePaise: i % 7 === 0 ? (i + 3) * 2100 * 100 : 0,
          paymentTermsDays: i % 7 === 0 ? [15, 30, 45][i % 3] : 0,
        },
      });
    }
  }


  // ---- leads (store A only)
  await db.leadPolicy.upsert({
    where: { storeId: storeA.id },
    update: {},
    create: { storeId: storeA.id, expiryDays: 90, allowDuplicateMobile: true, officeStartTime: '09:30' },
  });

  for (const n of ['Hot', 'Warm', 'Cold', 'Referral', 'Inbound', 'Outbound']) {
    await db.leadDealStage.upsert({
      where: { storeId_name: { storeId: storeA.id, name: n } },
      update: {}, create: { storeId: storeA.id, name: n },
    });
  }
  for (const n of ['IndiaMART', 'TradeIndia', 'IVR Call', 'JustDial', 'Mail', 'Referral', 'Walk-in', 'Website']) {
    await db.leadSource.upsert({
      where: { storeId_name: { storeId: storeA.id, name: n } },
      update: {}, create: { storeId: storeA.id, name: n },
    });
  }

  // Two-level stage hierarchy, exactly as in the original - 02-leads.md §4.5
  if ((await db.leadStage.count({ where: { storeId: storeA.id } })) === 0) {
    const groups: [string, number, string[], boolean, boolean][] = [
      ['Raw (Unqualified)', 1, [], false, false],
      ['New Leads', 2, ['Contacted'], false, false],
      ['Prospect', 3, ['In Progress'], false, false],
      ['Proposal Sent', 4, ['Meeting Scheduled'], false, false],
      ['Won', 5, ['Closed'], true, false],
      ['Lost', 6, [], false, true],
    ];
    for (const [name, sort, children, isWon, isLost] of groups) {
      const parent = await db.leadStage.create({
        data: {
          storeId: storeA.id, name, sort,
          isGroupHeader: children.length > 0, isWon, isLost,
        },
      });
      for (const child of children) {
        await db.leadStage.create({
          data: { storeId: storeA.id, name: child, sort, parentId: parent.id, isWon, isLost },
        });
      }
    }
  }

  if ((await db.lead.count({ where: { storeId: storeA.id } })) === 0) {
    const stages = await db.leadStage.findMany({ where: { storeId: storeA.id } });
    const dealStages = await db.leadDealStage.findMany({ where: { storeId: storeA.id } });
    const srcs = await db.leadSource.findMany({ where: { storeId: storeA.id } });
    const stageBy = (n: string) => stages.find((s) => s.name === n)?.id ?? null;
    const day = 86_400_000;

    const LEADS: [string, string, string, string, string, number, number | null, number][] = [
      // business, name, mobile, stage, deal, potential(₹), nextAction(days from now), createdDaysAgo
      ['Batras Clinic',     'Sunita Verma',   '8839575200', 'Contacted',         'Hot',      45000, -3, 8],
      ['',                  'Manan Agrawal', '8800973420', 'In Progress',       'Warm',     21420,  0, 6],
      ['Holy Kingdom School','Postor Thomas','9993293500', 'Meeting Scheduled', 'Hot',     185000,  2, 5],
      ['',                  'Arvind Yadav',  '9425201239', 'In Progress',       'Warm',      8180, -1, 5],
      ['KN Tiwari & Sons',  'KN Tiwari',     '9407981813', 'Proposal Sent',     'Hot',      17140,  1, 4],
      ['',                  'Kanha Yadav',   '7999533822', 'New Leads',         'Cold',     12000,  5, 3],
      ['A K Enterprises',   'Anil Maini',    '7987668826', 'Contacted',         'Warm',     67000, -6, 10],
      ['',                  'Sayyam Jain',   '8999909426', 'Raw (Unqualified)', 'Cold',         0, null, 2],
      ['Shanich Traders',   'Shanich Manjhi','9691474442', 'In Progress',       'Referral', 96000,  3, 7],
      ['',                  'Priya Verma',   '9826512345', 'New Leads',         'Inbound',  33000, null, 1],
      ['Deepak Industries', 'Deepak Sahu',   '9755512345', 'Closed',            'Hot',     240000, null, 30],
      ['',                  'Ramesh Thakur', '9098712345', 'Lost',              'Cold',     15000, null, 45],
    ];

    let i = 0;
    for (const [business, name, mobile, stage, deal, potential, nextIn, createdAgo] of LEADS) {
      const [first, ...restName] = name.split(' ');
      const closed = stage === 'Closed' || stage === 'Lost';
      await db.lead.create({
        data: {
          storeId: storeA.id,
          leadCode: `LEAD-${String(i + 1).padStart(3, '0')}`,
          businessName: business || null,
          title: 'Mr',
          firstName: first,
          lastName: restName.join(' ') || null,
          mobile,
          email: i % 3 === 0 ? `${first.toLowerCase()}@example.com` : null,
          city: ['Bhilai', 'Durg', 'Raipur', 'Bilaspur'][i % 4],
          state: 'Chhattisgarh',
          addressLine1: `Sector ${(i % 9) + 1}, Plot ${i + 10}`,
          stageId: stageBy(stage),
          dealStageId: dealStages.find((d) => d.name === deal)?.id ?? null,
          sourceId: srcs[i % srcs.length]?.id ?? null,
          // leave two unassigned so the KPI card is not empty
          assignedToUserId: i % 6 === 0 ? null : (i % 2 === 0 ? admin.id : sales.id),
          potentialPaise: potential * 100,
          requirement: [
            '5 camera quotation', '2 wifi outdoor camera quotation',
            'Automation swing gate operator (5m, 500kg)', 'IP & HD camera quotation',
            'CCTV installation for warehouse', 'Biometric attendance system',
          ][i % 6],
          sinceDate: new Date(Date.now() - createdAgo * day),
          createdAt: new Date(Date.now() - createdAgo * day),
          lastTalkAt: i % 3 === 0 ? new Date(Date.now() - (createdAgo - 1) * day) : null,
          nextActionAt: nextIn === null ? null : new Date(Date.now() + nextIn * day),
          isClosed: closed,
          tags: { create: i % 4 === 0 ? [{ tag: 'cctv' }, { tag: 'urgent' }] : [{ tag: 'cctv' }] },
        },
      });
      i++;
    }
  }


  // ---- lead activity so the timeline and channel counts are not empty
  if ((await db.leadActivity.count()) === 0) {
    const seededLeads = await db.lead.findMany({
      where: { storeId: storeA.id }, orderBy: { leadCode: 'asc' }, take: 6,
    });
    const day = 86_400_000;
    const script: [string, string | null, string | null][] = [
      ['call', 'connected', 'Discussed requirement, sending quote'],
      ['whatsapp', 'sent', 'Shared product catalogue'],
      ['call', 'missed', null],
      ['email', 'sent', 'Quotation emailed'],
      ['meeting', 'done', 'Site visit completed'],
      ['call', 'connected', 'Negotiating price'],
    ];
    let k = 0;
    for (const l of seededLeads) {
      for (let j = 0; j < 4; j++) {
        const [channel, outcome, note] = script[(k + j) % script.length];
        await db.leadActivity.create({
          data: {
            leadId: l.id, channel, outcome, note,
            durationSec: channel === 'call' && outcome === 'connected' ? 40 + j * 25 : null,
            occurredAt: new Date(Date.now() - (j * 2 + 1) * day),
            createdBy: j % 2 === 0 ? admin.id : sales.id,
          },
        });
      }
      await db.leadNote.create({
        data: {
          leadId: l.id, kind: 'note', createdBy: admin.id,
          body: ['Price sensitive, compare with competitor',
                 'Decision maker is the owner, not the manager',
                 'Wants installation before month end'][k % 3],
        },
      });
      k++;
    }
  }

  console.log('\nSeed complete.\n');
  console.log('  admin / Atlas@2026          → both stores, all 17 menu groups');
  console.log('  sales / Atlas@2026          → Bhilai Main only, Dashboard + Sales');
  console.log('  platform_owner / Atlas@2026 → /platform, no tenant at all');
  const supplierCount = await db.party.count({ where: { storeId: storeA.id, isSupplier: true } });
  console.log(`\n  11 products, 80 parties (${supplierCount} also suppliers) and 12 leads`);
  console.log('  seeded in Bhilai Main only.');
  console.log('  Switch to Raipur to see store scoping.\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());

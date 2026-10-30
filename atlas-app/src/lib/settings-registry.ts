/**
 * Every place in Atlas where something is configured, declared once.
 *
 * WHY THIS EXISTS (workstreams A, B and I, 1 Oct 2026).
 *
 * Settings are scattered across 24 routes and three different prefixes -
 * `/settings/`, `/settings/attendance/` and `/hrm/employee-config` - reached from
 * three separate sidebar groups. Nobody can find anything, and two screens are
 * called "Phones" and "Device Management" while a third, for biometric
 * readers, sits under `/holiday/`.
 *
 * The scatter is not fixed by moving files. It is fixed by having ONE list
 * that knows what exists, so three things can be generated from it rather than
 * maintained by hand:
 *
 *   1. the settings hub            (A - one home, grouped by question)
 *   2. search from the top bar     (B - type "challan", land on the setting)
 *   3. the coverage test           (nothing new may hide)
 *
 * `settings-registry-coverage.test.ts` fails when a settings route exists on
 * disk and is not declared here. That is the part that keeps this true in six
 * months, when somebody adds a screen in a hurry.
 *
 * THIS IS NOT `config-registry.ts`. That one declares the individual switches a
 * CLIENT flips (F1a - elements and flow steps). This declares the SCREENS those
 * switches live on, plus every other administrative screen. They answer
 * different questions and both are needed: one to render a settings page, one
 * to find it.
 */
import type { IconName } from '@/components/ui/Icon';


/**
 * FIVE SECTIONS, IN THE ORDER SOMEBODY SETS A BUSINESS UP. Rewritten 3 Oct 2026.
 *
 * There were nine, and Pravin's complaint was precise: "I know the hub exists
 * but still it feels all scattered... no clear sections or sub levels, and also
 * the custom fields is sitting entirely at a different place. So I need all the
 * things at one place with proper chronology and hierarchy, and section wise,
 * like a proper roadmap, rather than as small random scattered tabs."
 *
 * Three things were wrong and only one of them was the count.
 *
 *  1. NINE TOP-LEVEL BOXES IS NOT A STRUCTURE. Nine things in a row is a list
 *     you read end to end every time, which is the same work as the scatter it
 *     replaced.
 *  2. THERE WAS NO SECOND LEVEL. Thirty screens spread flat across nine
 *     headings still asks somebody to scan thirty cards.
 *  3. THE ORDER WAS ARBITRARY. "What you see" first and "Your company" seventh
 *     is backwards: nobody configures menus before they have entered their own
 *     company name. These five run in the order the work actually happens -
 *     your business, then what you sell, then how work flows, then who may
 *     touch it, then the fields you add yourself.
 *
 * Custom fields move INTO this, under "Your own fields", which is the specific
 * thing he said was sitting somewhere else entirely.
 */
export const SETTINGS_SECTIONS = [
  'business',
  'money',
  'selling',
  'documents',
  'people',
  'attendance',
  'devices',
  'system',
] as const;

/*
 * EIGHT STEPS, IN THE ORDER A NEW CLIENT SETS THEM UP (5 Oct 2026).
 *
 * Until then five sections grouped by theme, while eight more settings lived
 * only in the sidebar. Pravin asked for one place, in a proper order rather
 * than scattered: each step leans on the one before it - you cannot price a
 * product before its categories exist, or route an approval before the people
 * are in. The order is the order of a first week.
 */
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SECTION_LABEL: Record<SettingsSection, string> = {
  business: 'Your business',
  money: 'Money & books',
  selling: 'Products & selling',
  documents: 'Documents & approvals',
  people: 'People & access',
  attendance: 'Attendance & shifts',
  devices: 'Phones & devices',
  system: 'Data, system & security',
};

/** When in the life of an account this step is usually done. */
export const SECTION_WHEN: Record<SettingsSection, string> = {
  business: 'Day one',
  money: 'First week',
  selling: 'First week',
  documents: 'First week',
  people: 'As the team joins',
  attendance: 'As the team joins',
  devices: 'When a field team starts',
  system: 'Now and then',
};

/**
 * The headings inside each section (3 Oct 2026). A screen's `group` must be one
 * of these - the coverage test checks it.
 */
export const SECTION_GROUPS: Record<SettingsSection, string[]> = {
  business: ['Who you are', 'Reaching customers'],
  money: ['Your books', 'Banking'],
  selling: ['What things are', 'Targets and earnings', 'Orders'],
  documents: ['How documents look', 'Rules and approvals', 'Out on site'],
  people: ['Who can sign in', 'Your organisation'],
  attendance: ['Time and place', 'Machines and permissions'],
  devices: ['Phones and devices'],
  system: ['Your data', 'How Atlas behaves', 'Security and audit'],
};

export const SECTION_HINT: Record<SettingsSection, string> = {
  business: 'Who you are: name, logo, GST registrations, how Atlas looks, and how messages reach customers.',
  money: 'Where every transaction is written, what you started with, your bank accounts, and closing a month.',
  selling: 'What your products are - categories, brands, units, couriers - and the targets and incentives for selling them.',
  documents: 'How quotations, orders and invoices look and are numbered, which fields they need, and who approves them.',
  people: 'Who can sign in and what each role may do, your departments, and who reports to whom.',
  attendance: 'Office hours, where people may clock in, shifts, attendance machines and who may correct attendance.',
  devices: 'Which phone belongs to whom, pairing the Vcare app, and where everyone is signed in.',
  system: 'Bringing data in, the defaults behind every screen, connecting other software, and the record of who changed what.',
};

/**
 * Typed as `IconName`, not `string`.
 *
 * It was `string`, so `HubClient` had to cast at the call site - and a cast on an
 * icon name is how People & devices shipped `globe`, which did not exist, and
 * took the whole page down when a row was expanded. A wrong name here is now a
 * compile error.
 */
export const SECTION_ICON: Record<SettingsSection, IconName> = {
  business: 'building',
  money: 'receipt',
  selling: 'tag',
  documents: 'file-text',
  people: 'users',
  attendance: 'clock',
  devices: 'phone',
  system: 'sliders',
};

export interface SettingsEntry {
  /** Stable id. Never reused, never renamed - saved layouts and links use it. */
  key: string;
  /** What it is called on screen. */
  label: string;
  section: SettingsSection;
  /**
   * The heading inside the section (3 Oct 2026). Must be one of
   * `SECTION_GROUPS[section]` - the coverage test checks it, because a typo
   * here would silently create a heading of one.
   */
  group: string;
  /** Where it lives today. Moving a screen changes this line and nothing else. */
  route: string;
  /**
   * One line saying what this decides. Shown under the label in search results
   * and on the hub card, so nobody has to open a screen to find out whether it
   * is the one they wanted.
   */
  hint: string;
  /**
   * Words somebody might type that are NOT in the label.
   *
   * This is the whole difference between a search box that works and one that
   * does not. Nobody types "Parameters" when they want units and HSN codes;
   * they type "HSN", or "unit", or "tax code".
   */
  keywords?: string[];
  /** Permission required. Absent means any signed-in user may open it. */
  permission?: string;
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  // ------------------------------------------------------ 1 · Your business
  {
    key: 'organization', label: 'Org Profile', section: 'business',
    group: 'Who you are',
    route: '/settings/organization', permission: 'settings.edit',
    hint: 'Your company name, address, logo and the branding on documents.',
    keywords: ['logo', 'company name', 'address', 'branding', 'letterhead', 'gstin'],
  },
  {
    key: 'legal-entities', label: 'Legal Entities', section: 'business',
    group: 'Who you are',
    route: '/settings/legal-entities', permission: 'settings.edit',
    hint: 'The registered entities you bill under, and their GST registrations.',
    keywords: ['gstin', 'firm', 'company', 'pan', 'registration', 'billing entity'],
  },
  {
    key: 'appearance', label: 'Appearance', section: 'business',
    group: 'Who you are',
    route: '/settings/appearance', permission: 'settings.edit',
    hint: 'Font, brand colour, sidebar, corners and spacing - how Atlas looks for everyone here.',
    keywords: ['theme', 'colour', 'color', 'font', 'look', 'brand', 'sidebar', 'dark', 'density', 'design'],
  },
  {
    key: 'messaging', label: 'Email & WhatsApp', section: 'business',
    group: 'Reaching customers',
    route: '/settings/messaging', permission: 'settings.edit',
    hint: 'Which provider sends your email and WhatsApp, and who it comes from.',
    keywords: [
      'email', 'whatsapp', 'send', 'smtp', 'resend', 'brevo', 'sendinblue',
      'provider', 'from address', 'sender', 'notification', 'message', 'sms',
    ],
  },

  // ------------------------------------------------------ 2 · Money & books
  {
    key: 'chart-of-accounts', label: 'Chart of Accounts', section: 'money',
    group: 'Your books',
    route: '/settings/chart-of-accounts', permission: 'accounts.edit',
    hint: 'The ledger accounts every transaction posts to.',
    keywords: ['ledger', 'account head', 'gl', 'journal', 'accounting'],
  },
  {
    key: 'opening-balance', label: 'Opening Balances', section: 'money',
    group: 'Your books',
    route: '/settings/opening-balance', permission: 'accounts.edit',
    hint: 'What each account, customer and supplier stood at when you started.',
    keywords: ['opening', 'carry forward', 'balance', 'migration', 'start'],
  },
  {
    key: 'period-lock', label: 'Close the Books', section: 'money',
    group: 'Your books',
    route: '/settings/period-lock', permission: 'accounts.view',
    hint: 'Stop anything new being dated into a month you have already filed on.',
    keywords: [
      'close the books', 'period lock', 'lock a month', 'month end', 'year end',
      'closed period', 'back-dated', 'backdate', 'gst return filed', 'reopen',
      'accounting period', 'freeze',
    ],
  },
  {
    key: 'bank-accounts', label: 'Bank Accounts', section: 'money',
    group: 'Banking',
    route: '/bank/accounts', permission: 'accounts.edit',
    hint: 'Your bank and cash accounts - where receipts land and payments leave from.',
    keywords: ['bank', 'ifsc', 'cash account', 'current account', 'upi', 'cheque'],
  },

  // ------------------------------------------------------ 3 · Products & selling
  {
    key: 'masters', label: 'Parameters', section: 'selling',
    group: 'What things are',
    route: '/settings/masters', permission: 'settings.edit',
    hint: 'Units, HSN codes, categories and the other lists Atlas chooses from.',
    keywords: ['hsn', 'unit', 'uom', 'category', 'master', 'list', 'dropdown values', 'tax code'],
  },
  {
    key: 'courier', label: 'Courier & Shipping', section: 'selling',
    group: 'What things are',
    route: '/courier', permission: 'settings.edit',
    hint: 'The courier companies you ship with, and the link that tracks a parcel from its AWB.',
    keywords: ['courier', 'shipping', 'awb', 'tracking', 'delivery partner', 'dispatch'],
  },
  {
    key: 'user-target', label: 'Sales Target', section: 'selling',
    group: 'Targets and earnings',
    route: '/settings/user-target', permission: 'settings.edit',
    hint: 'Monthly targets per salesperson, and the incentive owed on a deal.',
    keywords: ['target', 'incentive', 'commission', 'quota', 'achievement'],
  },
  {
    key: 'incentive', label: 'Sales incentive', section: 'selling',
    group: 'Targets and earnings',
    route: '/settings/incentive', permission: 'settings.edit',
    hint: 'How a salesperson earns on a deal, and when it is owed.',
    keywords: [
      'commission', 'incentive', 'percentage', 'margin', 'slab', 'payout',
      'bonus', 'sales reward', 'earned on', 'claw back',
    ],
  },

  {
    key: 'order-stages', label: 'Sales order stages', section: 'selling',
    group: 'Orders',
    route: '/settings/order-stages', permission: 'settings.edit',
    hint: 'Which steps an order goes through, what they are called and their colour.',
    keywords: ['stage', 'status', 'packed', 'dispatched', 'shipped', 'confirmed', 'delivered', 'order flow', 'steps'],
  },

  // ------------------------------------------------------ 4 · Documents & approvals
  {
    key: 'documents', label: 'Document layouts', section: 'documents',
    group: 'How documents look',
    route: '/settings/documents', permission: 'settings.edit',
    hint: 'How quotations, invoices and challans look to a customer.',
    keywords: [
      'template', 'layout', 'quotation template', 'pdf', 'print', 'design',
      'letterhead', 'columns', 'terms', 'cover letter', 'footer', 'logo',
    ],
  },
  {
    key: 'document-numbers', label: 'Document Numbers', section: 'documents',
    group: 'How documents look',
    route: '/reports/document-numbers', permission: 'accounts.view',
    hint: 'How quotation, order and invoice numbers are formed (QT-BR001-2026-0007) and which comes next.',
    keywords: ['numbering', 'series', 'prefix', 'sequence', 'invoice number', 'next number'],
  },
  {
    key: 'required-documents', label: 'Required documents', section: 'documents',
    group: 'Rules and approvals',
    route: '/settings/required-documents', permission: 'settings.edit',
    hint: 'Which files each document needs - customer PO, signed challan, payment proof - and whether a missing one warns or blocks.',
    keywords: ['attachment', 'files', 'po', 'purchase order', 'proof', 'challan', 'photo', 'required', 'mandatory', 'block'],
  },
  {
    key: 'custom-fields', label: 'Custom Fields & Field Rules', section: 'documents',
    group: 'Rules and approvals',
    route: '/settings/custom-fields', permission: 'settings.edit',
    hint: 'Add your own fields to leads, customers, products and more.',
    keywords: ['extra field', 'new field', 'dropdown', 'field type', 'mandatory', 'required'],
  },
  {
    key: 'operations', label: 'Operations & approvals', section: 'documents',
    group: 'Rules and approvals',
    route: '/settings/operations', permission: 'settings.edit',
    hint: 'Each person on simple switches: what they may see, change and approve.',
    keywords: ['access', 'user access', 'permission', 'who can', 'switch', 'person', 'approval'],
  },
  {
    key: 'approval-rules', label: 'Approval Rules & Notifications', section: 'documents',
    group: 'Rules and approvals',
    route: '/settings/approval-rules', permission: 'settings.edit',
    hint: 'Who approves what, above which amount, and who is told.',
    keywords: ['approve', 'approval chain', 'threshold', 'limit', 'notify', 'escalate'],
  },
  {
    key: 'field-jobs', label: 'Field jobs', section: 'documents',
    group: 'Out on site',
    route: '/settings/field-jobs', permission: 'settings.edit',
    hint: 'Service jobs: on-site rules, photos, OTP, and whether the GDN is raised automatically.',
    /**
     * "GDN" and "automatic" are here because of a live complaint on 1 Oct:
     * Pravin could not find how to stop the GDN being created by itself. The
     * switch existed and was well written - it was simply unreachable unless
     * you already knew it lived under "Field jobs", which nobody would guess.
     * That is the whole case for keyword search in one example.
     */
    keywords: [
      'service', 'complaint', 'technician', 'job step', 'on site', 'challan',
      'gdn', 'automatic', 'auto', 'turn off gdn', 'goods dispatch',
      'otp', 'photo', 'visit charge', 'distance', 'reopen',
    ],
  },

  // ------------------------------------------------------ 5 · People & access
  {
    key: 'users', label: 'User List', section: 'people',
    group: 'Who can sign in',
    route: '/settings/users', permission: 'users.edit',
    hint: 'Everyone who can sign in, and what the phone app allows each of them.',
    keywords: ['login', 'staff', 'add user', 'password', 'deactivate', 'phone app'],
  },
  {
    key: 'roles', label: 'Roles', section: 'people',
    group: 'Who can sign in',
    route: '/settings/roles', permission: 'users.edit',
    hint: 'What each role may do, including what the phone app allows.',
    keywords: ['permission', 'rights', 'access', 'phone app', 'technician', 'manager'],
  },
  {
    key: 'user-store-roles', label: 'User store roles', section: 'people',
    group: 'Who can sign in',
    route: '/settings/user-store-roles', permission: 'users.edit',
    hint: 'Which branches a person works in, and their role in each.',
    keywords: ['branch', 'store', 'multi branch', 'assign role'],
  },
  {
    key: 'people', label: 'People', section: 'people',
    group: 'Who can sign in',
    route: '/settings/people', permission: 'users.edit',
    hint: 'Everyone in this branch - login, employee record, roles, manager, phone - and one page per person.',
    keywords: ['person', 'staff', 'employee', 'user', 'login', 'team', 'reports to', 'manager'],
  },
  {
    key: 'access-check', label: 'Access check', section: 'people',
    group: 'Who can sign in',
    route: '/settings/access', permission: 'users.edit',
    hint: 'Who can do what in this branch, in plain words - and what looks wrong.',
    keywords: ['who can', 'access', 'audit', 'rights', 'permission', 'review', 'admin', 'employee record'],
  },
  {
    key: 'store-menu-config', label: 'Role & User Menu', section: 'people',
    group: 'Who can sign in',
    route: '/settings/store-menu-config', permission: 'settings.edit',
    hint: 'Which menu items each role and each person can see.',
    keywords: ['menu', 'sidebar', 'navigation', 'hide menu', 'module', 'switch off'],
  },
  {
    key: 'departments', label: 'Departments', section: 'people',
    group: 'Your organisation',
    route: '/departments', permission: 'users.edit',
    hint: 'Sales, Service, Accounts and the other departments people belong to.',
    keywords: ['department', 'team', 'division', 'section'],
  },
  {
    key: 'team-setup', label: 'Team Setup (reporting line)', section: 'people',
    group: 'Your organisation',
    route: '/hierarchy/team-setup', permission: 'users.edit',
    hint: 'Who reports to whom. Leave, WFH and claims climb this line for approval.',
    keywords: ['manager', 'reports to', 'hierarchy', 'reporting line', 'supervisor', 'org chart'],
  },
  {
    key: 'employee-config', label: 'Employee Configuration', section: 'people',
    group: 'Your organisation',
    route: '/hrm/employee-config', permission: 'hrm.edit',
    hint: 'Departments, designations and the lists employee records choose from.',
    keywords: ['department', 'designation', 'grade', 'hr master'],
  },

  // ------------------------------------------------------ 6 · Attendance & shifts
  {
    key: 'attendance-config', label: 'Time Policies', section: 'attendance',
    group: 'Time and place',
    route: '/settings/attendance', permission: 'attendance.edit',
    hint: 'Shifts, holidays and how attendance is counted.',
    keywords: ['shift', 'holiday', 'leave', 'week off', 'roster'],
  },
  {
    key: 'clock-in-rules', label: 'Clock-in Rules', section: 'attendance',
    group: 'Time and place',
    route: '/settings/attendance/clock-in-rules', permission: 'attendance.edit',
    hint: 'Where and when people may clock in, and what happens outside those places.',
    keywords: ['geofence', 'radius', 'location', 'zone', 'late', 'grace'],
  },
  {
    key: 'work-schedules', label: 'Work Schedules', section: 'attendance',
    group: 'Time and place',
    route: '/hrm/work-schedules', permission: 'hrm.edit',
    hint: 'Shifts and work types, and which employee works which.',
    keywords: ['shift', 'roster', 'work type', 'weekly off', 'schedule'],
  },
  {
    key: 'attendance-devices', label: 'Attendance Devices', section: 'attendance',
    group: 'Machines and permissions',
    route: '/settings/attendance/devices', permission: 'attendance.edit',
    hint: 'Biometric readers, their employee codes and whether they are reporting in.',
    keywords: ['biometric', 'fingerprint', 'zkteco', 'hikvision', 'punch', 'machine', 'reader'],
  },
  {
    key: 'attendance-permissions', label: 'Attendance permissions', section: 'attendance',
    group: 'Machines and permissions',
    route: '/settings/attendance/permissions', permission: 'attendance.edit',
    hint: 'Who may see and correct other people’s attendance.',
    keywords: ['who can see attendance', 'correct', 'approve attendance'],
  },

  // ------------------------------------------------------ 7 · Phones & devices
  {
    key: 'people-devices', label: 'People & devices', section: 'devices',
    group: 'Phones and devices',
    route: '/settings/people-devices', permission: 'users.edit',
    hint: 'Everyone who can sign in, from what, and how to cut a lost phone off.',
    keywords: [
      'lost phone', 'stolen', 'revoke', 'sign out', 'kill switch', 'sessions',
      'paired', 'devices', 'who is logged in', 'security',
    ],
  },
  {
    key: 'call-devices', label: 'Phones', section: 'devices',
    group: 'Phones and devices',
    route: '/settings/call-devices', permission: 'users.edit',
    hint: 'Phones paired to the Vcare app, and how to unpair one.',
    keywords: ['pair', 'pairing', 'mobile', 'app', 'unpair', 'revoke', 'lost phone'],
  },
  {
    key: 'login-sessions', label: 'Device Management', section: 'devices',
    group: 'Phones and devices',
    route: '/settings/login-sessions', permission: 'users.edit',
    hint: 'Where each person is currently signed in, and signing them out.',
    keywords: ['session', 'sign out', 'logout', 'browser', 'security', 'stolen'],
  },

  // ------------------------------------------------------ 8 · Data, system & security
  {
    key: 'import', label: 'Import Data', section: 'system',
    group: 'Your data',
    route: '/import', permission: 'settings.edit',
    hint: 'Bring customers, leads, products and stock in from Excel in one go.',
    keywords: ['import', 'excel', 'csv', 'upload', 'bulk', 'migrate'],
  },
  {
    key: 'system', label: 'System Configuration', section: 'system',
    group: 'How Atlas behaves',
    route: '/settings/system', permission: 'settings.edit',
    hint: 'Document numbering, financial year and how Atlas behaves overall.',
    keywords: ['prefix', 'numbering', 'financial year', 'series', 'email', 'integration'],
  },
  {
    key: 'customisation', label: 'Customisation', section: 'system',
    group: 'How Atlas behaves',
    route: '/settings/customisation', permission: 'settings.edit',
    hint: 'Show or hide elements across the website, phone app and customer portal.',
    keywords: ['hide', 'show', 'element', 'column', 'portal', 'phone app', 'flow step'],
  },
  {
    key: 'api-tokens', label: 'API Tokens', section: 'system',
    group: 'How Atlas behaves',
    route: '/settings/api-tokens', permission: 'settings.edit',
    hint: 'Tokens that let another system talk to Atlas.',
    keywords: ['api', 'token', 'integration', 'webhook', 'key'],
  },
  {
    key: 'activity-log', label: 'User Activity Log', section: 'system',
    group: 'Security and audit',
    route: '/reports/activity-log', permission: 'users.edit',
    hint: 'Every change and who made it, when - the record to read when something looks wrong.',
    keywords: ['audit', 'log', 'history', 'who changed', 'activity', 'trail'],
  },
];

const BY_KEY = new Map(SETTINGS_ENTRIES.map((e) => [e.key, e]));
export const settingsEntry = (key: string) => BY_KEY.get(key);

/** Every route the registry claims, for the coverage test. */
export const REGISTERED_ROUTES: ReadonlySet<string> = new Set(
  SETTINGS_ENTRIES.map((e) => e.route),
);

export function entriesInSection(section: SettingsSection): SettingsEntry[] {
  return SETTINGS_ENTRIES.filter((e) => e.section === section);
}

/**
 * Find a setting by what somebody typed.
 *
 * Deliberately NOT fuzzy. Pravin asked for "precise type-search": a fuzzy
 * matcher that offers Roles when you type "role" is useful, but one that
 * offers Roles when you type "hsn" is worse than nothing, because it teaches
 * people the search box cannot be trusted and they go back to hunting the
 * menu.
 *
 * Ranking, best first:
 *   1. the label starts with what you typed
 *   2. the label contains it
 *   3. a keyword starts with it   - "hsn" finds Parameters
 *   4. the hint contains it       - the widest net, last
 */
export function searchSettings(
  query: string,
  can: (permission: string) => boolean = () => true,
): SettingsEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const scored: { entry: SettingsEntry; rank: number }[] = [];

  for (const e of SETTINGS_ENTRIES) {
    if (e.permission && !can(e.permission)) continue;

    const label = e.label.toLowerCase();
    const hint = e.hint.toLowerCase();
    const keys = (e.keywords ?? []).map((k) => k.toLowerCase());

    let rank = -1;
    if (label.startsWith(q)) rank = 0;
    else if (label.includes(q)) rank = 1;
    else if (keys.some((k) => k.startsWith(q))) rank = 2;
    else if (keys.some((k) => k.includes(q))) rank = 3;
    else if (hint.includes(q)) rank = 4;

    if (rank >= 0) scored.push({ entry: e, rank });
  }

  return scored
    .sort((a, b) => a.rank - b.rank || a.entry.label.localeCompare(b.entry.label))
    .map((s) => s.entry);
}

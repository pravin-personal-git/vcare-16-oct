import type { IconName } from '@/components/ui/Icon';

/**
 * The System Configuration catalogue.
 *
 * Captured from the reference app on 2026-08-13. Sixteen cards, in its order,
 * with its scope badges (General / Super Admin / Mobile).
 *
 * This file is the single source of truth for the screen AND for the backlog -
 * `status` and `blockedBy` are what turn a pretty grid of cards into an honest
 * statement of what the product can actually do today. A settings screen that
 * offers sixteen things and delivers two is how a demo becomes a complaint.
 */

export type ConfigStatus = 'built' | 'partial' | 'not_built';
export type ConfigScope = 'general' | 'super_admin' | 'mobile';

export interface ConfigCard {
  key: string;
  title: string;
  blurb: string;
  icon: IconName;
  tone: 'brand' | 'navy' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  scope?: ConfigScope;
  status: ConfigStatus;
  /** What it will do, and what it needs first. Shown in the drawer. */
  detail: string;
  /** Backlog id or dependency, shown as a chip. */
  blockedBy?: string;
  /** Where it already lives, when something real exists. */
  href?: string;
  group: 'Integrations' | 'Documents' | 'Financial' | 'Organisation' | 'Legal';
}

export const CONFIG_CARDS: ConfigCard[] = [
  // ---------------------------------------------------------- Integrations
  {
    key: 'qr-code',
    title: 'QR Code',
    blurb: 'Upload your payment QR code image',
    icon: 'columns',
    tone: 'brand',
    group: 'Integrations',
    status: 'built',
    href: '/settings/organization',
    detail:
      'Built under Organization → Brand assets: upload a UPI/payment-gateway QR '
      + 'image, stored via /api/brand and printed on invoices. This card was '
      + 'stale - file storage and the invoice/document work it was blocked on '
      + 'both landed weeks ago; corrected 17 Sep 2026.',
  },
  {
    key: 'payment-link',
    title: 'Payment Link',
    blurb: 'Set your shareable payment link',
    icon: 'external-link',
    tone: 'info',
    group: 'Integrations',
    status: 'built',
    href: '/settings/organization',
    detail:
      'Built under Organization → the "Payment link" field, shown on invoices '
      + 'next to the payment QR. This card was stale - Invoices (A069) shipped '
      + 'weeks ago; corrected 17 Sep 2026.',
  },
  {
    key: 'email-account',
    title: 'Email Account',
    blurb: 'Configure Gmail or SMTP email settings',
    icon: 'mail',
    tone: 'success',
    group: 'Integrations',
    status: 'not_built',
    blockedBy: 'Phase 6 workers',
    detail:
      'Outbound email for quotations, invoices and reminders. Sending must run '
      + 'off a queue rather than inside a request - a request that waits on an '
      + 'SMTP timeout is a page that hangs for the salesperson.',
  },
  {
    key: 'e-invoice',
    title: 'e-Invoice',
    blurb: 'GST e-Invoice API credentials',
    icon: 'receipt',
    tone: 'danger',
    group: 'Integrations',
    status: 'not_built',
    blockedBy: 'D012 · A074',
    detail:
      'IRN generation against the government IRP, mandatory above the turnover '
      + 'threshold. Needs a GSP decision (D012) first - build in-house or buy. '
      + 'Not trivial: JSON schema compliance, signed payloads and QR generation.',
  },
  {
    key: 'lead-integrations',
    title: 'Lead Integrations',
    blurb: 'IndiaMART, TradeIndia, JustDial, Aajjo',
    icon: 'user-plus',
    tone: 'warning',
    group: 'Integrations',
    status: 'not_built',
    blockedBy: 'A048',
    detail:
      'Pull enquiries from marketplaces straight into Leads. Each has its own '
      + 'API and its own idea of a duplicate, so this needs the assignment-rule '
      + 'engine (A048) to land somewhere sensible.',
  },
  {
    key: 'whatsapp',
    title: 'WhatsApp Business',
    blurb: 'Connect WhatsApp via Meta Embedded Signup',
    icon: 'whatsapp',
    tone: 'success',
    group: 'Integrations',
    status: 'partial',
    detail:
      'Today the product opens wa.me with a pre-filled message and a link - that '
      + 'works now and needs no approval. The Business API adds templates and '
      + 'delivery receipts, but Meta template approval takes weeks, so start that '
      + 'process early (risk R004).',
  },
  {
    key: 'mcp-connector',
    title: 'MCP Connector',
    blurb: 'Bearer-token access for Claude Code, Claude Desktop and similar agents',
    icon: 'lock',
    tone: 'navy',
    scope: 'super_admin',
    group: 'Integrations',
    status: 'partial',
    href: '/settings/api-tokens',
    detail:
      'A real, working, revocable token system exists (Settings → API Tokens) '
      + 'and a bearer-authenticated /api/mcp endpoint answers a small set of '
      + 'read-only tools (list_stores, list_leads, list_recent_orders). What is '
      + 'NOT built: the actual MCP protocol (JSON-RPC 2.0, tool/resource '
      + 'negotiation) - this is a REST surface an agent can be pointed at by '
      + 'hand, not something Claude Desktop discovers automatically yet. '
      + 'Added 19 Sep 2026, Phase D of the admin-settings deep audit.',
  },
  {
    key: 'chatgpt-connector',
    title: 'ChatGPT / OpenAI Connector',
    blurb: 'Same token system, for the OpenAI Responses API / Agents SDK / Codex CLI',
    icon: 'sparkles',
    tone: 'success',
    scope: 'super_admin',
    group: 'Integrations',
    status: 'partial',
    href: '/settings/api-tokens',
    detail:
      'Shares the exact same token and /api/mcp endpoint as the MCP Connector '
      + 'card above - atmytip\'s own two cards are two marketing names on one '
      + 'mechanism, not two systems. Same caveat: a minimal authenticated REST '
      + 'surface today, not a certified integration with either vendor\'s SDK.',
  },
  {
    key: 'ivr-config',
    title: 'IVR Config',
    blurb: 'Capture incoming phone calls as leads via an IVR device',
    icon: 'phone',
    tone: 'warning',
    group: 'Integrations',
    status: 'not_built',
    detail:
      'Needs an IVR provider decision (which vendor, webhook shape) before any '
      + 'code - the same kind of upfront call GST e-Invoice is waiting on for a '
      + 'GSP. Not started.',
  },
  {
    key: 'device-management',
    title: 'Device Management',
    blurb: 'Unified web + Android device list - My Devices, History, Pending Requests, Global PIN',
    icon: 'settings',
    tone: 'info',
    group: 'Integrations',
    status: 'partial',
    href: '/settings/login-sessions',
    detail:
      'My Devices and History are real, merging web login sessions and paired '
      + 'Android call-sync devices into one list (Settings → Device Management). '
      + 'Pending Requests (approve a new device before it can sign in) and '
      + 'Global PIN (a second sign-in factor) are deliberately NOT built - both '
      + 'are changes to the login flow itself and need the same careful, '
      + 'separate scoping every other auth change this quarter has gotten, not '
      + 'a bolt-on. Added 19 Sep 2026, Phase D.',
  },

  // ------------------------------------------------------------- Documents
  {
    key: 'terms',
    title: 'Terms & Conditions',
    blurb: 'Default terms used on sales orders, invoices and quotations',
    icon: 'file-text',
    tone: 'navy',
    group: 'Documents',
    status: 'partial',
    href: '/quotation',
    detail:
      'The quotation form already carries a template picker with three presets '
      + 'and free text. What is missing is storing them per document type so '
      + 'they are managed once here rather than retyped on every quotation.',
  },
  {
    key: 'cover-letter',
    title: 'Cover Letter',
    blurb: 'Cover letters for invoices, quotations, sales orders and more',
    icon: 'paperclip',
    tone: 'brand',
    group: 'Documents',
    status: 'not_built',
    blockedBy: 'A061 PDF',
    detail:
      'A letter page in front of the document. Belongs with the server-rendered '
      + 'PDF (A061) - the browser print dialog cannot reliably produce a '
      + 'multi-page document with different headers.',
  },
  {
    key: 'company-logos',
    title: 'Company Logos',
    blurb: 'Upload company icon, favicon, logo and invoice logo',
    icon: 'package',
    tone: 'accent',
    scope: 'general',
    group: 'Documents',
    status: 'built',
    href: '/settings/organization',
    detail:
      'Built under Organization → Brand assets: logo, seal, icon, favicon and a '
      + 'separate invoice logo, each independently uploaded via /api/brand - one '
      + 'more image (seal) than this card originally scoped. This card was '
      + 'stale - corrected 17 Sep 2026.',
  },

  // ------------------------------------------------------------- Financial
  {
    key: 'product-cost',
    title: 'Product cost / price',
    blurb: 'Valuation: Standard Cost, Last Purchase Price, or Historical Average',
    icon: 'tag',
    tone: 'warning',
    group: 'Financial',
    status: 'built',
    href: '/products',
    detail:
      'Built and shipped 6 Sep 2026: the cost-method picker (Standard / Last '
      + 'Purchase / 3-Purchase Average) lives on the Products screen and feeds '
      + 'margin figures there and on the Profit & Loss report. This card was '
      + 'stale - corrected 17 Sep 2026.',
  },
  {
    key: 'exchange-rate',
    title: 'Exchange Rate',
    blurb: 'USD to INR rate used by the product costing calculator',
    icon: 'trending-up',
    tone: 'info',
    group: 'Financial',
    status: 'not_built',
    detail:
      'For imported goods priced in dollars. Needs a rate with an effective date '
      + 'rather than a single number, or last year’s costing silently changes '
      + 'when someone updates the rate. Its "Purchase module" blocker is stale - '
      + 'Purchase Orders/GRN/Bills shipped weeks ago - this is now genuinely '
      + 'buildable, just not yet built (corrected 17 Sep 2026).',
  },
  {
    key: 'currency-timezone',
    title: 'Currency & Timezone',
    blurb: 'Set currency symbol and timezone for your organization',
    icon: 'clock',
    tone: 'navy',
    scope: 'general',
    group: 'Organisation',
    status: 'built',
    href: '/settings/organization',
    detail:
      'Built per branch under Organization → Branches: currency and timezone '
      + 'fields on each branch, saved through the update-store action that '
      + 'already accepted them. Only the input fields were missing - added '
      + '17 Sep 2026. Still per-branch, not a single organisation-wide default; '
      + 'that matches multi-store reality (a Bhilai and a Dubai branch need '
      + 'different values), but confirm that is the intended model.',
  },
  {
    key: 'system-dates',
    title: 'System Dates',
    blurb: 'Date format, time format, financial year and week start day',
    icon: 'calendar',
    tone: 'brand',
    scope: 'general',
    group: 'Organisation',
    status: 'partial',
    detail:
      'The financial year is already implemented - April to March, with document '
      + 'numbers resetting on it. Date and time format and week start are still '
      + 'hard-coded to Indian conventions.',
  },
  {
    key: 'system-settings',
    title: 'System Settings',
    blurb: 'Manage prefix, company info and other general settings',
    icon: 'sliders',
    tone: 'navy',
    scope: 'general',
    group: 'Organisation',
    status: 'built',
    href: '/settings/organization',
    detail:
      'Document prefixes are live - QT, SO, INV, PO, GRN, GDN, POS - with '
      + 'per-store, per-financial-year sequences. Company info (A018) also '
      + 'shipped: name, GSTIN, email, mobile, industry, size and payment link '
      + 'are all editable under Organization → Company. This card was stale - '
      + 'corrected 17 Sep 2026.',
  },

  // ----------------------------------------------------------------- Legal
  {
    key: 'legal-pages',
    title: 'Public Legal Pages Editor',
    blurb: 'Edit the Terms & Conditions and Privacy Policy shown to all',
    icon: 'pencil',
    tone: 'danger',
    scope: 'super_admin',
    group: 'Legal',
    status: 'not_built',
    detail:
      'Public pages served outside the login. Super-admin only, because they are '
      + 'the tenant’s legal position - not something a store manager should be '
      + 'able to rewrite.',
  },
  {
    key: 'privacy-policy',
    title: 'Privacy Policy',
    blurb: 'Manage privacy policy content for the mobile app',
    icon: 'lock',
    tone: 'info',
    scope: 'mobile',
    group: 'Legal',
    status: 'not_built',
    blockedBy: 'Mobile app',
    detail:
      'Both app stores require a reachable privacy policy URL before they will '
      + 'accept a build. Needed before the Android app ships, not before.',
  },
  {
    key: 'terms-mobile',
    title: 'Terms and Condition (Mobile)',
    blurb: 'Mobile-app-specific terms, separate from the public legal-pages editor',
    icon: 'file-text',
    tone: 'navy',
    scope: 'mobile',
    group: 'Legal',
    status: 'not_built',
    blockedBy: 'Mobile app',
    detail:
      'Same reasoning as Privacy Policy above - app-store submission needs this '
      + 'text reachable, and it is deliberately separate copy from the web '
      + 'legal pages (a mobile app\'s terms cover things the web product does '
      + 'not, like device permissions). Needed before the Android app ships.',
  },
  {
    key: 'cookies-mobile',
    title: 'Cookies Policy (Mobile)',
    blurb: 'Mobile-app-specific cookies/tracking disclosure',
    icon: 'info',
    tone: 'accent',
    scope: 'mobile',
    group: 'Legal',
    status: 'not_built',
    blockedBy: 'Mobile app',
    detail: 'Same family as the two cards above - not needed until the mobile app is being submitted.',
  },
  {
    key: 'contact-mobile',
    title: 'Contact (Mobile)',
    blurb: 'Support contact details shown inside the mobile app',
    icon: 'mail',
    tone: 'success',
    scope: 'mobile',
    group: 'Legal',
    status: 'not_built',
    blockedBy: 'Mobile app',
    detail: 'Same family as the three cards above - not needed until the mobile app is being submitted.',
  },
];

export const STATUS_LABEL: Record<ConfigStatus, string> = {
  built: 'Working',
  partial: 'Partly working',
  not_built: 'Not built',
};

export const SCOPE_LABEL: Record<ConfigScope, string> = {
  general: 'General',
  super_admin: 'Super Admin',
  mobile: 'Mobile',
};

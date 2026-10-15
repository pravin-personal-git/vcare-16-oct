/**
 * Structural UI translations - navigation labels, page titles, and the
 * handful of shell words that surround them.
 *
 * WHY THIS EXISTS INSTEAD OF next-intl MESSAGE KEYS
 *
 * next-intl's `hi.json` (see src/i18n/messages/) held six strings - the login
 * screen only. Everything else in the product is a hardcoded English literal
 * passed straight into JSX (`<PageHeader title="Invoices">`, a sidebar label
 * pulled from the database `Menu` row, a dashboard tab array). Rekeying every
 * one of those call sites through `useTranslations()` - hundreds of files -
 * is a real, multi-session project (tracked as its own item; do not treat
 * this file as having done that work).
 *
 * What this file does instead, scoped deliberately to "tabs, page names, the
 * text on the page" rather than every button and dropdown: a flat
 * English-to-Hindi lookup, applied at exactly two shared choke points -
 * `Sidebar.tsx` (every nav label, including the ones that come from the
 * database) and `PageHeader` (every page's title) - plus the dashboard tab
 * bar. Three call sites, not hundreds, because navigation and page titles are
 * the two places EVERY screen in the product already routes through.
 *
 * A string with no entry here falls back to the English original - silently,
 * by design. A half-translated screen with the untranslated words in English
 * is normal for a real product mid-rollout; a screen that throws or renders
 * blank because a key was missing is not.
 */

const HI: Record<string, string> = {
  // Top-level nav / shell
  Dashboard: 'डैशबोर्ड',
  Sales: 'बिक्री',
  Inventory: 'इन्वेंटरी',
  'Services Call': 'सेवा कॉल',
  'Service Calls': 'सेवा कॉल',
  'Task Manager': 'कार्य प्रबंधक',
  Attendance: 'उपस्थिति',
  Products: 'उत्पाद',
  Suppliers: 'आपूर्तिकर्ता',
  Accounts: 'खाते',
  Purchase: 'खरीद',
  HRM: 'एचआरएम',
  'Financial Reports': 'वित्तीय रिपोर्ट',
  'Common Hub': 'कॉमन हब',
  'Users & Roles': 'उपयोगकर्ता और भूमिकाएं',
  'System Settings': 'सिस्टम सेटिंग्स',
  'Reference Data': 'संदर्भ डेटा',
  'FAQ / Help': 'सामान्य प्रश्न / सहायता',
  'Help & Handbook': 'मदद और हैंडबुक',
  'SOP Guidebook': 'SOP गाइडबुक',
  Help: 'सहायता',
  Reports: 'रिपोर्ट',
  HR: 'एचआर',
  Admin: 'व्यवस्थापक',
  Stock: 'स्टॉक',

  // Sales chain
  Leads: 'लीड्स',
  Customers: 'ग्राहक',
  Quotation: 'कोटेशन',
  'Sales Orders': 'बिक्री ऑर्डर',
  Invoices: 'इनवॉइस',
  'Sales Target': 'बिक्री लक्ष्य',
  'Call Logs': 'कॉल लॉग',
  'Sales Return': 'बिक्री वापसी',
  'Credit Notes': 'क्रेडिट नोट',
  'Sales Incentive': 'बिक्री प्रोत्साहन',
  Receipts: 'रसीदें',

  // Inventory / manufacturing
  'Stock on Hand': 'उपलब्ध स्टॉक',
  'Production Order': 'उत्पादन ऑर्डर',
  'Product BOM': 'उत्पाद बीओएम',
  'Goods Dispatch Note': 'माल प्रेषण नोट',
  'Goods Receipt Note': 'माल प्राप्ति नोट',

  // Purchase
  'Purchase Return': 'खरीद वापसी',
  'Purchase Order': 'खरीद ऑर्डर',
  'Purchase Orders': 'खरीद ऑर्डर',
  'Purchase Bills': 'खरीद बिल',
  Payables: 'देय राशि',
  'Courier & Shipping': 'कूरियर और शिपिंग',

  // Accounts / finance
  'GST Computation': 'जीएसटी गणना',
  Transactions: 'लेन-देन',
  'Supplier Account': 'आपूर्तिकर्ता खाता',
  'Customer Account': 'ग्राहक खाता',
  'User Account': 'उपयोगकर्ता खाता',
  'Bank Statement': 'बैंक स्टेटमेंट',
  'Bank Accounts': 'बैंक खाते',
  'Bank Account': 'बैंक खाता',
  'Profit & Loss': 'लाभ और हानि',
  'Balance Sheet': 'बैलेंस शीट',

  // HRM
  'Employee Management': 'कर्मचारी प्रबंधन',
  'Salary Structure': 'वेतन संरचना',
  Hierarchy: 'पदानुक्रम',
  'Insurance & Policy': 'बीमा और नीति',
  'My attendance': 'मेरी उपस्थिति',
  'Attendance settings': 'उपस्थिति सेटिंग्स',
  'Shift Log': 'शिफ्ट लॉग',

  // Common hub
  'Notices & Announcements': 'सूचनाएं और घोषणाएं',
  'Shared Files & Docs': 'साझा फ़ाइलें और दस्तावेज़',
  'Asset Management': 'संपत्ति प्रबंधन',
  Assets: 'संपत्तियां',
  'Terms & Policy': 'नियम और नीति',

  // Users, roles, system
  Roles: 'भूमिकाएं',
  'User store roles': 'उपयोगकर्ता स्टोर भूमिकाएं',
  'User Store Roles': 'उपयोगकर्ता स्टोर भूमिकाएं',
  'User List': 'उपयोगकर्ता सूची',
  'Role & User Menu': 'भूमिका और उपयोगकर्ता मेनू',
  'Access check': 'एक्सेस जाँच',
  People: 'लोग',
  'User Activity Log': 'उपयोगकर्ता गतिविधि लॉग',
  'User Login Sessions': 'उपयोगकर्ता लॉगिन सत्र',
  'System Configuration': 'सिस्टम कॉन्फ़िगरेशन',
  'Org Profile': 'संगठन प्रोफ़ाइल',
  'Import Data': 'डेटा आयात करें',
  Department: 'विभाग',
  Departments: 'विभाग',
  'Call Sync Devices': 'कॉल सिंक डिवाइस',
  Parameters: 'पैरामीटर',
  'System Config': 'सिस्टम कॉन्फ़िग',

  // The app's own pop-up (components/ui/ask.tsx) - its buttons and default titles
  Cancel: 'रद्द करें',
  Save: 'सहेजें',
  'OK, got it': 'ठीक है',
  'Yes, go ahead': 'हाँ, आगे बढ़ें',
  'Not now': 'अभी नहीं',
  'Just checking': 'एक बार पक्का कर लें',
  'Are you sure?': 'क्या आप पक्का हैं?',
  'Before you go on': 'आगे बढ़ने से पहले',
  'Good to know': 'जानकारी के लिए',
  Done: 'हो गया',
  'Please note': 'कृपया ध्यान दें',
  'One more thing': 'बस एक बात और',
  'Quick question': 'एक छोटा सा सवाल',
  'That did not go through': 'यह नहीं हो पाया',
  'Please fill this in to carry on.': 'आगे बढ़ने के लिए इसे भरें।',
  'Skip to content': 'सीधे पेज पर जाएँ',
  'Not available yet': 'अभी उपलब्ध नहीं',

  // Misc pages
  'How Atlas works': 'एटलस कैसे काम करता है',
  'Reports & Downloads': 'रिपोर्ट और डाउनलोड',
};

/**
 * Looks up `label` in the Hindi dictionary above; returns it unchanged for
 * any other locale, or when no translation exists yet.
 */
export function translateLabel(label: string, locale: string): string {
  if (locale !== 'hi') return label;
  return HI[label] ?? label;
}

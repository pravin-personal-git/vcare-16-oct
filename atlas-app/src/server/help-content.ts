import 'server-only';
import type { HelpArticle } from '@/lib/help/search';

/**
 * THE HELP CHAT'S GUIDES (30 Oct 2026). Hinglish, like the SOP guidebook -
 * the people asking think in Hindi. Button names are copied from the code and
 * written in [brackets] exactly as they read on screen; menu paths are the
 * live Vcare sidebar. When a button or a menu changes, change its guide in
 * the same commit.
 *
 * Server-only like the handbook: a guide above the reader's level is never
 * sent to the browser. `admin` guides belong to the admin mode (built later).
 */
const H = (a: HelpArticle) => a;

export const HELP: HelpArticle[] = [
  // ======================================================= ENQUIRY & SALES
  H({
    id: 'enquiry-new', level: 'office', area: 'Enquiry', who: 'Sales / Office',
    q: 'Nayi enquiry kaise banaye?',
    also: ['naya lead kaise add kare', 'add enquiry', 'customer ka call aaya enquiry kaise daalu', 'new lead', 'visiting card scan'],
    short: 'Sales → Enquiries pe [Add enquiry] dabaiye, details bhariye aur save kariye.',
    steps: [
      { do: 'Sidebar mein Sales → Enquiries kholiye.', href: '/crm/leads' },
      { do: 'Upar daayein [Add enquiry] dabaiye.', shot: 'enquiry-add' },
      { do: 'Naam, mobile aur "Requirement" (kya chahiye) bhariye. Source aur stage chun lijiye.' },
      { do: 'Kisko dena hai woh "Assigned to" mein chuniye - ya [Assign later].' },
      { do: '[+ Add enquiry] dabaiye. Enquiry number (ENQ…) apne aap banta hai.' },
    ],
    problems: [
      { if: 'Button dhundhla (grey) hai', then: 'Upar branch "All Company" pe hai. Ek branch chuniye, phir enquiry banegi.' },
      { if: 'Wahi mobile pehle se kisi enquiry mein hai', then: 'Search (Ctrl+K) mein number daal ke purani enquiry kholiye - doosri mat banaiye.' },
    ],
    open: { href: '/crm/leads', label: 'Enquiries kholo' },
    related: ['enquiry-note', 'enquiry-quotation'], pages: ['/crm/leads', '/dashboard'],
  }),
  H({
    id: 'enquiry-note', level: 'field', area: 'Enquiry', who: 'Sales / Office',
    q: 'Enquiry pe note ya call kaise likhe?',
    also: ['follow up kaise likhe', 'call log', 'remark daalna enquiry', 'meeting log', 'team comment'],
    short: 'Enquiry ka page kholiye, Timeline ke upar wale box mein likhiye.',
    steps: [
      { do: 'Sales → Enquiries mein enquiry number (ENQ…) pe click kariye - uska page khulega.', href: '/crm/leads' },
      { do: 'Beech mein box ke upar chuniye: [Note], [Team comment], [Log a call] ya [Log a meeting].' },
      { do: 'Call ke liye batayiye kaisi rahi: [We spoke], [No answer] ya [Call back later].' },
      { do: 'Likhiye aur [Add note] / [Save] dabaiye (Ctrl + Enter bhi chalta hai). Timeline mein naam aur time ke saath dikhega.' },
    ],
    open: { href: '/crm/leads', label: 'Enquiries kholo' },
    related: ['enquiry-followup'], pages: ['/crm/leads'],
  }),
  H({
    id: 'enquiry-followup', level: 'office', area: 'Enquiry', who: 'Sales / Office',
    q: 'Enquiry ka stage, owner ya follow-up date kaise badle?',
    also: ['stage change', 'enquiry kisko assign hai', 'follow up date set', 'enquiry close kaise kare', 'lost mark'],
    short: 'Enquiry ke page pe stage ki chip dabaiye; owner aur date "Next step" card mein badliye.',
    steps: [
      { do: 'Enquiry ka page kholiye (Sales → Enquiries → number).', href: '/crm/leads' },
      { do: 'Stage ki line mein naya stage dabaiye - turant save hota hai. "Paid" jaise won stage alag dikhte hain.' },
      { do: '"Next step" card mein "Follow up on" ki date chuniye, aur "Owner" mein naya naam.' },
      { do: 'Upar ek chhota sa "Saved" sandesh aata hai. Badlav Timeline mein "Stage" ke saath dikhta hai.' },
    ],
    problems: [{ if: 'Chip ya select dabta nahi', then: 'Aapke role mein enquiry edit ki permission nahi hai. Admin se "Leads: Edit" maangiye.' }],
    related: ['enquiry-note'], pages: ['/crm/leads'],
  }),
  H({
    id: 'enquiry-quotation', level: 'office', area: 'Quotation', who: 'Sales',
    q: 'Quotation kaise banaye?',
    also: ['quotation bhejna', 'rate bhejna', 'estimate banana', 'make quotation', 'quotation whatsapp'],
    short: 'Enquiry ke page pe [Make quotation] dabaiye, items daaliye, save kariye aur WhatsApp kariye.',
    steps: [
      { do: 'Enquiry ka page kholiye. Agar quotation nahi bani hai to sabse bada button [Make quotation] hota hai.', href: '/crm/leads' },
      { do: 'Products dhoondh ke jodiye, quantity aur rate dekhiye. Discount aur terms neeche hain.' },
      { do: '[Save] dabaiye. Quotation number (QTN…) banta hai aur enquiry se jud jaata hai.' },
      { do: 'Quotation ke page pe [Send WhatsApp] se customer ko bhejiye, phir [Mark as sent].' },
    ],
    problems: [{ if: 'Product list mein nahi mil raha', then: 'Products mein naya product banwaiye, ya admin se poochiye - naam thoda alag ho sakta hai.' }],
    open: { href: '/quotation', label: 'Quotations kholo' },
    related: ['quotation-order', 'enquiry-customer'], pages: ['/crm/leads', '/quotation'],
  }),
  H({
    id: 'enquiry-customer', level: 'office', area: 'Enquiry', who: 'Sales / Office',
    q: 'Enquiry ko customer kaise banaye?',
    also: ['convert lead', 'make customer', 'customer bana do', 'convert to customer'],
    short: 'Enquiry ke page pe [Make customer] dabaiye aur confirm kariye.',
    steps: [
      { do: 'Enquiry ka page kholiye.', href: '/crm/leads' },
      { do: '[Make customer] dabaiye (bada button, ya [More] ke andar).' },
      { do: 'Puchhega "Make this enquiry a customer?" - [Make customer] dabaiye.' },
      { do: 'Customer (PTY-…) ban jaata hai, enquiry "won" ho ke band hoti hai. Daayein "Linked documents" mein customer dikhega.' },
    ],
    problems: [
      { if: '"This lead has already been converted."', then: 'Ye pehle hi customer ban chuka hai - "Linked documents" mein customer pe click kariye.' },
      { if: '"Select a single store before converting."', then: 'Upar branch "All Company" se badal ke ek branch chuniye.' },
    ],
    related: ['quotation-order'], pages: ['/crm/leads'],
  }),
  H({
    id: 'quotation-order', level: 'office', area: 'Sales order', who: 'Sales / Office',
    q: 'Quotation ko order kaise banaye?',
    also: ['convert to order', 'sales order banana', 'customer ne haan bola', 'order book'],
    short: 'Quotation ke page pe [Convert to Order] dabaiye.',
    steps: [
      { do: 'Sales → Quotation mein quotation kholiye (ya enquiry page ke upar chain se).', href: '/quotation' },
      { do: 'Customer ne maan liya ho to [Mark Accepted].' },
      { do: '[Convert to Order] dabaiye. Order number (ORD… / SO-…) banta hai, lines quotation se aati hain.' },
      { do: 'Order ke page pe agla kaam: [Create installation job] ya [Raise invoice].' },
    ],
    open: { href: '/sales/orders', label: 'Sales orders kholo' },
    related: ['order-installation', 'order-invoice'], pages: ['/quotation', '/sales/orders'],
  }),

  // ========================================================== INSTALLATION
  H({
    id: 'order-installation', level: 'office', area: 'Installation', who: 'Office',
    q: 'Installation job kaise banaye?',
    also: ['installation raise', 'new installation', 'fitting job', 'create installation job', 'echn kaise banta hai'],
    short: 'Sales order ke page pe [Create installation job] dabaiye.',
    steps: [
      { do: 'Sales → Sales Orders mein order kholiye.', href: '/sales/orders' },
      { do: '[Create installation job] dabaiye. Order ki saari items installation pe aa jaati hain.' },
      { do: 'Installation ke page pe "Job" card mein technician tick kariye aur [Save].' },
      { do: '[Schedule a visit] se din aur time tay kariye. Technician ke phone pe job aa jaata hai.' },
    ],
    open: { href: '/services/installations', label: 'Installations kholo' },
    related: ['installation-finish', 'installation-material'], pages: ['/sales/orders', '/services/installations'],
  }),
  H({
    id: 'installation-finish', level: 'office', area: 'Installation', who: 'Office',
    q: 'Installation complete aur bill kaise kare?',
    also: ['mark work done', 'bill this installation', 'installation close', 'installation ka bill'],
    short: 'Kaam ho jaaye to [Mark work done], phir [Bill this installation].',
    steps: [
      { do: 'Customer Service → New Installations mein installation kholiye.', href: '/services/installations' },
      { do: 'Items ki list mein serial aur "Fitted" tick dekhiye - technician phone se bhi bharta hai.' },
      { do: '[Mark work done] dabaiye.' },
      { do: 'Ab sabse bada button [Bill this installation] hota hai - dabaiye, bill (INV…) ban jaata hai.' },
      { do: 'Bill nahi banana ho to [Don\'t bill] aur wajah likhiye.' },
    ],
    problems: [{ if: 'Kaam galat hai, technician ko wapas bhejna hai', then: '[More] → [Send back…] aur likhiye kya theek karna hai.' }],
    related: ['payment-record'], pages: ['/services/installations'],
  }),
  H({
    id: 'installation-material', level: 'office', area: 'Challan', who: 'Office / Technician',
    q: 'Installation pe extra cable ya saman kaise bheje?',
    also: ['installation challan', 'cable clamp challan', 'material challan installation', 'order ke bahar ka saman'],
    short: 'Installation ke page pe "Parts" card mein [Raise challan] → type "Material".',
    steps: [
      { do: 'Installation ka page kholiye, neeche "Parts (challans)" card tak jaiye.', href: '/services/installations' },
      { do: '[Raise challan] dabaiye, Type "Material - parts to complete the job".' },
      { do: 'Product chuniye, quantity daaliye, [Add line]. Saari lines ke baad save kariye.' },
      { do: 'Store [Issue parts (create GDN)] karta hai - tab saman stock se nikalta hai.' },
    ],
    related: ['challan-raise', 'challan-issue'], pages: ['/services/installations'],
  }),

  // ============================================================= COMPLAINT
  H({
    id: 'complaint-new', level: 'field', area: 'Complaint', who: 'Office',
    q: 'Complaint kaise darj kare?',
    also: ['raise complaint', 'nayi complaint', 'shikayat likhna', 'camera kharab complaint', 'service request'],
    short: 'Customer Service → Complaints Tracker pe [Raise complaint].',
    steps: [
      { do: 'Sidebar mein Customer Service → Complaints Tracker kholiye.', href: '/services/complaints' },
      { do: '[Raise complaint] dabaiye.' },
      { do: '"Customer" mein naam, company ya phone likh ke chuniye. Site aur "Equipment category" chuniye.' },
      { do: '"What\'s wrong" mein kharabi likhiye, priority chuniye.' },
      { do: '[Raise complaint] dabaiye. Complaint number (CMP-…) banta hai.' },
    ],
    problems: [{ if: 'Customer list mein nahi aa raha', then: 'Pehle Sales → Customers mein customer banaiye, phir complaint.' }],
    open: { href: '/services/complaints', label: 'Complaints kholo' },
    related: ['complaint-assign', 'challan-raise'], pages: ['/services/complaints', '/dashboard'],
  }),
  H({
    id: 'complaint-assign', level: 'office', area: 'Complaint', who: 'Office',
    q: 'Complaint technician ko kaise de aur visit kaise lagaye?',
    also: ['technician assign', 'visit schedule', 'job dena', 'kisko bheje'],
    short: 'Complaint ke page pe technician chuniye, phir [Schedule a visit].',
    steps: [
      { do: 'Complaint ka page kholiye.', href: '/services/complaints' },
      { do: 'Baayein "Job" card mein "Technician" chuniye.' },
      { do: '[Schedule a visit] dabaiye, din-time chuniye aur save kariye.' },
      { do: 'Technician ke phone app (My work → Today) mein job aa jaata hai.' },
    ],
    open: { href: '/services/visits', label: 'Visit Scheduler kholo' },
    related: ['challan-raise', 'complaint-close'], pages: ['/services/complaints'],
  }),
  H({
    id: 'challan-raise', level: 'field', area: 'Challan', who: 'Office / Technician',
    q: 'Challan kaise raise kare?',
    also: ['challan banana', 'parts challan', 'saman nikalna complaint', 'gdn kaise banaye', 'replacement challan', 'parts chahiye'],
    short: 'Complaint ke page pe [Raise challan] (baayein "Visits & parts" card), items jodiye, save kariye.',
    steps: [
      { do: 'Complaint ka page kholiye (Customer Service → Complaints Tracker → CMP-… number).', href: '/services/complaints' },
      { do: 'Baayein "Visits & parts" card mein [Raise challan] dabaiye.', shot: 'challan-raise' },
      { do: 'Type chuniye: "Material" (kaam ke parts), "Replacement" (customer ka unit badalna) ya "Installation".' },
      { do: 'Product chuniye, quantity daaliye, [Add line]. Serial wale product ke serial chun sakte hain - ya chhod dijiye, store chunega.' },
      { do: 'Save kariye. Challan (JCH-…) "Waiting for approval" ya "Approved - to issue" mein dikhega.' },
      { do: 'Store [Issue parts (create GDN)] karta hai. Tab "Issued" aur GDN number dikhta hai.' },
    ],
    problems: [
      { if: '"Waiting for approval" pe ruka hai', then: 'Manager ke My Desk → "Waiting on me" mein hai. Unse approve karwaiye.' },
      { if: 'Galti se challan bana', then: 'Issue hone se pehle [Withdraw] dabaiye. Issue ho gaya ho to bacha saman "Unused - send back to store".' },
      { if: '[Raise challan] button nahi dikh raha', then: 'Complaint band hai, ya aapke role ko complaint edit ki permission nahi.' },
    ],
    open: { href: '/services/complaints', label: 'Complaints kholo' },
    related: ['challan-issue', 'challan-return', 'serial-add-later'], pages: ['/services/complaints', '/goods-dispatch'],
  }),
  H({
    id: 'challan-issue', level: 'field', area: 'Challan', who: 'Store',
    q: 'Store challan ka saman kaise issue kare (GDN)?',
    also: ['issue parts', 'create gdn', 'parts counter', 'approve challan', 'store se saman dena'],
    short: 'Inventory → Parts counter mein challan kholiye aur [Issue parts (create GDN)].',
    steps: [
      { do: 'Sidebar mein Inventory → Parts counter kholiye - saare "to issue" challan yahan hain.', href: '/goods-dispatch/job-parts' },
      { do: 'Challan pe [Approve or reject on the job] se complaint ka page khulta hai.' },
      { do: 'Serial wale product ke liye shelf se serial chuniye.' },
      { do: '[Issue parts (create GDN)] dabaiye. GDN-… banta hai aur stock ghatta hai.' },
    ],
    problems: [{ if: 'Serial list mein nahi hai', then: 'Woh unit stock mein nahi hai (bika, reserved ya bahar). Inventory → Stock mein serial dhoondhiye.' }],
    open: { href: '/goods-dispatch/job-parts', label: 'Parts counter kholo' },
    related: ['challan-return'], pages: ['/goods-dispatch', '/services/complaints'],
  }),
  H({
    id: 'challan-return', level: 'field', area: 'Challan', who: 'Technician / Store',
    q: 'Bacha hua saman wapas stock mein kaise le?',
    also: ['unused part wapas', 'receive back', 'return unused to stock', 'technician saman laaya', 'receive into stock', 'unused - send back to store'],
    short: 'Challan ki line pe [Unused - send back to store], phir store [Receive … into stock].',
    steps: [
      { do: 'Complaint ka page kholiye, "Parts (challans)" card.', href: '/services/complaints' },
      { do: 'Issued line pe [Unused - send back to store] (ya [Return unused to stock]) dabaiye, ginti daaliye, [Send back].' },
      { do: 'Upar peela box "Marked unused - take them back" aata hai.' },
      { do: 'Saman aane pe [Receive N into stock] dabaiye. Serial wale ho to wapas aaye serial tick kariye.' },
    ],
    problems: [
      { if: '"No serial numbers available" aata hai', then: 'Page purana khula hai - Ctrl+Shift+R se refresh kariye. Jis line pe serial juda hi nahi, wahan ab ginti se receive hota hai.' },
      { if: 'Serial galat juda hai', then: 'Line pe [Change] se sahi serial lagaiye (store/admin).' },
    ],
    related: ['error-no-serial', 'serial-add-later'], pages: ['/services/complaints', '/services/installations'],
  }),
  H({
    id: 'serial-add-later', level: 'field', area: 'Serial', who: 'Store / Office',
    q: 'Challan pe serial number baad mein kaise jode?',
    also: ['serial not named', 'serials not named', 'add serial', 'serial bhool gaye', 'gdn pe serial nahi'],
    short: 'Line pe "serials not named" ke paas [Add serial] dabaiye aur serial chuniye.',
    steps: [
      { do: 'Complaint ya installation ka page kholiye, "Parts (challans)" card.', href: '/services/complaints' },
      { do: 'Line pe peela "1 serial not named" dikhta hai - uske paas [Add serial] dabaiye.' },
      { do: 'Serial dhoondh ke chuniye aur wajah likhiye. Save.' },
      { do: 'Ab serial GDN, bill aur Product History - har jagah dikhega.' },
    ],
    problems: [{ if: '[Add serial] nahi dikh raha', then: 'Ye stock rights (Roles → Stock: Edit) maangta hai. Store ya admin se karwaiye.' }],
    open: { href: '/reports/stock-health', label: 'Stock checks kholo' },
    related: ['serial-find'], pages: ['/services/complaints', '/services/installations', '/reports/stock-health'],
  }),
  H({
    id: 'complaint-pickup', level: 'field', area: 'Complaint', who: 'Technician / Office',
    q: 'Customer ka saman repair ke liye office kaise laaye?',
    also: ['pickup', 'pick up for repair', 'pickup receipt', 'dvr office le aaye', 'hand back'],
    short: 'Complaint ke page pe [Pick up for repair] → [Make pickup receipt].',
    steps: [
      { do: 'Complaint ka page kholiye.', href: '/services/complaints' },
      { do: '[Pick up for repair] dabaiye, kya le rahe hain (serial ke saath) likhiye.' },
      { do: '[Make pickup receipt] - customer ko receipt WhatsApp/print kariye.' },
      { do: 'Theek hone ke baad wapas dene pe handback ki receipt banaiye.' },
    ],
    related: ['complaint-supplier'], pages: ['/services/complaints'],
  }),
  H({
    id: 'complaint-supplier', level: 'office', area: 'Repair', who: 'Office / Store',
    q: 'Kharab saman supplier ya service centre ko kaise bheje?',
    also: ['rma', 'supplier dispatch', 'service centre bhejna', 'replacement case', 'warranty claim'],
    short: 'Customer Service → Supplier Dispatch mein saman chun ke [Make dispatch and send].',
    steps: [
      { do: 'Customer Service → Supplier Dispatch kholiye.', href: '/services/dispatch' },
      { do: 'Bhejne wale items tick kariye ([Tick all] bhi hai), "Going to" mein supplier chuniye.' },
      { do: '[Make dispatch and send] dabaiye, [Print delivery challan].' },
      { do: 'Wapas aane pe [Receive what came back]: [Repaired - same serial], [New serial sent] ya [Came back not repaired].' },
    ],
    open: { href: '/services/dispatch', label: 'Supplier Dispatch kholo' },
    related: ['complaint-pickup'], pages: ['/services/dispatch', '/services/replacements'],
  }),
  H({
    id: 'complaint-close', level: 'office', area: 'Complaint', who: 'Office',
    q: 'Complaint band aur bill kaise kare?',
    also: ['bill this job', 'complaint close', 'mark completed', 'service charge bill'],
    short: 'Kaam pura ho to [Mark completed], phir bill banana ho to [Bill this job].',
    steps: [
      { do: 'Complaint ka page kholiye.', href: '/services/complaints' },
      { do: 'Charge lena ho to [Add a charge] se service charge jodiye.' },
      { do: '[Bill this job] - bill (INV…) ban jaata hai. Warranty/AMC mein ho to bill nahi banta.' },
      { do: 'Bill nahi banana to [Mark completed]. Customer confirm kare to complaint band hoti hai.' },
    ],
    related: ['payment-record'], pages: ['/services/complaints'],
  }),

  // ======================================================== BILL & PAYMENT
  H({
    id: 'payment-record', level: 'office', area: 'Payment', who: 'Accounts / Office',
    q: 'Customer ka payment kaise jama kare?',
    also: ['record payment', 'paisa aaya', 'payment entry', 'upi payment', 'cash received', 'receipt banana', 'udhaar jama'],
    short: 'Bill (invoice) kholiye, [Record payment] dabaiye, raqam aur tareeka bhariye.',
    steps: [
      { do: 'Sales → Invoices mein bill kholiye (ya customer ke page se).', href: '/invoices' },
      { do: '[Record payment] dabaiye.', shot: 'payment-record' },
      { do: '"Amount received" mein raqam, "Method" mein Cash / UPI / Bank / Cheque chuniye. UPI/cheque ka number note mein.' },
      { do: '[Record ₹…] dabaiye. Receipt (RCPT-…) banti hai, bill "Paid" ya baaki due dikhata hai.' },
    ],
    problems: [
      { if: 'Ek payment kai bills ka hai', then: 'Accounts → Receipts se payment daaliye aur bills mein baantiye.' },
      { if: 'Galat payment daal diya', then: 'Receipt kholiye - cheque bounce ho to [Mark bounced]. Baaki galti ke liye accounts/admin se cancel karwaiye.' },
    ],
    open: { href: '/invoices', label: 'Invoices kholo' },
    related: ['payment-due'], pages: ['/invoices', '/customers', '/receipts', '/sales/orders'],
  }),
  H({
    id: 'payment-due', level: 'office', area: 'Payment', who: 'Accounts / Office',
    q: 'Customer ka kitna baaki hai kaise dekhe?',
    also: ['outstanding', 'ledger', 'due amount', 'statement bhejna', 'kitna paisa baaki'],
    short: 'Sales → Customers mein customer kholiye - "They owe" aur [View ledger].',
    steps: [
      { do: 'Sales → Customers mein customer kholiye.', href: '/customers' },
      { do: 'Upar "They owe" mein kul baaki dikhta hai.' },
      { do: '[View ledger] se har bill aur payment; [Statement PDF] se customer ko bhejiye.' },
    ],
    open: { href: '/customers', label: 'Customers kholo' },
    related: ['payment-record'], pages: ['/customers', '/invoices'],
  }),
  H({
    id: 'order-invoice', level: 'office', area: 'Bill', who: 'Accounts / Office',
    q: 'Sales order se bill kaise banaye?',
    also: ['raise invoice', 'invoice banana', 'bill banana order', 'gst bill'],
    short: 'Order ke page pe [Raise invoice], check kariye, [Issue invoice].',
    steps: [
      { do: 'Sales → Sales Orders mein order kholiye.', href: '/sales/orders' },
      { do: '[Raise invoice] dabaiye - lines order se aati hain.' },
      { do: 'Raqam, GST aur due date dekhiye, phir [Issue invoice].' },
      { do: '[Send WhatsApp] se customer ko bhejiye.' },
    ],
    open: { href: '/invoices', label: 'Invoices kholo' },
    related: ['payment-record'], pages: ['/sales/orders', '/invoices'],
  }),
  H({
    id: 'sales-return', level: 'office', area: 'Return', who: 'Accounts / Store',
    q: 'Customer saman wapas kare to kya kare (sales return)?',
    also: ['sales return', 'credit note', 'maal wapas aaya', 'return goods customer'],
    short: 'Returns & Refunds → Sales Return mein return banaiye, saman aane pe [Mark goods received], phir [Issue credit note].',
    steps: [
      { do: 'Returns & Refunds → Sales Return kholiye.', href: '/sales-return' },
      { do: 'Bill chuniye aur wapas aane wali items aur ginti daaliye.' },
      { do: 'Saman aane pe [Mark goods received] - bechne laayak saman stock mein jaata hai.' },
      { do: '[Issue credit note] - customer ke baaki se raqam ghat jaati hai.' },
    ],
    open: { href: '/sales-return', label: 'Sales Return kholo' },
    pages: ['/sales-return', '/invoices'],
  }),

  // ===================================================== STOCK & PURCHASE
  H({
    id: 'purchase-order', level: 'office', area: 'Purchase', who: 'Store / Office',
    q: 'Supplier ko purchase order kaise de?',
    also: ['po banana', 'purchase order', 'maal mangwana', 'new purchase order'],
    short: 'Purchase → Purchase Order mein [New purchase order].',
    steps: [
      { do: 'Purchase → Purchase Order kholiye.', href: '/purchase/orders' },
      { do: '[New purchase order], supplier chuniye, products aur rate daaliye ([Add line]).' },
      { do: '[Save draft] ya save kariye; approval ho to "Awaiting approval" mein jaata hai.' },
      { do: 'Maal aane pe [Receive goods] se GRN banaiye.' },
    ],
    open: { href: '/purchase/orders', label: 'Purchase Orders kholo' },
    related: ['goods-receipt'], pages: ['/purchase'],
  }),
  H({
    id: 'goods-receipt', level: 'field', area: 'Stock', who: 'Store',
    q: 'Naya maal stock mein kaise chadhaye (GRN)?',
    also: ['grn', 'receive goods', 'maal aaya', 'stock entry', 'serial entry purchase', 'goods receipt'],
    short: 'Inventory → Goods Receipt Note mein [Receive goods], serial daal ke [Receive and put in stock].',
    steps: [
      { do: 'Inventory → Goods Receipt Note kholiye (ya PO pe [Receive goods]).', href: '/goods-receipt' },
      { do: 'Supplier aur PO chuniye; aayi hui ginti daaliye.' },
      { do: 'Serial wale product ke har piece ka serial scan ya type kariye.' },
      { do: '[Receive and put in stock] - stock badhta hai, GRN number banta hai.' },
    ],
    problems: [{ if: 'Line "added no stock" dikhati hai', then: 'Woh product stock mein nahi ginta (service). Product ki setting dekhiye.' }],
    open: { href: '/goods-receipt', label: 'Goods Receipt kholo' },
    related: ['serial-find'], pages: ['/goods-receipt', '/purchase'],
  }),
  H({
    id: 'serial-find', level: 'field', area: 'Serial', who: 'Sab',
    q: 'Koi serial number kahan hai kaise pata kare?',
    also: ['serial search', 'serial history', 'camera kis customer ke paas', 'product history', 'look up a serial', 'imei kahan hai'],
    short: 'Inventory → Product History mein serial likhiye.',
    steps: [
      { do: 'Inventory → Product History kholiye aur serial number daaliye.', href: '/product-journey' },
      { do: 'Uski poori kahani dikhti hai: kab aaya (GRN), kis challan/bill se gaya, kis customer ke paas hai, kab wapas aaya.' },
    ],
    open: { href: '/product-journey', label: 'Product History kholo' },
    related: ['serial-add-later'], pages: ['/product-journey', '/stock-units', '/reports/product-stock'],
  }),
  H({
    id: 'stock-check', level: 'field', area: 'Stock', who: 'Store / Office',
    q: 'Kisi product ka stock kitna hai kaise dekhe?',
    also: ['stock dekhna', 'kitna maal hai', 'stock report', 'low stock'],
    short: 'Inventory → Stock kholiye aur product dhoondhiye.',
    steps: [
      { do: 'Inventory → Stock kholiye.', href: '/reports/product-stock' },
      { do: 'Product ka naam ya code search kariye - uski ginti har godown/branch ke hisaab se dikhti hai.' },
      { do: 'Serial wale product ke serials dekhne ke liye uspe click kariye.' },
    ],
    open: { href: '/reports/product-stock', label: 'Stock kholo' },
    related: ['serial-find', 'goods-receipt'], pages: ['/reports/product-stock', '/products'],
  }),

  // ========================================================= CUSTOMER & AMC
  H({
    id: 'customer-new', level: 'office', area: 'Customer', who: 'Office / Sales',
    q: 'Naya customer kaise banaye?',
    also: ['add customer', 'customer add karna', 'party banana', 'grahak jodna'],
    short: 'Sales → Customers pe [Add Customer] dabaiye.',
    steps: [
      { do: 'Sales → Customers kholiye.', href: '/customers' },
      { do: '[Add Customer] dabaiye.' },
      { do: 'Naam, mobile, address bhariye. GST wale customer ka GSTIN bhi.' },
      { do: 'Save kariye. Customer code (PTY-…) banta hai; ab complaint, quotation, bill sab mein chunaa ja sakta hai.' },
    ],
    problems: [{ if: 'Button dhundhla hai', then: 'Upar "All Company" chuna hai - ek branch chuniye.' }],
    open: { href: '/customers', label: 'Customers kholo' },
    related: ['complaint-new', 'payment-due'], pages: ['/customers'],
  }),
  H({
    id: 'amc-new', level: 'office', area: 'AMC', who: 'Office / Sales',
    q: 'AMC (maintenance contract) kaise banaye?',
    also: ['amc banana', 'maintenance contract', 'amc renew', 'amc invoice', 'saal bhar ka contract'],
    short: 'Customer Service → Maintenance Contracts mein [New contract], items jodiye, [Activate].',
    steps: [
      { do: 'Customer Service → Maintenance Contracts kholiye.', href: '/services/amc' },
      { do: '[New contract] dabaiye, customer aur tareekhein chuniye.' },
      { do: '[Add item] se cover hone wale cameras/DVR jodiye (serial scan bhi kar sakte hain).' },
      { do: 'Contract kholke [Activate]; bill ke liye [Raise AMC invoice].' },
      { do: 'Khatam hone pe "Renewal due" dikhta hai - [Renew…] se naya saal.' },
    ],
    open: { href: '/services/amc', label: 'Maintenance Contracts kholo' },
    related: ['payment-record'], pages: ['/services/amc'],
  }),
  H({
    id: 'tech-phone', level: 'field', area: 'Technician', who: 'Technician',
    q: 'Technician apna kaam phone pe kaise dekhe?',
    also: ['technician app', 'my work', 'phone app job', 'aaj ka kaam', 'mobile app'],
    short: 'Vcare phone app mein "My work" kholiye - New, Today, Late, Waiting aur All mein saare jobs.',
    steps: [
      { do: 'Phone pe Vcare app kholiye aur apne username se login kariye.' },
      { do: '"My work" mein Today dekhiye - aaj ke visits. Late mein peeche chal rahe jobs.' },
      { do: 'Job kholke site pe pahunchiye, photos daaliye, kaam ke baad work done kariye.' },
      { do: 'Installation pe har item ka serial scan kariye - office ko turant dikhta hai.' },
    ],
    problems: [{ if: 'Job phone pe nahi dikh raha', then: 'Office se poochiye ki job aapke naam pe assign hai ya nahi, aur visit lagi hai ya nahi.' }],
    related: ['complaint-assign'],
  }),

  // =============================================================== GENERAL
  H({
    id: 'search', level: 'field', area: 'Shuruaat', who: 'Sab',
    q: 'Kuch bhi jaldi kaise dhoondhe?',
    also: ['search', 'ctrl k', 'complaint number se dhoondhna', 'phone se customer dhoondhna', 'purana number'],
    short: 'Kisi bhi page pe Ctrl+K dabaiye aur number, naam ya phone likhiye.',
    steps: [
      { do: 'Ctrl+K dabaiye (ya upar "Search" pe click).' },
      { do: 'CMP-…, ENQ…, INV…, ECHN…, naam ya mobile likhiye - purane system ke number bhi chalte hain.' },
      { do: 'Result pe click kariye - seedha uska page khulta hai.' },
    ],
    related: ['old-data'], pages: ['/dashboard'],
  }),
  H({
    id: 'old-data', level: 'field', area: 'Purana system', who: 'Sab',
    q: 'Purane software ka data kahan milega?',
    also: ['old system remarks', 'purane remarks', 'mongo data', 'from the old system', 'purani complaint'],
    short: 'Purane number se search kariye. Remarks document ke "From the old system" mein hain.',
    steps: [
      { do: 'Ctrl+K mein purana number likhiye (COMP…, ENQ…, CCHN…, ECHN…, INV…) - wahi number yahan bhi hai.' },
      { do: 'Challan, quotation, order aur bill ke page pe neeche "From the old system" mein us kaam ke purane remarks hain - likhne wale ke naam ke saath.' },
      { do: 'Enquiry aur complaint ke page pe yahi remarks Timeline mein "Old system" tag ke saath hain.' },
    ],
    problems: [{ if: '28 Oct ke baad ka purana data nahi dikh raha', then: 'Wo abhi migrate nahi hua. Admin ko bataiye.' }],
    related: ['search'],
  }),
  H({
    id: 'hindi', level: 'field', area: 'Shuruaat', who: 'Sab',
    q: 'App Hindi mein kaise kare?',
    also: ['hindi language', 'bhasha badalna', 'english hindi'],
    short: 'Upar [EN] button dabaiye - poora app Hindi mein ho jaata hai.',
    steps: [{ do: 'Upar daayein [EN] dabaiye. Wapas English ke liye phir dabaiye.' }],
  }),
  H({
    id: 'branch', level: 'field', area: 'Shuruaat', who: 'Sab',
    q: 'Branch kaise badle?',
    also: ['store change', 'all company', 'dusri branch ka data', 'branch selector'],
    short: 'Upar branch ke naam pe click karke doosri branch chuniye.',
    steps: [
      { do: 'Upar ki patti mein branch ke naam pe click kariye.' },
      { do: 'Branch chuniye. "All Company" mein sab dikhta hai par kuch banaya nahi ja sakta.' },
    ],
    related: ['error-single-store'],
  }),

  // ================================================================ ERRORS
  H({
    id: 'error-no-serial', level: 'field', area: 'Problem', who: 'Sab',
    q: '"No serial numbers available" kyun aata hai?',
    also: ['No serial numbers available', 'Which serial numbers came back', 'receive back nahi ho raha', 'serial nahi dikh raha receive'],
    short: 'Page purana khula hai. Ctrl+Shift+R se refresh kariye - phir ginti se receive hota hai.',
    steps: [
      { do: 'Ctrl+Shift+R dabaiye (phone pe page neeche kheench ke refresh).' },
      { do: 'Line pe phir [Receive N into stock] dabaiye. Jahan serial juda nahi, woh ginti se wapas aata hai.' },
      { do: 'Serial record karna ho to pehle [Add serial] se jodiye.' },
    ],
    related: ['challan-return', 'serial-add-later'],
  }),
  H({
    id: 'error-single-store', level: 'field', area: 'Problem', who: 'Sab',
    q: '"Select a single store" error kyun aata hai?',
    also: ['Select a single store', 'Select a single store before converting', 'button grey hai', 'all company'],
    short: 'Upar branch "All Company" pe hai. Ek branch chuniye.',
    steps: [{ do: 'Upar branch ke naam pe click karke apni branch chuniye, phir dobara kariye.' }],
    related: ['branch'],
  }),
  H({
    id: 'error-permission', level: 'field', area: 'Problem', who: 'Sab',
    q: '"Permission nahi hai" error aaye to kya kare?',
    also: ['You do not have permission', 'needs stock rights', 'Roles > Stock: Edit', 'not permitted', 'access nahi', 'button nahi dikh raha'],
    short: 'Aapke role mein ye kaam allowed nahi. Admin se permission maangiye.',
    steps: [
      { do: 'Error mein jo likha hai (jaise "Roles > Stock: Edit") woh note kariye.' },
      { do: 'Admin ko bataiye - woh Settings → Roles mein aapke role ko de sakte hain.' },
    ],
  }),
  H({
    id: 'error-stuck', level: 'field', area: 'Problem', who: 'Sab',
    q: 'Page "Loading…" pe atka hai ya button kaam nahi kar raha',
    also: ['loading', 'page nahi khul raha', 'button kaam nahi kar raha', 'hang', 'slow', 'atak gaya'],
    short: 'Ctrl+Shift+R se refresh kariye. Phir bhi na chale to internet aur login dekhiye.',
    steps: [
      { do: 'Ctrl+Shift+R dabaiye - naya version aata hai.' },
      { do: 'Internet chal raha hai? Doosri tab mein koi site khol ke dekhiye.' },
      { do: 'Phir bhi atka ho to Helpdesk → Tickets pe screenshot ke saath likhiye.', href: '/helpdesk' },
    ],
  }),
  H({
    id: 'error-login', level: 'field', area: 'Problem', who: 'Sab',
    q: 'Login nahi ho raha / password bhool gaye',
    also: ['password bhool gaya', 'login locked', 'account lock', 'forgot password', 'wrong password'],
    short: '5 baar galat password pe login 15 minute band hota hai. Admin password reset kar sakta hai.',
    steps: [
      { do: '15 minute ruk ke sahi username-password se try kariye.' },
      { do: 'Password yaad nahi to admin se reset karwaiye - woh naya temporary password denge.' },
      { do: 'Login ke baad apna password badal lijiye.' },
    ],
  }),
];

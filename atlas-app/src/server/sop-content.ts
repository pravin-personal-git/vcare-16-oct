import 'server-only';
import type { Level } from '@/lib/levels';

/**
 * THE SOP GUIDEBOOK - "Ek din ka business" (5 Oct 2026, Pravin's brief).
 *
 * The Handbook (handbook-content.ts) answers "where is the button". This
 * answers "how does the business run": a demo CCTV installation and service
 * business, built from Vcare's own catalogue, lived through one working day -
 * every setting in the order you make it, every flow as a diagram, every step
 * with who does it, why, the demo values and a link to the live screen.
 *
 * Two languages: Hinglish (Roman, the default) and Hindi (Devanagari). No
 * English - Pravin, 5 Oct 2026: the people reading this think in Hindi.
 *
 * SERVER-ONLY, like the handbook: chapters above the reader's level are never
 * sent (the setup chapter is for admins). Within a chapter every step names
 * its role, and the "Main kaun hoon" chips narrow the page to one role.
 *
 * Statuses, buttons and defaults here are copied from the code (lib/job-flow,
 * lib/job-settings, lib/config-registry, lib/settings-registry, the phone
 * app's JobNextStep). When one of those changes, change this in the same
 * commit. The demo names and amounts are examples - they are not in the live
 * database, the links open the real screens.
 */

export interface Tx { hl: string; hi: string }
export interface SopLink { href: string; label: Tx }

/** Who does a step. `customer` and `system` appear in flows, never as a reader. */
export type SopRole = 'owner' | 'office' | 'sales' | 'store' | 'tech' | 'accounts' | 'customer' | 'system';
/** The roles a reader can pick in "Main kaun hoon". */
export const READER_ROLES = ['owner', 'office', 'sales', 'store', 'tech', 'accounts'] as const;
export type ReaderRole = (typeof READER_ROLES)[number];

export const ROLE_LABEL: Record<SopRole, Tx> = {
  owner: { hl: 'Maalik', hi: 'मालिक' },
  office: { hl: 'Office / Manager', hi: 'ऑफ़िस / मैनेजर' },
  sales: { hl: 'Sales', hi: 'सेल्स' },
  store: { hl: 'Store', hi: 'स्टोर' },
  tech: { hl: 'Technician', hi: 'टेक्नीशियन' },
  accounts: { hl: 'Accounts', hi: 'अकाउंट्स' },
  customer: { hl: 'Customer', hi: 'ग्राहक' },
  system: { hl: 'Atlas apne aap', hi: 'एटलस अपने आप' },
};

/** The lowest reader level each role's chip needs (a technician cannot pick "Maalik"). */
export const ROLE_LEVEL: Record<ReaderRole, Level> = {
  tech: 'field', store: 'field', sales: 'office', office: 'office', accounts: 'office', owner: 'admin',
};

export interface SopStep {
  role: SopRole;
  t: Tx;
  /** What to do, in plain words. */
  p: Tx;
  /** The demo business doing it - names, numbers, amounts. */
  demo?: Tx;
  /** Business logic: why this step exists, what goes wrong without it. */
  why?: Tx;
  links?: SopLink[];
  /** Done on the phone app (Vcare) rather than the website. */
  phone?: boolean;
  /**
   * A screenshot of the real screen, `public/sop/<shot>.jpg`. Taken from the
   * demo company on a local copy (never a client's data) - retake it when the
   * screen changes. A test checks the file exists.
   */
  shot?: string;
}

export interface FlowNode { role: SopRole; t: Tx; sub?: Tx }
export interface LifeState { code: string; t: Tx; who: Tx; tone: 'new' | 'work' | 'wait' | 'done' | 'end' }
export interface TimeItem extends SopStep { time: string }

export type SopBlock =
  | { k: 'para'; text: Tx }
  | { k: 'why'; text: Tx }
  | { k: 'note'; tone: 'tip' | 'warn' | 'good'; text: Tx }
  | { k: 'flow'; title: Tx; nodes: FlowNode[]; foot?: Tx }
  | { k: 'states'; title: Tx; states: LifeState[]; side?: Tx[] }
  | { k: 'steps'; title?: Tx; items: SopStep[] }
  | { k: 'timeline'; items: TimeItem[] }
  | { k: 'table'; title?: Tx; head: Tx[]; rows: (Tx | string)[][] }
  | { k: 'cards'; items: { t: Tx; p: Tx; tag?: Tx }[] };

export interface SopChapter {
  id: string;
  level: Level;
  part: Tx;
  title: Tx;
  purpose: Tx;
  blocks: SopBlock[];
}

const T = (hl: string, hi: string): Tx => ({ hl, hi });
const L = (href: string, hl: string, hi: string): SopLink => ({ href, label: T(hl, hi) });

const P = {
  start: T('Shuruaat', 'शुरुआत'),
  setup: T('Din 0: Setup', 'दिन 0: सेटअप'),
  flows: T('Workflow aur lifecycle', 'वर्कफ़्लो और लाइफ़साइकल'),
  people: T('Log aur HR', 'लोग और HR'),
  day: T('Demo din', 'डेमो दिन'),
  month: T('Mahine ka ant', 'महीने का अंत'),
  books: T('Har role ki kitaab', 'हर रोल की किताब'),
  help: T('Madad', 'मदद'),
};

// ---------------------------------------------------------------- demo cast
// Products are four real lines from Vcare's catalogue; prices are examples.
const DOME = 'CP PLUS CAMERA DOME 2.4 MP G+ AUDIO 360';
const BULLET = 'CP PLUS CAMERA BULLET 2.4MP G+ AUDIO 360';
const DVR = 'CP PLUS DVR 4 CHANNEL';
const EZY = 'CP PLUS CAMERA PT EZYKAM 3MP CP-E38Q';

export const SOP_CHAPTERS: SopChapter[] = [
  // ================================================================ start
  {
    id: 'read', level: 'field', part: P.start,
    title: T('Ye guidebook kaise padhein', 'ये गाइडबुक कैसे पढ़ें'),
    purpose: T(
      'Ek demo CCTV business ka poora din - subah ki pehli call se shaam ke hisaab tak. Har step mein likha hai kaun karega, kya karna hai, kyun karna hai, aur Atlas mein kahan karna hai.',
      'एक डेमो CCTV बिज़नेस का पूरा दिन - सुबह की पहली कॉल से शाम के हिसाब तक। हर कदम में लिखा है कौन करेगा, क्या करना है, क्यों करना है, और एटलस में कहाँ करना है।',
    ),
    blocks: [
      { k: 'cards', items: [
        { t: T('1. Apna role chuno', '1. अपना रोल चुनें'), p: T('Upar "Main kaun hoon" mein apna kaam chuno - Technician, Store, Sales, Office, Accounts ya Maalik. Phir sirf aapke steps dikhenge. "Sab" dabao to poora business dikhega.', 'ऊपर "मैं कौन हूँ" में अपना काम चुनें - टेक्नीशियन, स्टोर, सेल्स, ऑफ़िस, अकाउंट्स या मालिक। फिर सिर्फ़ आपके कदम दिखेंगे। "सब" दबाएँ तो पूरा बिज़नेस दिखेगा।') },
        { t: T('2. Bhasha badlo', '2. भाषा बदलें'), p: T('Upar "हिंदी" button se poori kitaab Hindi lipi mein ho jaati hai. Wapas "Hinglish" dabao.', 'ऊपर "Hinglish" बटन से पूरी किताब रोमन (Hinglish) में हो जाती है। वापस "हिंदी" दबाएँ।') },
        { t: T('3. Link dabao', '3. लिंक दबाएँ'), p: T('Har step ke neeche naarangi (orange) link Atlas ki asli screen kholta hai. Padhte padhte wahin karke dekho.', 'हर कदम के नीचे नारंगी लिंक एटलस की असली स्क्रीन खोलता है। पढ़ते-पढ़ते वहीं करके देखें।') },
        { t: T('4. Tick lagao', '4. टिक लगाएँ'), p: T('Jo step seekh liya, uska dabba tick karo. Tick sirf isi computer ya phone par yaad rehta hai.', 'जो कदम सीख लिया, उसका डिब्बा टिक करें। टिक सिर्फ़ इसी कंप्यूटर या फ़ोन पर याद रहता है।') },
      ] },
      { k: 'table', title: T('Har step mein kya likha hota hai', 'हर कदम में क्या लिखा होता है'), head: [T('Nishaan', 'निशान'), T('Matlab', 'मतलब')], rows: [
        [T('Rangeen badge', 'रंगीन बैज'), T('Ye step kaun karta hai - Technician, Store, Office...', 'ये कदम कौन करता है - टेक्नीशियन, स्टोर, ऑफ़िस...')],
        [T('📱 Phone', '📱 फ़ोन'), T('Ye kaam Vcare phone app mein hota hai, website mein nahi.', 'ये काम Vcare फ़ोन ऐप में होता है, वेबसाइट में नहीं।')],
        [T('Demo', 'डेमो'), T('Hamara demo business ye step kaise karta hai - asli naam aur number ke saath.', 'हमारा डेमो बिज़नेस ये कदम कैसे करता है - असली नाम और नंबर के साथ।')],
        [T('Kyun?', 'क्यों?'), T('Business ka logic - ye step kyun zaroori hai, na karein to kya bigadta hai.', 'बिज़नेस का लॉजिक - ये कदम क्यों ज़रूरी है, न करें तो क्या बिगड़ता है।')],
      ] },
      { k: 'note', tone: 'warn', text: T(
        'Demo ke naam aur rakam sirf samjhane ke liye hain - ye aapke Atlas mein nahi milenge. Links aapki asli screen kholte hain, isliye wahan jo bhi save karoge wo asli hoga.',
        'डेमो के नाम और रकम सिर्फ़ समझाने के लिए हैं - ये आपके एटलस में नहीं मिलेंगे। लिंक आपकी असली स्क्रीन खोलते हैं, इसलिए वहाँ जो भी सेव करेंगे वो असली होगा।',
      ) },
    ],
  },
  {
    id: 'cast', level: 'field', part: P.start,
    title: T('Hamara demo business: Suraksha Security Systems', 'हमारा डेमो बिज़नेस: सुरक्षा सिक्योरिटी सिस्टम्स'),
    purpose: T(
      'CCTV camera bechna, lagana (installation) aur kharab hone par theek karna (service). Ek branch, saat log, chaar product.',
      'CCTV कैमरा बेचना, लगाना (इंस्टॉलेशन) और ख़राब होने पर ठीक करना (सर्विस)। एक ब्रांच, सात लोग, चार प्रोडक्ट।',
    ),
    blocks: [
      { k: 'table', title: T('Log aur unka kaam', 'लोग और उनका काम'), head: [T('Naam', 'नाम'), T('Role', 'रोल'), T('Roz kya karte hain', 'रोज़ क्या करते हैं'), T('Kahan se', 'कहाँ से')], rows: [
        ['Rajesh Mehta', T('Maalik', 'मालिक'), T('Subah aur shaam Dashboard, badi approval, paisa aur faayda dekhna', 'सुबह और शाम डैशबोर्ड, बड़ी मंज़ूरी, पैसा और फ़ायदा देखना'), T('Website + phone', 'वेबसाइट + फ़ोन')],
        ['Pooja', T('Office / Manager', 'ऑफ़िस / मैनेजर'), T('Complaint lena, technician ko dena, estimate bhejna, job band karna, bill banana', 'शिकायत लेना, टेक्नीशियन को देना, एस्टिमेट भेजना, जॉब बंद करना, बिल बनाना'), T('Website', 'वेबसाइट')],
        ['Amit', T('Sales', 'सेल्स'), T('Lead, quotation, order', 'लीड, कोटेशन, ऑर्डर'), T('Website + phone', 'वेबसाइट + फ़ोन')],
        ['Sunil', T('Store', 'स्टोर'), T('Parts challan approve karna, maal dena (GDN), wapas aaya maal lena', 'पार्ट्स चालान मंज़ूर करना, माल देना (GDN), वापस आया माल लेना'), T('Website', 'वेबसाइट')],
        ['Ravi', T('Technician (installation)', 'टेक्नीशियन (इंस्टॉलेशन)'), T('Naye camera lagana', 'नए कैमरे लगाना'), T('Phone', 'फ़ोन')],
        ['Imran', T('Technician (service)', 'टेक्नीशियन (सर्विस)'), T('Kharab camera theek karna', 'ख़राब कैमरा ठीक करना'), T('Phone', 'फ़ोन')],
        ['Neha', T('Accounts', 'अकाउंट्स'), T('Invoice, paisa aaya (receipt), bakaya', 'इनवॉइस, पैसा आया (रसीद), बकाया'), T('Website', 'वेबसाइट')],
      ] },
      { k: 'table', title: T('Chaar product (Vcare ki list se)', 'चार प्रोडक्ट (वीकेयर की लिस्ट से)'), head: [T('Product', 'प्रोडक्ट'), T('Kis kaam ka', 'किस काम का'), T('Bechne ka daam (misaal)', 'बेचने का दाम (मिसाल)')], rows: [
        [DOME, T('Andar (indoor) dome camera, awaaz ke saath', 'अंदर (इनडोर) डोम कैमरा, आवाज़ के साथ'), '₹1,450'],
        [BULLET, T('Bahar (outdoor) bullet camera', 'बाहर (आउटडोर) बुलेट कैमरा'), '₹1,650'],
        [DVR, T('4 camera ki recording machine - har piece ka serial number track hota hai', '4 कैमरों की रिकॉर्डिंग मशीन - हर पीस का सीरियल नंबर ट्रैक होता है'), '₹3,200'],
        [EZY, T('WiFi wala ghoomne wala (PT) camera - dukaan aur ghar ke liye', 'WiFi वाला घूमने वाला (PT) कैमरा - दुकान और घर के लिए'), '₹2,600'],
        [T('Installation charge (service)', 'इंस्टॉलेशन चार्ज (सर्विस)'), T('Har camera lagane ka', 'हर कैमरा लगाने का'), '₹400'],
        [T('Visit charge', 'विज़िट चार्ज'), T('Bina estimate wale service job par', 'बिना एस्टिमेट वाले सर्विस जॉब पर'), '₹300'],
      ] },
      { k: 'table', title: T('Aaj ke do customer', 'आज के दो ग्राहक'), head: [T('Customer', 'ग्राहक'), T('Kya chahiye', 'क्या चाहिए')], rows: [
        [T('Green Valley Society (Kulkarni ji, secretary)', 'ग्रीन वैली सोसाइटी (कुलकर्णी जी, सेक्रेटरी)'), T('Naya installation: 3 bullet + 1 dome + 1 DVR', 'नया इंस्टॉलेशन: 3 बुलेट + 1 डोम + 1 DVR')],
        [T('Sharma Medical Store', 'शर्मा मेडिकल स्टोर'), T('Complaint: EzyKam camera band (offline). Saath mein ek dome aur lagwana hai.', 'शिकायत: EzyKam कैमरा बंद (ऑफ़लाइन)। साथ में एक डोम और लगवाना है।')],
      ] },
    ],
  },
  {
    id: 'picture', level: 'field', part: P.start,
    title: T('Business ki badi tasveer', 'बिज़नेस की बड़ी तस्वीर'),
    purpose: T(
      'Atlas chaar zanjeer (chain) saath chalata hai: bechna, service, stock, aur log. Lagbhag har screen inme se kisi ek ka ek step hai.',
      'एटलस चार ज़ंजीरें (चेन) साथ चलाता है: बेचना, सर्विस, स्टॉक, और लोग। लगभग हर स्क्रीन इनमें से किसी एक का एक कदम है।',
    ),
    blocks: [
      { k: 'flow', title: T('1. Bechna aur lagana (installation)', '1. बेचना और लगाना (इंस्टॉलेशन)'), nodes: [
        { role: 'sales', t: T('Lead', 'लीड'), sub: T('poochhtaachh', 'पूछताछ') },
        { role: 'sales', t: T('Quotation', 'कोटेशन'), sub: T('daam diya', 'दाम दिया') },
        { role: 'sales', t: T('Sales order', 'सेल्स ऑर्डर'), sub: T('customer ne haan kaha', 'ग्राहक ने हाँ कहा') },
        { role: 'office', t: T('Installation job', 'इंस्टॉलेशन जॉब'), sub: T('order se', 'ऑर्डर से') },
        { role: 'tech', t: T('Site par kaam', 'साइट पर काम'), sub: T('challan + GDN', 'चालान + GDN') },
        { role: 'customer', t: T('Customer ka code', 'ग्राहक का कोड'), sub: T('kaam pakka', 'काम पक्का') },
        { role: 'accounts', t: T('Invoice', 'इनवॉइस') },
        { role: 'accounts', t: T('Receipt', 'रसीद'), sub: T('paisa aaya', 'पैसा आया') },
      ] },
      { k: 'flow', title: T('2. Service (kharab camera)', '2. सर्विस (ख़राब कैमरा)'), nodes: [
        { role: 'office', t: T('Complaint', 'शिकायत'), sub: T('call / portal / app', 'कॉल / पोर्टल / ऐप') },
        { role: 'office', t: T('Technician ko diya', 'टेक्नीशियन को दिया') },
        { role: 'tech', t: T('Accept + visit', 'स्वीकार + विज़िट') },
        { role: 'tech', t: T('Site par (GPS)', 'साइट पर (GPS)') },
        { role: 'store', t: T('Parts challan', 'पार्ट्स चालान'), sub: T('zaroorat ho to', 'ज़रूरत हो तो') },
        { role: 'customer', t: T('Estimate haan', 'एस्टिमेट हाँ'), sub: T('paise wala kaam ho to', 'पैसे वाला काम हो तो') },
        { role: 'tech', t: T('Work done', 'काम पूरा') },
        { role: 'customer', t: T('6 ank ka code', '6 अंकों का कोड') },
        { role: 'office', t: T('Band + bill', 'बंद + बिल') },
      ] },
      { k: 'flow', title: T('3. Stock', '3. स्टॉक'), nodes: [
        { role: 'office', t: T('Purchase bill', 'परचेज़ बिल'), sub: T('maal aaya', 'माल आया') },
        { role: 'store', t: T('Godaam mein stock', 'गोदाम में स्टॉक') },
        { role: 'store', t: T('GDN', 'GDN'), sub: T('technician ko diya', 'टेक्नीशियन को दिया') },
        { role: 'tech', t: T('Customer ke yahan laga', 'ग्राहक के यहाँ लगा') },
        { role: 'store', t: T('Bacha maal wapas', 'बचा माल वापस') },
      ] },
      { k: 'flow', title: T('4. Log', '4. लोग'), nodes: [
        { role: 'tech', t: T('Clock in', 'क्लॉक इन') },
        { role: 'system', t: T('Location + km', 'लोकेशन + किमी') },
        { role: 'tech', t: T('Clock out', 'क्लॉक आउट') },
        { role: 'office', t: T('Attendance', 'अटेंडेंस') },
        { role: 'accounts', t: T('Travel allowance + salary', 'यात्रा भत्ता + सैलरी') },
      ] },
      { k: 'cards', items: [
        { t: T('Draft ka koi asar nahi', 'ड्राफ़्ट का कोई असर नहीं'), p: T('Draft se na stock hilta hai, na paisa bakaya hota hai. Koi number kam lage to pehle draft dekho.', 'ड्राफ़्ट से न स्टॉक हिलता है, न पैसा बकाया होता है। कोई संख्या कम लगे तो पहले ड्राफ़्ट देखें।') },
        { t: T('Kuch delete nahi hota', 'कुछ डिलीट नहीं होता'), p: T('Galti ho to cancel, reverse ya credit note - kaaran ke saath. Isse har number ka hisaab milta rehta hai.', 'ग़लती हो तो कैंसल, रिवर्स या क्रेडिट नोट - कारण के साथ। इससे हर संख्या का हिसाब मिलता रहता है।') },
        { t: T('Total gina jaata hai, likha nahi jaata', 'कुल गिना जाता है, लिखा नहीं जाता'), p: T('Customer ka bakaya har baar invoice, receipt aur credit note se gina jaata hai - isliye do screen kabhi alag baat nahi kehti.', 'ग्राहक का बकाया हर बार इनवॉइस, रसीद और क्रेडिट नोट से गिना जाता है - इसलिए दो स्क्रीन कभी अलग बात नहीं कहतीं।') },
        { t: T('Har kaam ka record', 'हर काम का रिकॉर्ड'), p: T('Kisne kya, kab, kahan se badla - Activity Log mein rehta hai. Koi use badal nahi sakta.', 'किसने क्या, कब, कहाँ से बदला - एक्टिविटी लॉग में रहता है। कोई उसे बदल नहीं सकता।') },
        { t: T('Kagaz ek doosre se jude', 'काग़ज़ एक-दूसरे से जुड़े'), p: T('Complaint → challan → GDN → invoice → receipt: har page par baaki sab ke link hote hain. Dobara type mat karo - pichhle kaagaz se agla banao ("Convert to Order", "Raise invoice").', 'शिकायत → चालान → GDN → इनवॉइस → रसीद: हर पेज पर बाक़ी सबके लिंक होते हैं। दोबारा टाइप मत करें - पिछले काग़ज़ से अगला बनाएँ ("Convert to Order", "Raise invoice")।') },
      ] },
    ],
  },
  {
    id: 'who', level: 'field', part: P.start,
    title: T('Kaun kya karta hai', 'कौन क्या करता है'),
    purpose: T('Har role ka roz ka kaam, aur Atlas mein uski screen.', 'हर रोल का रोज़ का काम, और एटलस में उसकी स्क्रीन।'),
    blocks: [
      { k: 'steps', items: [
        { role: 'owner', t: T('Maalik', 'मालिक'), p: T('Subah: Dashboard - khule kaam, kisse kitna lena hai. Din mein: phone par badi approval (discount, refund). Shaam: aaj ki bikri, collection, technician ka kaam, Activity Log.', 'सुबह: डैशबोर्ड - खुले काम, किससे कितना लेना है। दिन में: फ़ोन पर बड़ी मंज़ूरी (डिस्काउंट, रिफ़ंड)। शाम: आज की बिक्री, कलेक्शन, टेक्नीशियन का काम, एक्टिविटी लॉग।'), links: [L('/dashboard', 'Dashboard', 'डैशबोर्ड'), L('/my/reminders', 'My Desk', 'माई डेस्क')] },
        { role: 'office', t: T('Office / Manager', 'ऑफ़िस / मैनेजर'), p: T('Complaint darj karna, sahi technician ko dena, Job Board par nazar, estimate bhejna, job band karna, "Bill this job".', 'शिकायत दर्ज करना, सही टेक्नीशियन को देना, जॉब बोर्ड पर नज़र, एस्टिमेट भेजना, जॉब बंद करना, "Bill this job"।'), links: [L('/services/complaints', 'Customer Complaints', 'कस्टमर कंप्लेंट्स'), L('/services/board', 'Job Board', 'जॉब बोर्ड')] },
        { role: 'sales', t: T('Sales', 'सेल्स'), p: T('Lead ka follow-up, quotation, customer haan bole to Sales Order.', 'लीड का फ़ॉलो-अप, कोटेशन, ग्राहक हाँ बोले तो सेल्स ऑर्डर।'), links: [L('/crm/leads', 'Leads', 'लीड्स'), L('/quotation', 'Quotations', 'कोटेशन'), L('/sales/orders', 'Sales Orders', 'सेल्स ऑर्डर')] },
        { role: 'store', t: T('Store', 'स्टोर'), p: T('Technician ka parts challan My Desk mein approve karna, maal dena (aam maal ka GDN apne aap; serial wala "Parts counter" se), bacha aur kharab maal wapas lena.', 'टेक्नीशियन का पार्ट्स चालान My Desk में मंज़ूर करना, माल देना (आम माल का GDN अपने आप; सीरियल वाला "Parts counter" से), बचा और ख़राब माल वापस लेना।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क'), L('/goods-dispatch/job-parts', 'Parts counter', 'पार्ट्स काउंटर'), L('/reports/product-stock', 'Stock', 'स्टॉक')] },
        { role: 'tech', t: T('Technician', 'टेक्नीशियन'), p: T('Phone par: Clock in, job accept, visit book, "On my way", site par "Working on site", parts, "Work done", customer ka code, Clock out.', 'फ़ोन पर: क्लॉक इन, जॉब स्वीकार, विज़िट बुक, "On my way", साइट पर "Working on site", पार्ट्स, "Work done", ग्राहक का कोड, क्लॉक आउट।'), phone: true },
        { role: 'accounts', t: T('Accounts', 'अकाउंट्स'), p: T('Invoice issue karna, paisa aane par receipt (kis invoice par laga, ye batana), bakaya (outstanding) dekhna.', 'इनवॉइस जारी करना, पैसा आने पर रसीद (किस इनवॉइस पर लगा, ये बताना), बकाया देखना।'), links: [L('/invoices', 'Invoices', 'इनवॉइस'), L('/receipts', 'Receipts', 'रसीदें')] },
      ] },
    ],
  },

  // ================================================================ setup
  {
    id: 'setup', level: 'admin', part: P.setup,
    title: T('Din 0: Atlas ko business ke hisaab se set karna', 'दिन 0: एटलस को बिज़नेस के हिसाब से सेट करना'),
    purpose: T(
      'Pehla kaam chalu karne se pehle ye settings ek baar. Isi kram (order) mein karo - har agla step pichhle par tika hai. Saari settings ek jagah: Settings (menu mein sabse neeche).',
      'पहला काम चालू करने से पहले ये सेटिंग्स एक बार। इसी क्रम में करें - हर अगला कदम पिछले पर टिका है। सारी सेटिंग्स एक जगह: Settings (मेन्यू में सबसे नीचे)।',
    ),
    blocks: [
      { k: 'flow', title: T('Setup ka kram', 'सेटअप का क्रम'), nodes: [
        { role: 'owner', t: T('1. Aap kaun ho', '1. आप कौन हैं'), sub: T('naam, logo, GST', 'नाम, लोगो, GST') },
        { role: 'owner', t: T('2. Paisa', '2. पैसा'), sub: T('bank, opening', 'बैंक, ओपनिंग') },
        { role: 'owner', t: T('3. Kya bechte ho', '3. क्या बेचते हैं'), sub: T('product', 'प्रोडक्ट') },
        { role: 'owner', t: T('4. Kaagaz + niyam', '4. काग़ज़ + नियम'), sub: T('approval, field job', 'मंज़ूरी, फ़ील्ड जॉब') },
        { role: 'owner', t: T('5. Log', '5. लोग'), sub: T('role, user', 'रोल, यूज़र') },
        { role: 'owner', t: T('6. Attendance', '6. अटेंडेंस') },
        { role: 'owner', t: T('7. Phone', '7. फ़ोन'), sub: T('pair', 'पेयर') },
        { role: 'owner', t: T('8. Data + Customisation', '8. डेटा + कस्टमाइज़ेशन') },
      ] },
      { k: 'steps', title: T('1. Aap kaun ho', '1. आप कौन हैं'), items: [
        { role: 'owner', shot: 'settings-hub', t: T('Company ka naam, pata, logo', 'कंपनी का नाम, पता, लोगो'), p: T('Org Profile mein bharo. Ye har quotation, invoice, customer link aur portal par chhapta hai.', 'Org Profile में भरें। ये हर कोटेशन, इनवॉइस, ग्राहक लिंक और पोर्टल पर छपता है।'), demo: T('Suraksha Security Systems, logo upload, phone aur pata.', 'सुरक्षा सिक्योरिटी सिस्टम्स, लोगो अपलोड, फ़ोन और पता।'), why: T('Customer ko WhatsApp par jo link jaata hai uspar yahi logo dikhta hai. Logo nahi to bill kisi aur ka lagta hai.', 'ग्राहक को WhatsApp पर जो लिंक जाता है उस पर यही लोगो दिखता है। लोगो नहीं तो बिल किसी और का लगता है।'), links: [L('/settings/organization', 'Org Profile', 'संगठन')] },
        { role: 'owner', t: T('GST number (Legal entity)', 'GST नंबर (लीगल एंटिटी)'), p: T('Jis naam aur GSTIN se bill banta hai, wo yahan. Branch isi se judti hai.', 'जिस नाम और GSTIN से बिल बनता है, वो यहाँ। ब्रांच इसी से जुड़ती है।'), why: T('Invoice par GST sahi lagne ke liye (same state = CGST + SGST, doosra state = IGST) Atlas ko aapka state aur GSTIN pata hona chahiye.', 'इनवॉइस पर GST सही लगने के लिए (एक ही राज्य = CGST + SGST, दूसरा राज्य = IGST) एटलस को आपका राज्य और GSTIN पता होना चाहिए।'), links: [L('/settings/legal-entities', 'Legal Entities', 'लीगल एंटिटी')] },
        { role: 'owner', t: T('Email aur WhatsApp', 'ईमेल और WhatsApp'), p: T('Kaun sa provider customer ko message bhejega, aur kis naam se.', 'कौन-सा प्रोवाइडर ग्राहक को मैसेज भेजेगा, और किस नाम से।'), links: [L('/settings/messaging', 'Email & WhatsApp', 'ईमेल और WhatsApp')] },
      ] },
      { k: 'steps', title: T('2. Paisa', '2. पैसा'), items: [
        { role: 'owner', t: T('Bank aur cash khata', 'बैंक और कैश खाता'), p: T('Har bank account aur cash ka ek khata. Receipt banate waqt yahi chuna jaata hai.', 'हर बैंक अकाउंट और कैश का एक खाता। रसीद बनाते समय यही चुना जाता है।'), demo: T('HDFC current account (UPI yahin aata hai) + Cash.', 'HDFC करंट अकाउंट (UPI यहीं आता है) + कैश।'), links: [L('/bank/accounts', 'Bank Accounts', 'बैंक अकाउंट')] },
        { role: 'owner', t: T('Opening balance', 'ओपनिंग बैलेंस'), p: T('Atlas shuru karne ke din kis customer ka kitna bakaya tha, kis supplier ko kitna dena tha, bank mein kitna tha.', 'एटलस शुरू करने के दिन किस ग्राहक का कितना बकाया था, किस सप्लायर को कितना देना था, बैंक में कितना था।'), why: T('Ye nahi bhara to purane customer ka bakaya zero dikhega aur paisa maangna mushkil hoga.', 'ये नहीं भरा तो पुराने ग्राहक का बकाया ज़ीरो दिखेगा और पैसा माँगना मुश्किल होगा।'), links: [L('/settings/opening-balance', 'Opening Balances', 'ओपनिंग बैलेंस')] },
      ] },
      { k: 'steps', title: T('3. Kya bechte ho', '3. क्या बेचते हैं'), items: [
        { role: 'owner', t: T('Parameters (unit, HSN, category)', 'पैरामीटर (यूनिट, HSN, कैटेगरी)'), p: T('Dropdown ki list: unit (Nos), category (Camera, DVR, Service), brand (CP PLUS), HSN code.', 'ड्रॉपडाउन की लिस्ट: यूनिट (Nos), कैटेगरी (Camera, DVR, Service), ब्रांड (CP PLUS), HSN कोड।'), links: [L('/settings/masters', 'Parameters', 'पैरामीटर')] },
        { role: 'owner', t: T('Product banao', 'प्रोडक्ट बनाएँ'), p: T('Har product: naam, bechne ka daam, kharid ka daam, GST %, reorder level. DVR jaisi cheez ke liye "Stock tracking by product" page par "By serial number" chuno.', 'हर प्रोडक्ट: नाम, बेचने का दाम, ख़रीद का दाम, GST %, रीऑर्डर लेवल। DVR जैसी चीज़ के लिए "Stock tracking by product" पेज पर "By serial number" चुनें।'), demo: T(`${DOME} ₹1,450, ${BULLET} ₹1,650, ${DVR} ₹3,200 (serial), ${EZY} ₹2,600, Installation charge ₹400 (service).`, `${DOME} ₹1,450, ${BULLET} ₹1,650, ${DVR} ₹3,200 (सीरियल), ${EZY} ₹2,600, इंस्टॉलेशन चार्ज ₹400 (सर्विस)।`), why: T('Kharid ka daam bharne se hi har bill ka faayda (margin) dikhta hai. Serial number se pata chalta hai kaunsa DVR kis customer ke yahan laga - warranty claim mein yahi kaam aata hai.', 'ख़रीद का दाम भरने से ही हर बिल का फ़ायदा (मार्जिन) दिखता है। सीरियल नंबर से पता चलता है कौन-सा DVR किस ग्राहक के यहाँ लगा - वारंटी क्लेम में यही काम आता है।'), links: [L('/products', 'Products', 'प्रोडक्ट'), L('/products/tracking', 'Stock tracking', 'स्टॉक ट्रैकिंग')] },
        { role: 'owner', t: T('Bahut saara data Excel se', 'बहुत सारा डेटा Excel से'), p: T('Customer, product aur stock ek saath Excel se laa sakte ho.', 'ग्राहक, प्रोडक्ट और स्टॉक एक साथ Excel से ला सकते हैं।'), links: [L('/import', 'Import Data', 'डेटा इम्पोर्ट')] },
      ] },
      { k: 'steps', title: T('4. Kaagaz aur niyam', '4. काग़ज़ और नियम'), items: [
        { role: 'owner', t: T('Document ka design', 'दस्तावेज़ का डिज़ाइन'), p: T('Quotation, invoice aur challan customer ko kaise dikhenge - logo, terms, bank details.', 'कोटेशन, इनवॉइस और चालान ग्राहक को कैसे दिखेंगे - लोगो, शर्तें, बैंक डिटेल।'), links: [L('/settings/documents', 'Document layouts', 'डॉक्यूमेंट लेआउट')] },
        { role: 'owner', t: T('Document number', 'डॉक्यूमेंट नंबर'), p: T('Number kaise banenge (jaise QT-BR001-2026-0007) aur agla kaunsa aayega.', 'नंबर कैसे बनेंगे (जैसे QT-BR001-2026-0007) और अगला कौन-सा आएगा।'), links: [L('/reports/document-numbers', 'Document Numbers', 'डॉक्यूमेंट नंबर')] },
        { role: 'owner', t: T('Complaint form ke field', 'शिकायत फ़ॉर्म के फ़ील्ड'), p: T('Custom Fields mein tay karo complaint par kya zaroori hai - jaise site ki GPS location.', 'Custom Fields में तय करें शिकायत पर क्या ज़रूरी है - जैसे साइट की GPS लोकेशन।'), why: T('GPS location zaroori hai to technician ka "Working on site" check kaam karta hai. Location hi nahi to Atlas jaanch nahi sakta ki wo sach mein wahan gaya.', 'GPS लोकेशन ज़रूरी है तो टेक्नीशियन का "Working on site" चेक काम करता है। लोकेशन ही नहीं तो एटलस जाँच नहीं सकता कि वो सच में वहाँ गया।'), links: [L('/settings/custom-fields', 'Custom Fields', 'कस्टम फ़ील्ड')] },
        { role: 'owner', shot: 'approval-rules', t: T('Approval ke niyam', 'मंज़ूरी के नियम'), p: T('Kaun kya approve karega, kis rakam se upar, aur phone kitni zor se bataye (Quiet / Normal / Urgent). Shuru mein "Balanced" chuno.', 'कौन क्या मंज़ूर करेगा, किस रकम से ऊपर, और फ़ोन कितनी ज़ोर से बताए (Quiet / Normal / Urgent)। शुरू में "Balanced" चुनें।'), demo: T('Parts challan → Sunil (store). Job band karna → Pooja. Quotation par 10% se zyada discount → Rajesh (maalik), Urgent.', 'पार्ट्स चालान → सुनील (स्टोर)। जॉब बंद करना → पूजा। कोटेशन पर 10% से ज़्यादा डिस्काउंट → राजेश (मालिक), Urgent।'), why: T('Bina niyam ke ya to sab kuch maalik tak aata hai (kaam rukta hai), ya kuch bhi nahi (paisa nikalta hai). Niyam se chhota kaam neeche hi ho jaata hai, bada kaam upar jaata hai.', 'बिना नियम के या तो सब कुछ मालिक तक आता है (काम रुकता है), या कुछ भी नहीं (पैसा निकलता है)। नियम से छोटा काम नीचे ही हो जाता है, बड़ा काम ऊपर जाता है।'), links: [L('/settings/approval-rules', 'Approval Rules', 'मंज़ूरी के नियम')] },
        { role: 'owner', shot: 'field-jobs', t: T('Field job ke niyam', 'फ़ील्ड जॉब के नियम'), p: T('Technician ke kaam ke niyam. Neeche table mein har setting ka standard (default) aur matlab.', 'टेक्नीशियन के काम के नियम। नीचे टेबल में हर सेटिंग का स्टैंडर्ड (डिफ़ॉल्ट) और मतलब।'), links: [L('/settings/field-jobs', 'Field jobs', 'फ़ील्ड जॉब')] },
      ] },
      { k: 'table', title: T('Field jobs: har setting ka matlab', 'फ़ील्ड जॉब: हर सेटिंग का मतलब'), head: [T('Setting', 'सेटिंग'), T('Standard', 'स्टैंडर्ड'), T('Matlab', 'मतलब')], rows: [
        [T('Location check', 'लोकेशन चेक'), T('Chalu, 50 metre', 'चालू, 50 मीटर'), T('"Working on site" tabhi dabta hai jab technician site se 50 m ke andar ho. Nakli GPS app chal raha ho to mana.', '"Working on site" तभी दबता है जब टेक्नीशियन साइट से 50 मीटर के अंदर हो। नकली GPS ऐप चल रहा हो तो मना।')],
        [T('Accept karne ka samay', 'स्वीकार करने का समय'), T('2 ghante', '2 घंटे'), T('Itne mein technician ne job accept nahi kiya to office ko pata chalta hai.', 'इतने में टेक्नीशियन ने जॉब स्वीकार नहीं किया तो ऑफ़िस को पता चलता है।')],
        [T('Customer ka code (OTP)', 'ग्राहक का कोड (OTP)'), T('Zaroori', 'ज़रूरी'), T('Work done ke baad customer ko 6 ank ka code jaata hai; technician wo daale tabhi kaam pakka.', 'काम पूरा होने के बाद ग्राहक को 6 अंकों का कोड जाता है; टेक्नीशियन वो डाले तभी काम पक्का।')],
        [T('Band karne ke liye approval', 'बंद करने के लिए मंज़ूरी'), T('Chalu', 'चालू'), T('Kaam ho gaya ke baad manager job band karta hai (My Desk mein aata hai).', 'काम होने के बाद मैनेजर जॉब बंद करता है (My Desk में आता है)।')],
        [T('Code se apne aap band', 'कोड से अपने आप बंद'), T('Chalu', 'चालू'), T('Customer ne khud code ya "Yes" se pakka kiya to job apne aap band - manager ko kuch nahi karna.', 'ग्राहक ने ख़ुद कोड या "Yes" से पक्का किया तो जॉब अपने आप बंद - मैनेजर को कुछ नहीं करना।')],
        [T('GDN apne aap', 'GDN अपने आप'), T('Chalu', 'चालू'), T('Parts challan approve hote hi GDN banta hai aur stock ghatta hai (stock kam ho to store ke paas rukta hai).', 'पार्ट्स चालान मंज़ूर होते ही GDN बनता है और स्टॉक घटता है (स्टॉक कम हो तो स्टोर के पास रुकता है)।')],
        [T('Dobara kholna', 'दोबारा खोलना'), T('7 din', '7 दिन'), T('Band job ko customer itne din tak dobara khol sakta hai.', 'बंद जॉब को ग्राहक इतने दिन तक दोबारा खोल सकता है।')],
        [T('Visit charge', 'विज़िट चार्ज'), T('₹0 (demo: ₹300)', '₹0 (डेमो: ₹300)'), T('Bina estimate wale job ke bill mein judta hai.', 'बिना एस्टिमेट वाले जॉब के बिल में जुड़ता है।')],
        [T('Samay seema (SLA)', 'समय सीमा (SLA)'), T('Normal: accept 4 ghante, visit 24, band 72', 'Normal: स्वीकार 4 घंटे, विज़िट 24, बंद 72'), T('Urgent: 1 / 4 / 24 ghante. Seema chhooti to list mein laal dikhta hai.', 'Urgent: 1 / 4 / 24 घंटे। सीमा छूटी तो लिस्ट में लाल दिखता है।')],
        [T('Photo', 'फ़ोटो'), T('Marzi (optional)', 'मर्ज़ी (ऑप्शनल)'), T('"Zaroori" karo to bina photo work done nahi hota.', '"ज़रूरी" करें तो बिना फ़ोटो काम पूरा नहीं होता।')],
      ] },
      { k: 'steps', title: T('5. Log', '5. लोग'), items: [
        { role: 'owner', t: T('Role', 'रोल'), p: T('Har role kya dekh aur kar sakta hai - website aur phone app dono ke liye. Technician aam taur par sirf apna kaam dekhta hai, manager poori branch.', 'हर रोल क्या देख और कर सकता है - वेबसाइट और फ़ोन ऐप दोनों के लिए। टेक्नीशियन आम तौर पर सिर्फ़ अपना काम देखता है, मैनेजर पूरी ब्रांच।'), why: T('Role mein "daam chhupao" ya "customer ka phone chhupao" chuno to wo cheez phone par aati hi nahi - server se hi hat jaati hai.', 'रोल में "दाम छिपाएँ" या "ग्राहक का फ़ोन छिपाएँ" चुनें तो वो चीज़ फ़ोन पर आती ही नहीं - सर्वर से ही हट जाती है।'), links: [L('/settings/roles', 'Roles', 'रोल')] },
        { role: 'owner', t: T('User banao', 'यूज़र बनाएँ'), p: T('Har vyakti ka login, aur har branch mein uska role. Branch mein role nahi to wo branch dikhegi hi nahi.', 'हर व्यक्ति का लॉगिन, और हर ब्रांच में उसका रोल। ब्रांच में रोल नहीं तो वो ब्रांच दिखेगी ही नहीं।'), demo: T('Saaton log: Pooja (Manager), Amit (Sales), Sunil (Store), Ravi aur Imran (Technician), Neha (Accounts).', 'सातों लोग: पूजा (मैनेजर), अमित (सेल्स), सुनील (स्टोर), रवि और इमरान (टेक्नीशियन), नेहा (अकाउंट्स)।'), links: [L('/settings/users', 'Users', 'यूज़र'), L('/settings/user-store-roles', 'User store roles', 'यूज़र ब्रांच रोल')] },
        { role: 'owner', t: T('Kaun kisko report karta hai', 'कौन किसको रिपोर्ट करता है'), p: T('Chhutti, WFH aur claim isi line par upar approval ke liye jaate hain.', 'छुट्टी, WFH और क्लेम इसी लाइन पर ऊपर मंज़ूरी के लिए जाते हैं।'), demo: T('Ravi, Imran, Sunil → Pooja → Rajesh.', 'रवि, इमरान, सुनील → पूजा → राजेश।'), links: [L('/hierarchy/team-setup', 'Team Setup', 'टीम सेटअप')] },
      ] },
      { k: 'steps', title: T('6. Attendance', '6. अटेंडेंस'), items: [
        { role: 'owner', t: T('Shift aur chhutti', 'शिफ़्ट और छुट्टी'), p: T('Kaam ka samay, hafte ki chhutti, tyohaar - branch ke hisaab se.', 'काम का समय, हफ़्ते की छुट्टी, त्योहार - ब्रांच के हिसाब से।'), demo: T('Subah 9:30 se shaam 7, Ravivaar band.', 'सुबह 9:30 से शाम 7, रविवार बंद।'), links: [L('/settings/attendance', 'Time Policies', 'टाइम पॉलिसी')] },
        { role: 'owner', t: T('Clock in kahan se', 'क्लॉक इन कहाँ से'), p: T('Office wale office ke ghere (geofence) mein hi clock in karein; technician shift par kahin se bhi.', 'ऑफ़िस वाले ऑफ़िस के घेरे (जियोफ़ेंस) में ही क्लॉक इन करें; टेक्नीशियन शिफ़्ट पर कहीं से भी।'), links: [L('/settings/attendance/clock-in-rules', 'Clock-in Rules', 'क्लॉक-इन नियम')] },
        { role: 'owner', t: T('Biometric machine', 'बायोमेट्रिक मशीन'), p: T('Office mein thumb machine ho to yahan jodo. Phone aur machine dono ek hi din mein gine jaate hain.', 'ऑफ़िस में अंगूठे वाली मशीन हो तो यहाँ जोड़ें। फ़ोन और मशीन दोनों एक ही दिन में गिने जाते हैं।'), links: [L('/settings/attendance/devices', 'Attendance Devices', 'अटेंडेंस डिवाइस')] },
      ] },
      { k: 'steps', title: T('7. Phone', '7. फ़ोन'), items: [
        { role: 'owner', t: T('Vcare install + pair', 'Vcare इंस्टॉल + पेयर'), p: T('Har technician ke phone par app daalo, phir "Pair a phone" se code do. Staff sirf apne pair kiye phone par login kar sakta hai.', 'हर टेक्नीशियन के फ़ोन पर ऐप डालें, फिर "Pair a phone" से कोड दें। स्टाफ़ सिर्फ़ अपने पेयर किए फ़ोन पर लॉगिन कर सकता है।'), why: T('Pair karne se doosra koi uske naam se clock in nahi kar sakta, aur phone kho jaaye to yahin se band kar do.', 'पेयर करने से दूसरा कोई उसके नाम से क्लॉक इन नहीं कर सकता, और फ़ोन खो जाए तो यहीं से बंद कर दें।'), links: [L('/settings/call-devices', 'Phones', 'फ़ोन')] },
        { role: 'tech', t: T('Phone par "Set up this phone"', 'फ़ोन पर "Set up this phone"'), p: T('Location, notification, call log aur "full-screen alerts" ki permission do - taaki Urgent job call ki tarah baje.', 'लोकेशन, नोटिफ़िकेशन, कॉल लॉग और "full-screen alerts" की परमिशन दें - ताकि Urgent जॉब कॉल की तरह बजे।'), phone: true },
      ] },
      { k: 'steps', title: T('8. Customisation: kaun kya karega', '8. कस्टमाइज़ेशन: कौन क्या करेगा'), items: [
        { role: 'owner', shot: 'customisation', t: T('Who does what', 'Who does what'), p: T('Settings › Customisation › "Who does what". Har step ko band kar sakte ho, par Atlas poochhega: phir kaam kaun karega? Neeche table dekho.', 'Settings › Customisation › "Who does what"। हर कदम को बंद कर सकते हैं, पर एटलस पूछेगा: फिर काम कौन करेगा? नीचे टेबल देखें।'), why: T('Step band karne se kaam gayab nahi hota - ya to kisi aur ke paas jaata hai, ya sach mein chhoot jaata hai. Jo step ke bina job khatam hi nahi ho sakta, wo band nahi hota.', 'कदम बंद करने से काम ग़ायब नहीं होता - या तो किसी और के पास जाता है, या सच में छूट जाता है। जिस कदम के बिना जॉब ख़त्म ही नहीं हो सकता, वो बंद नहीं होता।'), links: [L('/settings/customisation', 'Customisation', 'कस्टमाइज़ेशन')] },
      ] },
      { k: 'table', title: T('"Who does what": band karne par kya hota hai', '"Who does what": बंद करने पर क्या होता है'), head: [T('Step', 'कदम'), T('Band karne par', 'बंद करने पर')], rows: [
        [T('Technician accept / decline kare', 'टेक्नीशियन स्वीकार / मना करे'), T('Skip: office ne diya to job apne aap accept', 'Skip: ऑफ़िस ने दिया तो जॉब अपने आप स्वीकार')],
        [T('Technician visit book kare', 'टेक्नीशियन विज़िट बुक करे'), T('Koi aur: office har visit ka samay rakhta hai', 'कोई और: ऑफ़िस हर विज़िट का समय रखता है')],
        [T('"On the way"', '"On the way"'), T('Skip: seedha "Working on site"', 'Skip: सीधा "Working on site"')],
        [T('"Working on site" (GPS check)', '"Working on site" (GPS चेक)'), T('Skip: na location check, na site par samay. Sirf wahan band karo jahan GPS sach mein nahi chalta.', 'Skip: न लोकेशन चेक, न साइट पर समय। सिर्फ़ वहाँ बंद करें जहाँ GPS सच में नहीं चलता।')],
        [T('Technician parts challan banaye', 'टेक्नीशियन पार्ट्स चालान बनाए'), T('Koi aur: technician "parts chahiye" bolta hai, store challan banata hai. Skip nahi - parts ka hisaab zaroori.', 'कोई और: टेक्नीशियन "पार्ट्स चाहिए" बोलता है, स्टोर चालान बनाता है। Skip नहीं - पार्ट्स का हिसाब ज़रूरी।')],
        [T('Customer ko estimate', 'ग्राहक को एस्टिमेट'), T('Skip: bina daam ki haan ke kaam (AMC wale customer ke liye)', 'Skip: बिना दाम की हाँ के काम (AMC वाले ग्राहक के लिए)')],
        [T('Technician work done kare', 'टेक्नीशियन काम पूरा करे'), T('Koi aur: office karta hai. Skip kabhi nahi.', 'कोई और: ऑफ़िस करता है। Skip कभी नहीं।')],
        [T('Customer pakka kare', 'ग्राहक पक्का करे'), T('Skip ya Koi aur (office customer ki taraf se)', 'Skip या कोई और (ऑफ़िस ग्राहक की तरफ़ से)')],
        [T('Manager job band kare', 'मैनेजर जॉब बंद करे'), T('Band nahi ho sakta - koi to job ko "Closed" karega', 'बंद नहीं हो सकता - कोई तो जॉब को "Closed" करेगा')],
      ] },
      { k: 'note', tone: 'tip', text: T(
        'Customer ka record banate waqt uski site ki GPS location (ya Google Maps link) zaroor daalo. Demo: Green Valley Society ka gate, Sharma Medical ki dukaan.',
        'ग्राहक का रिकॉर्ड बनाते समय उसकी साइट की GPS लोकेशन (या Google Maps लिंक) ज़रूर डालें। डेमो: ग्रीन वैली सोसाइटी का गेट, शर्मा मेडिकल की दुकान।',
      ) },
    ],
  },

  // ================================================================ flows
  {
    id: 'job-life', level: 'field', part: P.flows,
    title: T('Job ka lifecycle (complaint, repair, installation - sab ek jaisa)', 'जॉब का लाइफ़साइकल (शिकायत, रिपेयर, इंस्टॉलेशन - सब एक जैसा)'),
    purpose: T(
      'Har field job inhi status se guzarta hai. Atlas sirf yahi raaste kholta hai - koi status ko kuch bhi nahi bana sakta.',
      'हर फ़ील्ड जॉब इन्हीं स्टेटस से गुज़रता है। एटलस सिर्फ़ यही रास्ते खोलता है - कोई स्टेटस को कुछ भी नहीं बना सकता।',
    ),
    blocks: [
      { k: 'states', title: T('Status ek ke baad ek', 'स्टेटस एक के बाद एक'), states: [
        { code: 'received', t: T('New', 'नया'), who: T('Office ne darj kiya', 'ऑफ़िस ने दर्ज किया'), tone: 'new' },
        { code: 'assigned', t: T('Waiting for technician', 'टेक्नीशियन का इंतज़ार'), who: T('Office ne diya', 'ऑफ़िस ने दिया'), tone: 'new' },
        { code: 'accepted', t: T('Accepted', 'स्वीकार'), who: T('Technician', 'टेक्नीशियन'), tone: 'work' },
        { code: 'scheduled', t: T('Visit booked', 'विज़िट बुक'), who: T('Technician / Office', 'टेक्नीशियन / ऑफ़िस'), tone: 'work' },
        { code: 'on_the_way', t: T('On the way', 'रास्ते में'), who: T('Technician', 'टेक्नीशियन'), tone: 'work' },
        { code: 'on_site', t: T('Working on site', 'साइट पर काम'), who: T('Technician (GPS)', 'टेक्नीशियन (GPS)'), tone: 'work' },
        { code: 'awaiting_estimate', t: T('Waiting for estimate approval', 'एस्टिमेट की हाँ का इंतज़ार'), who: T('Customer', 'ग्राहक'), tone: 'wait' },
        { code: 'awaiting_customer', t: T('Waiting for customer confirmation', 'ग्राहक की पुष्टि का इंतज़ार'), who: T('Customer (code)', 'ग्राहक (कोड)'), tone: 'wait' },
        { code: 'resolved', t: T('Waiting to close', 'बंद होने का इंतज़ार'), who: T('Manager', 'मैनेजर'), tone: 'done' },
        { code: 'closed', t: T('Closed', 'बंद'), who: T('Manager / apne aap', 'मैनेजर / अपने आप'), tone: 'end' },
      ], side: [
        T('Technician mana kare (Decline) → wapas "New", office kisi aur ko deta hai.', 'टेक्नीशियन मना करे (Decline) → वापस "नया", ऑफ़िस किसी और को देता है।'),
        T('Site chhod ke parts lene gaya ("Leave site") → "In progress"; wapas aakar phir "Working on site".', 'साइट छोड़कर पार्ट्स लेने गया ("Leave site") → "In progress"; वापस आकर फिर "Working on site"।'),
        T('Customer ne estimate mana kiya → bina us kaam ke kaam khatam karte hain.', 'ग्राहक ने एस्टिमेट मना किया → बिना उस काम के काम ख़त्म करते हैं।'),
        T('Customer bole "theek nahi hua" → wapas "In progress".', 'ग्राहक बोले "ठीक नहीं हुआ" → वापस "In progress"।'),
        T('Manager wapas bheje (Send back) → "In progress", kaaran ke saath.', 'मैनेजर वापस भेजे (Send back) → "In progress", कारण के साथ।'),
        T('Band job 7 din tak dobara khul sakta hai (Reopen).', 'बंद जॉब 7 दिन तक दोबारा खुल सकता है (Reopen)।'),
        T('Office kisi bhi khule job ko Cancel kar sakta hai - kaaran ke saath.', 'ऑफ़िस किसी भी खुले जॉब को कैंसल कर सकता है - कारण के साथ।'),
      ] },
      { k: 'table', title: T('Customer ko kya dikhta hai', 'ग्राहक को क्या दिखता है'), head: [T('Andar ka status', 'अंदर का स्टेटस'), T('Customer ko', 'ग्राहक को')], rows: [
        [T('New / Waiting for technician', 'नया / टेक्नीशियन का इंतज़ार'), 'Received'],
        [T('Accepted', 'स्वीकार'), 'Technician assigned'],
        [T('On the way / Working on site', 'रास्ते में / साइट पर काम'), 'Technician on the way / working on site'],
        [T('Waiting for estimate approval', 'एस्टिमेट की हाँ का इंतज़ार'), 'Please approve the estimate'],
        [T('Waiting for customer confirmation', 'ग्राहक की पुष्टि का इंतज़ार'), 'Please confirm it is resolved'],
        [T('Waiting to close', 'बंद होने का इंतज़ार'), 'Resolved - thank you'],
      ] },
      { k: 'why', text: T(
        'Customer ko sirf mile ke patthar (milestone) dikhte hain - challan, kharcha aur andar ke note kabhi nahi. Isliye customer link bina dar ke bheja ja sakta hai.',
        'ग्राहक को सिर्फ़ मील के पत्थर (माइलस्टोन) दिखते हैं - चालान, ख़र्चा और अंदर के नोट कभी नहीं। इसलिए ग्राहक लिंक बिना डर के भेजा जा सकता है।',
      ) },
      { k: 'note', tone: 'tip', text: T(
        'Status ke naam apni bhasha mein badal sakte ho (Field jobs settings) - code wahi rehta hai, isliye purani report kharab nahi hoti.',
        'स्टेटस के नाम अपनी भाषा में बदल सकते हैं (Field jobs settings) - कोड वही रहता है, इसलिए पुरानी रिपोर्ट ख़राब नहीं होती।',
      ) },
    ],
  },
  {
    id: 'install', level: 'field', part: P.flows,
    title: T('Installation: Lead se paise tak', 'इंस्टॉलेशन: लीड से पैसे तक'),
    purpose: T(
      'Green Valley Society ko 4 camera ka system. Har step, kaun karta hai, aur kyun.',
      'ग्रीन वैली सोसाइटी को 4 कैमरों का सिस्टम। हर कदम, कौन करता है, और क्यों।',
    ),
    blocks: [
      { k: 'flow', title: T('Installation ki zanjeer', 'इंस्टॉलेशन की ज़ंजीर'), nodes: [
        { role: 'sales', t: T('Lead', 'लीड') },
        { role: 'sales', t: T('Quotation', 'कोटेशन'), sub: T('QT-0041', 'QT-0041') },
        { role: 'sales', t: T('Sales order', 'सेल्स ऑर्डर'), sub: T('SO-0019', 'SO-0019') },
        { role: 'office', t: T('Installation job', 'इंस्टॉलेशन जॉब'), sub: T('CMP-0112', 'CMP-0112') },
        { role: 'office', t: T('Installation challan', 'इंस्टॉलेशन चालान') },
        { role: 'store', t: T('Approve → GDN', 'मंज़ूर → GDN'), sub: T('DVR ka serial chuna', 'DVR का सीरियल चुना') },
        { role: 'tech', t: T('Site par lagaya', 'साइट पर लगाया'), sub: T('GPS check', 'GPS चेक') },
        { role: 'customer', t: T('Code', 'कोड') },
        { role: 'accounts', t: T('Invoice', 'इनवॉइस'), sub: T('INV-0088', 'INV-0088') },
        { role: 'accounts', t: T('Receipt', 'रसीद') },
      ], foot: T('Number chhote likhe hain - asli number QT-BR001-2026-0041 jaisa hota hai.', 'नंबर छोटे लिखे हैं - असली नंबर QT-BR001-2026-0041 जैसा होता है।') },
      { k: 'steps', items: [
        { role: 'sales', shot: 'leads', t: T('Lead darj karo', 'लीड दर्ज करें'), p: T('Kaun hai, kya chahiye, agla follow-up kab.', 'कौन है, क्या चाहिए, अगला फ़ॉलो-अप कब।'), demo: T('Green Valley Society, Kulkarni ji: "gate aur parking par camera chahiye". Follow-up: kal 10 baje.', 'ग्रीन वैली सोसाइटी, कुलकर्णी जी: "गेट और पार्किंग पर कैमरा चाहिए"। फ़ॉलो-अप: कल 10 बजे।'), why: T('Lead mein follow-up ki tareekh hi yaad dilati hai - warna poochhtaachh bhool jaate hain aur customer kisi aur se le leta hai.', 'लीड में फ़ॉलो-अप की तारीख़ ही याद दिलाती है - वरना पूछताछ भूल जाते हैं और ग्राहक किसी और से ले लेता है।'), links: [L('/crm/leads', 'Leads', 'लीड्स')] },
        { role: 'sales', shot: 'quotation', t: T('Quotation banao', 'कोटेशन बनाएँ'), p: T('Lead kholo → "Quotation" button → quotation banao (customer aur product chuno - daam price list se aata hai). Salesperson mein apna naam.', 'लीड खोलें → "Quotation" बटन → कोटेशन बनाएँ (ग्राहक और प्रोडक्ट चुनें - दाम प्राइस लिस्ट से आता है)। Salesperson में अपना नाम।'), demo: T(`3 × ${BULLET} (₹4,950) + 1 × ${DOME} (₹1,450) + 1 × ${DVR} (₹3,200) + 4 × Installation (₹1,600) = ₹11,200 + GST 18% (₹2,016) = ₹13,216.`, `3 × ${BULLET} (₹4,950) + 1 × ${DOME} (₹1,450) + 1 × ${DVR} (₹3,200) + 4 × इंस्टॉलेशन (₹1,600) = ₹11,200 + GST 18% (₹2,016) = ₹13,216।`), why: T('Quotation se stock reserve nahi hota - do log aakhri piece quote kar sakte hain. Discount 10% se zyada ho to maalik ki approval lagti hai (demo niyam).', 'कोटेशन से स्टॉक रिज़र्व नहीं होता - दो लोग आख़िरी पीस कोट कर सकते हैं। डिस्काउंट 10% से ज़्यादा हो तो मालिक की मंज़ूरी लगती है (डेमो नियम)।'), links: [L('/quotation', 'Quotations', 'कोटेशन')] },
        { role: 'sales', t: T('WhatsApp par bhejo', 'WhatsApp पर भेजें'), p: T('Quotation ka link customer ko WhatsApp par. Link par aapka logo aur poora quotation dikhta hai, print bhi ho jaata hai.', 'कोटेशन का लिंक ग्राहक को WhatsApp पर। लिंक पर आपका लोगो और पूरा कोटेशन दिखता है, प्रिंट भी हो जाता है।'), links: [L('/quotation', 'Quotations', 'कोटेशन')] },
        { role: 'sales', t: T('Customer ne haan kaha → Sales order', 'ग्राहक ने हाँ कहा → सेल्स ऑर्डर'), p: T('Quotation par "Convert to Order" → Sales order ban jaata hai, lines aur daam copy hote hain. Dobara type mat karo.', 'कोटेशन पर "Convert to Order" → सेल्स ऑर्डर बन जाता है, लाइनें और दाम कॉपी होते हैं। दोबारा टाइप मत करें।'), why: T('Aise banane se quotation, order, invoice aapas mein jude rehte hain - baad mein ek click mein pura itihaas dikhta hai.', 'ऐसे बनाने से कोटेशन, ऑर्डर, इनवॉइस आपस में जुड़े रहते हैं - बाद में एक क्लिक में पूरा इतिहास दिखता है।'), links: [L('/sales/orders', 'Sales Orders', 'सेल्स ऑर्डर')] },
        { role: 'office', shot: 'sales-orders', t: T('Order se installation job', 'ऑर्डर से इंस्टॉलेशन जॉब'), p: T('Sales Orders list mein order ki line ka menu → "Create installation job". Site chuno (ya location do), priority, note → "Create job". Phir job page par technician chuno.', 'सेल्स ऑर्डर लिस्ट में ऑर्डर की लाइन का मेन्यू → "Create installation job"। साइट चुनें (या लोकेशन दें), प्रायोरिटी, नोट → "Create job"। फिर जॉब पेज पर टेक्नीशियन चुनें।'), demo: T('Site: Green Valley gate. Technician: Ravi. Priority: Normal.', 'साइट: ग्रीन वैली गेट। टेक्नीशियन: रवि। प्रायोरिटी: Normal।'), why: T('Installation bhi complaint jaisa hi job hai - wahi GPS check, wahi customer code, wahi report. Ek order par ek hi khula installation job.', 'इंस्टॉलेशन भी शिकायत जैसा ही जॉब है - वही GPS चेक, वही ग्राहक कोड, वही रिपोर्ट। एक ऑर्डर पर एक ही खुला इंस्टॉलेशन जॉब।'), links: [L('/sales/orders', 'Sales Orders', 'सेल्स ऑर्डर'), L('/services/complaints', 'Jobs', 'जॉब')] },
        { role: 'tech', t: T('Accept + Book visit', 'स्वीकार + विज़िट बुक'), p: T('Phone par job aata hai → "Accept job" → "Book a visit" (tareekh, samay). Customer ko samay dikh jaata hai.', 'फ़ोन पर जॉब आता है → "Accept job" → "Book a visit" (तारीख़, समय)। ग्राहक को समय दिख जाता है।'), demo: T('Ravi: aaj 2 baje.', 'रवि: आज 2 बजे।'), phone: true },
        { role: 'office', t: T('Parts ka challan (nikalne se pehle)', 'पार्ट्स का चालान (निकलने से पहले)'), p: T('Installation ke parts pehle se pata hain, isliye office job page par "Raise challan" karta hai - part, qty → "Send for approval". Technician khud bhi bana sakta hai, par sirf "Working on site" ke dauraan.', 'इंस्टॉलेशन के पार्ट्स पहले से पता हैं, इसलिए ऑफ़िस जॉब पेज पर "Raise challan" करता है - पार्ट, मात्रा → "Send for approval"। टेक्नीशियन ख़ुद भी बना सकता है, पर सिर्फ़ "Working on site" के दौरान।'), demo: T('3 Bullet, 1 Dome, 1 DVR 4 channel.', '3 बुलेट, 1 डोम, 1 DVR 4 चैनल।'), why: T('Technician site par pahunch kar challan banaye to parts lene wapas aana padta hai. Pehle se challan = ek hi chakkar.', 'टेक्नीशियन साइट पर पहुँचकर चालान बनाए तो पार्ट्स लेने वापस आना पड़ता है। पहले से चालान = एक ही चक्कर।'), links: [L('/services/complaints', 'Jobs', 'जॉब')] },
        { role: 'store', shot: 'job-parts', t: T('Challan approve → GDN', 'चालान मंज़ूर → GDN'), p: T('Approve: My Desk → Waiting on me (jiska naam Approval Rules mein hai). Aam maal ka GDN approve hote hi apne aap banta hai. Is challan mein DVR (serial wala) hai, isliye "Parts counter" page par DVR ka serial chuno aur issue karo - tab GDN banta hai, stock ghatta hai. Phir maal Ravi ko do.', 'मंज़ूरी: My Desk → Waiting on me (जिसका नाम Approval Rules में है)। आम माल का GDN मंज़ूर होते ही अपने आप बनता है। इस चालान में DVR (सीरियल वाला) है, इसलिए "Parts counter" पेज पर DVR का सीरियल चुनें और issue करें - तब GDN बनता है, स्टॉक घटता है। फिर माल रवि को दें।'), why: T('Bina challan ke maal dena = stock ka hisaab gayab. GDN par kharcha (cost) bhi us job par chadh jaata hai, isliye job ka asli faayda dikhta hai. Serial wala maal kaunsa piece gaya, ye store hi chun sakta hai - isliye wo apne aap nahi jaata.', 'बिना चालान के माल देना = स्टॉक का हिसाब ग़ायब। GDN पर ख़र्चा (कॉस्ट) भी उस जॉब पर चढ़ जाता है, इसलिए जॉब का असली फ़ायदा दिखता है। सीरियल वाले माल में कौन-सा पीस गया, ये स्टोर ही चुन सकता है - इसलिए वो अपने आप नहीं जाता।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क'), L('/goods-dispatch/job-parts', 'Parts counter', 'पार्ट्स काउंटर')] },
        { role: 'tech', t: T('On my way → Working on site', 'On my way → Working on site'), p: T('Nikalte waqt "On my way". Site par pahunch kar "Working on site" - 50 m ke andar hi dabega.', 'निकलते समय "On my way"। साइट पर पहुँचकर "Working on site" - 50 मीटर के अंदर ही दबेगा।'), why: T('GPS check se pata chalta hai technician sach mein gaya, aur site par kitna samay laga - yahi Technician Performance mein aata hai.', 'GPS चेक से पता चलता है टेक्नीशियन सच में गया, और साइट पर कितना समय लगा - यही टेक्नीशियन परफ़ॉर्मेंस में आता है।'), phone: true },
        { role: 'tech', t: T('Work done + photo', 'काम पूरा + फ़ोटो'), p: T('"Work done" → kya kiya likho, photo lo. Customer ko 6 ank ka code jaata hai (app / portal / link / email).', '"Work done" → क्या किया लिखें, फ़ोटो लें। ग्राहक को 6 अंकों का कोड जाता है (ऐप / पोर्टल / लिंक / ईमेल)।'), demo: T('"4 camera lage, DVR par 30 din recording set, mobile app chalu karke dikhaya."', '"4 कैमरे लगे, DVR पर 30 दिन रिकॉर्डिंग सेट, मोबाइल ऐप चालू करके दिखाया।"'), phone: true },
        { role: 'customer', t: T('Customer code batata hai', 'ग्राहक कोड बताता है'), p: T('Technician "Confirm with code" mein code daalta hai → job "Waiting to close" → code se pakka hua to apne aap Closed.', 'टेक्नीशियन "Confirm with code" में कोड डालता है → जॉब "बंद होने का इंतज़ार" → कोड से पक्का हुआ तो अपने आप बंद।'), why: T('Code ka matlab customer ne khud maana ki kaam ho gaya - baad mein "koi aaya hi nahi" wala jhagda nahi hota.', 'कोड का मतलब ग्राहक ने ख़ुद माना कि काम हो गया - बाद में "कोई आया ही नहीं" वाला झगड़ा नहीं होता।') },
        { role: 'accounts', shot: 'invoices', t: T('Order se invoice', 'ऑर्डर से इनवॉइस'), p: T('Sales order par "Raise invoice" → invoice → Issue. Customer ko WhatsApp par invoice ka link.', 'सेल्स ऑर्डर पर "Raise invoice" → इनवॉइस → Issue। ग्राहक को WhatsApp पर इनवॉइस का लिंक।'), demo: T('INV-0088: ₹13,216.', 'INV-0088: ₹13,216।'), why: T('Issue karte hi GST aur bakaya account mein chadhte hain. Issue ke baad badalna ho to kaaran likhna padta hai (revision).', 'Issue करते ही GST और बकाया अकाउंट में चढ़ते हैं। Issue के बाद बदलना हो तो कारण लिखना पड़ता है (रिविज़न)।'), links: [L('/invoices', 'Invoices', 'इनवॉइस')] },
        { role: 'accounts', shot: 'receipts', t: T('Paisa aaya: receipt', 'पैसा आया: रसीद'), p: T('Receipt → customer → rakam → bank/cash → kis invoice par lagana hai (allocate).', 'रसीद → ग्राहक → रकम → बैंक/कैश → किस इनवॉइस पर लगाना है (allocate)।'), demo: T('₹8,000 UPI (HDFC) INV-0088 par. Bakaya ₹5,216 customer ke khate mein dikhta hai.', '₹8,000 UPI (HDFC) INV-0088 पर। बकाया ₹5,216 ग्राहक के खाते में दिखता है।'), why: T('Allocate na karo to paisa "advance" ban kar pada rehta hai aur invoice bakaya dikhata rehta hai.', 'Allocate न करें तो पैसा "एडवांस" बनकर पड़ा रहता है और इनवॉइस बकाया दिखाता रहता है।'), links: [L('/receipts', 'Receipts', 'रसीदें')] },
      ] },
    ],
  },
  {
    id: 'complaint', level: 'field', part: P.flows,
    title: T('Complaint: kharab camera se paise tak', 'शिकायत: ख़राब कैमरे से पैसे तक'),
    purpose: T(
      'Sharma Medical ka EzyKam band hai (warranty mein). Saath mein ek naya dome lagwana hai - jiska paisa lagega.',
      'शर्मा मेडिकल का EzyKam बंद है (वारंटी में)। साथ में एक नया डोम लगवाना है - जिसका पैसा लगेगा।',
    ),
    blocks: [
      { k: 'flow', title: T('Complaint ki zanjeer', 'शिकायत की ज़ंजीर'), nodes: [
        { role: 'office', t: T('Complaint', 'शिकायत'), sub: T('CMP-0113', 'CMP-0113') },
        { role: 'office', t: T('Imran ko diya', 'इमरान को दिया') },
        { role: 'tech', t: T('Accept, visit', 'स्वीकार, विज़िट') },
        { role: 'tech', t: T('Working on site', 'साइट पर काम') },
        { role: 'tech', t: T('Challan + kharab part', 'चालान + ख़राब पार्ट') },
        { role: 'store', t: T('Approve → GDN', 'मंज़ूर → GDN') },
        { role: 'office', t: T('Estimate', 'एस्टिमेट') },
        { role: 'customer', t: T('Haan', 'हाँ') },
        { role: 'tech', t: T('Work done', 'काम पूरा') },
        { role: 'customer', t: T('Code', 'कोड') },
        { role: 'office', t: T('Bill this job', 'Bill this job') },
        { role: 'accounts', t: T('Receipt', 'रसीद') },
      ] },
      { k: 'steps', items: [
        { role: 'office', shot: 'complaints', t: T('Complaint darj karo', 'शिकायत दर्ज करें'), p: T('"Raise complaint" → customer ke 2-3 akshar likh kar chuno → product → problem → site location (GPS ya Google Maps link) → priority.', '"Raise complaint" → ग्राहक के 2-3 अक्षर लिखकर चुनें → प्रोडक्ट → समस्या → साइट लोकेशन (GPS या Google Maps लिंक) → प्रायोरिटी।'), demo: T(`Sharma Medical Store, ${EZY}, "camera offline hai, app par video nahi aa raha". Priority: High.`, `शर्मा मेडिकल स्टोर, ${EZY}, "कैमरा ऑफ़लाइन है, ऐप पर वीडियो नहीं आ रहा"। प्रायोरिटी: High।`), why: T('Priority se samay seema (SLA) tay hoti hai - High par accept 2 ghante, visit 8, band 48. Customer khud bhi portal ya app se complaint daal sakta hai.', 'प्रायोरिटी से समय सीमा (SLA) तय होती है - High पर स्वीकार 2 घंटे, विज़िट 8, बंद 48। ग्राहक ख़ुद भी पोर्टल या ऐप से शिकायत डाल सकता है।'), links: [L('/services/complaints', 'Customer Complaints', 'कस्टमर कंप्लेंट्स')] },
        { role: 'office', shot: 'complaint-detail', t: T('Technician ko do', 'टेक्नीशियन को दें'), p: T('Complaint page par technician chuno. Uske phone par turant aata hai (Urgent ho to call ki tarah bajta hai).', 'शिकायत पेज पर टेक्नीशियन चुनें। उसके फ़ोन पर तुरंत आता है (Urgent हो तो कॉल की तरह बजता है)।'), demo: T('Imran.', 'इमरान।'), links: [L('/services/board', 'Job Board', 'जॉब बोर्ड')] },
        { role: 'tech', t: T('Accept → Book visit → On my way', 'स्वीकार → विज़िट बुक → On my way'), p: T('"Accept job" (nahi kar sakte to "Decline job" + kaaran). Phir visit ka samay, nikalte waqt "On my way".', '"Accept job" (नहीं कर सकते तो "Decline job" + कारण)। फिर विज़िट का समय, निकलते समय "On my way"।'), phone: true },
        { role: 'tech', t: T('Working on site', 'Working on site'), p: T('Dukaan par pahunch kar dabao. Basement mein GPS nahi mil raha to "Ask manager for an override" - manager haan kare tab shuru.', 'दुकान पर पहुँचकर दबाएँ। बेसमेंट में GPS नहीं मिल रहा तो "Ask manager for an override" - मैनेजर हाँ करे तब शुरू।'), phone: true },
        { role: 'tech', t: T('Naya part maango + kharab part darj karo', 'नया पार्ट माँगें + ख़राब पार्ट दर्ज करें'), p: T('Parts → "Raise challan" → naya EzyKam (replacement) aur naya Dome → "Send for approval". "Log faulty part" mein purane EzyKam ka serial.', 'Parts → "Raise challan" → नया EzyKam (रिप्लेसमेंट) और नया डोम → "Send for approval"। "Log faulty part" में पुराने EzyKam का सीरियल।'), why: T('Challan sirf "Working on site" ke dauraan ban sakta hai - taaki parts asli kaam ke liye hi niklein. Kharab part darj karne se wo store mein wapas aata hai aur company (CP Plus) ko warranty mein bheja ja sakta hai.', 'चालान सिर्फ़ "Working on site" के दौरान बन सकता है - ताकि पार्ट्स असली काम के लिए ही निकलें। ख़राब पार्ट दर्ज करने से वो स्टोर में वापस आता है और कंपनी (CP Plus) को वारंटी में भेजा जा सकता है।'), phone: true },
        { role: 'store', t: T('Approve → GDN', 'मंज़ूर → GDN'), p: T('My Desk → Waiting on me mein approve. GDN apne aap (isme serial wala maal nahi). Stock: EzyKam −1, Dome −1. Warranty wale part ka kharcha "warranty cost" mein jaata hai.', 'My Desk → Waiting on me में मंज़ूर। GDN अपने आप (इसमें सीरियल वाला माल नहीं)। स्टॉक: EzyKam −1, डोम −1। वारंटी वाले पार्ट का ख़र्चा "वारंटी कॉस्ट" में जाता है।'), links: [L('/goods-dispatch/job-parts', 'Parts counter', 'पार्ट्स काउंटर')] },
        { role: 'office', t: T('Estimate bhejo', 'एस्टिमेट भेजें'), p: T('Complaint page → "Send estimate" → lines aur daam. Customer app, portal ya link par "haan" ya "naa" karta hai.', 'शिकायत पेज → "Send estimate" → लाइनें और दाम। ग्राहक ऐप, पोर्टल या लिंक पर "हाँ" या "ना" करता है।'), demo: T(`${DOME} ₹1,450 + Installation ₹400 = ₹1,850 + GST. EzyKam warranty mein - ₹0.`, `${DOME} ₹1,450 + इंस्टॉलेशन ₹400 = ₹1,850 + GST। EzyKam वारंटी में - ₹0।`), why: T('Pehle daam ki haan, phir kaam - bill par jhagda nahi hota. Customer ke paas app nahi hai to "Customer link" WhatsApp par bhejo - bina login khulta hai.', 'पहले दाम की हाँ, फिर काम - बिल पर झगड़ा नहीं होता। ग्राहक के पास ऐप नहीं है तो "Customer link" WhatsApp पर भेजें - बिना लॉगिन खुलता है।'), links: [L('/services/complaints', 'Customer Complaints', 'कस्टमर कंप्लेंट्स')] },
        { role: 'tech', t: T('Work done → code', 'काम पूरा → कोड'), p: T('"Work done" + kya kiya. Customer ka code → "Confirm with code". Customer ke paas code nahi par haan bola: "Customer approved, but has no code" - tab office customer ko call karke band karta hai.', '"Work done" + क्या किया। ग्राहक का कोड → "Confirm with code"। ग्राहक के पास कोड नहीं पर हाँ बोला: "Customer approved, but has no code" - तब ऑफ़िस ग्राहक को कॉल करके बंद करता है।'), phone: true },
        { role: 'office', t: T('Bill this job', 'Bill this job'), p: T('Complaint page par "Bill this job" → draft invoice banta hai (approved estimate se; estimate nahi to istemaal hue parts + visit charge). Check karke Issue.', 'शिकायत पेज पर "Bill this job" → ड्राफ़्ट इनवॉइस बनता है (मंज़ूर एस्टिमेट से; एस्टिमेट नहीं तो इस्तेमाल हुए पार्ट्स + विज़िट चार्ज)। जाँचकर Issue।'), demo: T('₹1,850 + GST ₹333 = ₹2,183.', '₹1,850 + GST ₹333 = ₹2,183।'), why: T('Stock aur kharcha GDN par pehle hi chadh chuka hai, isliye ye invoice stock dobara nahi ghatata. Ek job ka ek hi invoice.', 'स्टॉक और ख़र्चा GDN पर पहले ही चढ़ चुका है, इसलिए ये इनवॉइस स्टॉक दोबारा नहीं घटाता। एक जॉब का एक ही इनवॉइस।'), links: [L('/invoices', 'Invoices', 'इनवॉइस')] },
        { role: 'accounts', t: T('Cash mila: receipt', 'कैश मिला: रसीद'), p: T('Receipt → Cash → us invoice par allocate.', 'रसीद → कैश → उस इनवॉइस पर allocate।'), demo: T('₹2,183 cash.', '₹2,183 कैश।'), links: [L('/receipts', 'Receipts', 'रसीदें')] },
        { role: 'store', t: T('Kharab EzyKam company ko', 'ख़राब EzyKam कंपनी को'), p: T('Stock se badla hua purana unit Replacements mein case banta hai. Customer ka apna item le jaana ho (stock se badle bina) to agla chapter "Repair" dekho: pickup → Supplier Dispatch → RMA receipt → hand back.', 'स्टॉक से बदला हुआ पुराना यूनिट Replacements में केस बनता है। ग्राहक का अपना आइटम ले जाना हो (स्टॉक से बदले बिना) तो अगला चैप्टर "रिपेयर" देखें: पिकअप → सप्लायर डिस्पैच → RMA रसीद → वापस सौंपना।'), links: [L('/services/replacements', 'Replacements', 'रिप्लेसमेंट'), L('/services/dispatch', 'Supplier Dispatch', 'सप्लायर डिस्पैच')] },
      ] },
    ],
  },

  {
    id: 'repair', level: 'field', part: P.flows,
    title: T('Repair: camera company ko, aur wapas customer ko', 'रिपेयर: कैमरा कंपनी को, और वापस ग्राहक को'),
    purpose: T(
      'Stock se turant badla nahi jaata. Technician kharab item le aata hai, wo company (supplier) ko jaata hai, aur jo wapas aaye - wahi serial theek hokar, ya naya serial - usi complaint par customer ko milta hai.',
      'स्टॉक से तुरंत बदला नहीं जाता। टेक्नीशियन ख़राब आइटम ले आता है, वो कंपनी (सप्लायर) को जाता है, और जो वापस आए - वही सीरियल ठीक होकर, या नया सीरियल - उसी शिकायत पर ग्राहक को मिलता है।',
    ),
    blocks: [
      { k: 'flow', title: T('Repair ki zanjeer', 'रिपेयर की ज़ंजीर'), nodes: [
        { role: 'office', t: T('Complaint + items', 'शिकायत + आइटम'), sub: T('serial chuno', 'सीरियल चुनें') },
        { role: 'tech', t: T('Pickup receipt', 'पिकअप रसीद'), sub: T('PKP', 'PKP') },
        { role: 'store', t: T('Supplier Dispatch', 'सप्लायर डिस्पैच'), sub: T('DSP + challan', 'DSP + चालान') },
        { role: 'store', t: T('Supplier ka jawab', 'सप्लायर का जवाब'), sub: T('quote', 'कोटेशन') },
        { role: 'store', t: T('RMA receipt', 'RMA रसीद'), sub: T('GRR', 'GRR') },
        { role: 'office', t: T('Hand back', 'वापस सौंपें'), sub: T('GDN', 'GDN') },
        { role: 'tech', t: T('Refit visit', 'रीफ़िट विज़िट') },
        { role: 'office', t: T('Bill + band', 'बिल + बंद') },
      ] },
      { k: 'table', title: T('Kaun paisa deta hai - do alag switch', 'कौन पैसा देता है - दो अलग स्विच'), head: [T('Kya', 'क्या'), T('Muft kab', 'मुफ़्त कब'), T('Paisa lage to', 'पैसा लगे तो')], rows: [
        [T('Technician (har visit)', 'टेक्नीशियन (हर विज़िट)'), T('AMC chalu ho', 'AMC चालू हो'), T('Visit charge × visit (pickup aur refit - do visit)', 'विज़िट चार्ज × विज़िट (ले जाना और वापस लगाना - दो विज़िट)')],
        [T('Part / repair / naya unit', 'पार्ट / रिपेयर / नया यूनिट'), T('Warranty chalu ho aur void na ho', 'वारंटी चालू हो और रद्द न हो'), T('Supplier ka charge + markup %', 'सप्लायर का चार्ज + मार्कअप %')],
      ] },
      { k: 'note', tone: 'tip', text: T('AMC aur warranty dono installation ki tareekh se chalte hain. Supplier ka bheja naya serial customer ko dene ke din se poori nayi warranty leta hai.', 'AMC और वारंटी दोनों इंस्टॉलेशन की तारीख़ से चलते हैं। सप्लायर का भेजा नया सीरियल ग्राहक को देने के दिन से पूरी नई वारंटी लेता है।') },
      { k: 'states', title: T('Ek item kahan hai', 'एक आइटम कहाँ है'), states: [
        { code: 'open', t: T('Site par', 'साइट पर'), who: T('Complaint par darj', 'शिकायत पर दर्ज'), tone: 'new' },
        { code: 'picked_up', t: T('Le jaaya gaya', 'ले जाया गया'), who: T('Technician (PKP)', 'टेक्नीशियन (PKP)'), tone: 'work' },
        { code: 'with_supplier', t: T('Supplier ke paas', 'सप्लायर के पास'), who: T('Store (DSP)', 'स्टोर (DSP)'), tone: 'wait' },
        { code: 'back', t: T('Wapas aaya - saumpna hai', 'वापस आया - सौंपना है'), who: T('Store (GRR)', 'स्टोर (GRR)'), tone: 'work' },
        { code: 'supplier_closed', t: T('Supplier ne rakh liya', 'सप्लायर ने रख लिया'), who: T('Credit note / likhit jawab', 'क्रेडिट नोट / लिखित जवाब'), tone: 'wait' },
        { code: 'handed_back', t: T('Wapas saumpa', 'वापस सौंपा'), who: T('Office (GDN)', 'ऑफ़िस (GDN)'), tone: 'done' },
        { code: 'declined', t: T('Bina repair lautaya', 'बिना रिपेयर लौटाया'), who: T('Office', 'ऑफ़िस'), tone: 'end' },
        { code: 'cancelled', t: T('Hataya gaya', 'हटाया गया'), who: T('Office, kaaran ke saath', 'ऑफ़िस, कारण के साथ'), tone: 'end' },
      ], side: [
        T('Jab tak koi item bahar hai, complaint band, resolve ya cancel nahi hoti.', 'जब तक कोई आइटम बाहर है, शिकायत बंद, resolve या कैंसल नहीं होती।'),
        T('Pickup wale visit par "Work done" dabane se job "In progress" rehta hai - customer se code tab maangte hain jab item wapas lag jaaye.', 'पिकअप वाली विज़िट पर "Work done" दबाने से जॉब "In progress" रहता है - ग्राहक से कोड तब माँगते हैं जब आइटम वापस लग जाए।'),
        T('Paisa lagta ho to bill bane bina job band nahi hota - ya "Don\'t bill" kaaran ke saath.', 'पैसा लगता हो तो बिल बने बिना जॉब बंद नहीं होता - या कारण के साथ "बिल न बनाएँ"।'),
      ] },
      { k: 'steps', items: [
        { role: 'office', t: T('Complaint par serial chuno', 'शिकायत पर सीरियल चुनें'), p: T('"Raise complaint" → customer → uske paas jo serial hain unme se kharab wale tick karo (ek ya zyada). Hamara nahi hai to "Not our product" - brand, model, serial likho.', '"Raise complaint" → ग्राहक → उसके पास जो सीरियल हैं उनमें से ख़राब वाले चुनें (एक या ज़्यादा)। हमारा नहीं है तो "Not our product" - ब्रांड, मॉडल, सीरियल लिखें।'), demo: T(`Sharma Medical: 3 ${DOME} band. Do warranty mein, ek ki warranty khatam.`, `शर्मा मेडिकल: 3 ${DOME} बंद। दो वारंटी में, एक की वारंटी ख़त्म।`), why: T('Har item ki apni warranty hoti hai - ek camera warranty mein, bagal wala nahi. Complaint par dono switch har item ke saath dikhte hain.', 'हर आइटम की अपनी वारंटी होती है - एक कैमरा वारंटी में, बगल वाला नहीं। शिकायत पर दोनों स्विच हर आइटम के साथ दिखते हैं।'), links: [L('/services/complaints', 'Customer Complaints', 'कस्टमर कंप्लेंट्स')] },
        { role: 'office', t: T('Warranty void (bijli, paani, tootna)', 'वारंटी रद्द (बिजली, पानी, टूटना)'), p: T('Item par "Warranty void…" → kaaran + job ki photo → manager My Desk mein haan kare. Tab us item ka part/repair customer dega; AMC hai to technician ab bhi muft.', 'आइटम पर "Warranty void…" → कारण + जॉब की फ़ोटो → मैनेजर My Desk में हाँ करे। तब उस आइटम का पार्ट/रिपेयर ग्राहक देगा; AMC है तो टेक्नीशियन अब भी मुफ़्त।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क')] },
        { role: 'tech', t: T('Item le jao: pickup receipt', 'आइटम ले जाएँ: पिकअप रसीद'), p: T('Phone par job → Items → "Take for repair" → jo le ja rahe ho tick karo → dene wale ka naam → "Make pickup receipt". Signal nahi hai to phone par save hota hai, baad mein apne aap jaata hai.', 'फ़ोन पर जॉब → Items → "Take for repair" → जो ले जा रहे हैं चुनें → देने वाले का नाम → "Make pickup receipt"। सिग्नल नहीं है तो फ़ोन पर सेव होता है, बाद में अपने आप जाता है।'), demo: T('PKP-0003, "Sharma ji ne diya, adaptor ke saath".', 'PKP-0003, "शर्मा जी ने दिया, एडैप्टर के साथ"।'), why: T('Customer ka item uska hi rehta hai - invoice aur warranty saath. Har item ka supplier case (RMA) apne aap khulta hai.', 'ग्राहक का आइटम उसका ही रहता है - इनवॉइस और वारंटी साथ। हर आइटम का सप्लायर केस (RMA) अपने आप खुलता है।'), phone: true },
        { role: 'store', t: T('Ek dabba, ek supplier: Supplier Dispatch', 'एक डिब्बा, एक सप्लायर: सप्लायर डिस्पैच'), p: T('Supplier Dispatch → "To send" mein ek supplier ke items tick (alag-alag complaint ke bhi) → courier, docket, tracking link, charge, kisne diya → "Make dispatch and send". Delivery challan chhapo (repair ke liye - bikri nahi, tax nahi).', 'Supplier Dispatch → "To send" में एक सप्लायर के आइटम चुनें (अलग-अलग शिकायत के भी) → कूरियर, डॉकेट, ट्रैकिंग लिंक, चार्ज, किसने दिया → "Make dispatch and send"। डिलीवरी चालान छापें (रिपेयर के लिए - बिक्री नहीं, टैक्स नहीं)।'), demo: T('DSP-0002, DTDC, ₹300 cash - 3 item par ₹100-100.', 'DSP-0002, DTDC, ₹300 नक़द - 3 आइटम पर ₹100-100।'), why: T('Courier ka kharcha Freight & Delivery mein jaata hai aur har item par uska hissa likha rehta hai.', 'कूरियर का ख़र्चा Freight & Delivery में जाता है और हर आइटम पर उसका हिस्सा लिखा रहता है।'), links: [L('/services/dispatch', 'Supplier Dispatch', 'सप्लायर डिस्पैच')] },
        { role: 'store', t: T('Supplier ka jawab likho', 'सप्लायर का जवाब लिखें'), p: T('Dabbe ke page par item → "Supplier\'s answer": repair karenge / naya bhej rahe / credit note / nahi hoga, aur unka charge.', 'डिब्बे के पेज पर आइटम → "Supplier\'s answer": रिपेयर करेंगे / नया भेज रहे / क्रेडिट नोट / नहीं होगा, और उनका चार्ज।'), demo: T('Warranty khatam wale camera par ₹1,200. Markup 25% → customer ka estimate ₹1,500 + GST apne aap bhara milta hai.', 'वारंटी ख़त्म वाले कैमरे पर ₹1,200। मार्कअप 25% → ग्राहक का एस्टिमेट ₹1,500 + GST अपने आप भरा मिलता है।'), links: [L('/services/dispatch', 'Supplier Dispatch', 'सप्लायर डिस्पैच')] },
        { role: 'store', t: T('Jo aaya, wo lo: RMA receipt', 'जो आया, वो लें: RMA रसीद'), p: T('"Receive what came back" → har item: wahi serial theek / naya serial (number likho) / bina repair. Jo abhi nahi aaya use "Not back yet" chhodo - baad mein dusri receipt. Wapasi courier humne diya ho to likho.', '"Receive what came back" → हर आइटम: वही सीरियल ठीक / नया सीरियल (नंबर लिखें) / बिना रिपेयर। जो अभी नहीं आया उसे "Not back yet" छोड़ें - बाद में दूसरी रसीद। वापसी कूरियर हमने दिया हो तो लिखें।'), demo: T('GRR-0001: ek theek, ek naya S/N. Teesra baad mein.', 'GRR-0001: एक ठीक, एक नया S/N। तीसरा बाद में।'), why: T('Customer ka item humare stock mein nahi chadhta - wo uska hi hai. Naya serial bhi customer ka banta hai.', 'ग्राहक का आइटम हमारे स्टॉक में नहीं चढ़ता - वो उसका ही है। नया सीरियल भी ग्राहक का बनता है।'), links: [L('/services/dispatch', 'Supplier Dispatch', 'सप्लायर डिस्पैच')] },
        { role: 'store', t: T('Kuch wapas nahi aaya', 'कुछ वापस नहीं आया'), p: T('"Closed without coming back" → unka credit note (number + rakam) ya likhit jawab (rakh liya / scrap). Purana unit "Kept by supplier".', '"Closed without coming back" → उनका क्रेडिट नोट (नंबर + रक़म) या लिखित जवाब (रख लिया / स्क्रैप)। पुराना यूनिट "Kept by supplier"।'), why: T('Credit note supplier ke khaate mein jaata hai. Customer ko phir stock se unit milta hai (agla step).', 'क्रेडिट नोट सप्लायर के खाते में जाता है। ग्राहक को फिर स्टॉक से यूनिट मिलता है (अगला कदम)।') },
        { role: 'office', t: T('Customer ko wapas: GDN', 'ग्राहक को वापस: GDN'), p: T('Complaint page → "Hand back" → items tick → supplier ne rakh liya ho to stock se serial chuno → lene wale ka naam → "Make the GDN". Customer se sign karwao.', 'शिकायत पेज → "Hand back" → आइटम चुनें → सप्लायर ने रख लिया हो तो स्टॉक से सीरियल चुनें → लेने वाले का नाम → "Make the GDN"। ग्राहक से साइन करवाएँ।'), demo: T('GDN-0018 - teeno camera, ek stock se.', 'GDN-0018 - तीनों कैमरे, एक स्टॉक से।'), why: T('Naya serial aur stock se diya unit aaj se poori nayi warranty lete hain. Stock sirf stock wale unit ka ghatta hai.', 'नया सीरियल और स्टॉक से दिया यूनिट आज से पूरी नई वारंटी लेते हैं। स्टॉक सिर्फ़ स्टॉक वाले यूनिट का घटता है।'), links: [L('/services/complaints', 'Customer Complaints', 'कस्टमर कंप्लेंट्स')] },
        { role: 'tech', t: T('Refit visit', 'रीफ़िट विज़िट'), p: T('Visit ka kaaran "Fitting a repaired item back". Lagao → "Work done" → customer ka code.', 'विज़िट का कारण "Fitting a repaired item back"। लगाएँ → "Work done" → ग्राहक का कोड।'), phone: true },
        { role: 'office', t: T('Bill this job, phir band', 'बिल बनाएँ, फिर बंद'), p: T('Complaint par "To bill" mein dikhta hai kya lagega - har item alag. "Bill this job" → draft invoice. Goodwill mein na lena ho to "Don\'t bill" + kaaran.', 'शिकायत पर "To bill" में दिखता है क्या लगेगा - हर आइटम अलग। "Bill this job" → ड्राफ़्ट इनवॉइस। सद्भावना में न लेना हो तो "Don\'t bill" + कारण।'), demo: T('Visit ₹500 + repair ₹1,500 = ₹2,000 + GST = ₹2,360.', 'विज़िट ₹500 + रिपेयर ₹1,500 = ₹2,000 + GST = ₹2,360।'), links: [L('/invoices', 'Invoices', 'इनवॉइस')] },
      ] },
      { k: 'note', tone: 'good', text: T('Customer apne link, portal ya app par har item ka haal dekhta hai - "company ko bheja", "theek ho gaya", "wapas saumpa" - bina daam, courier ya supplier ke naam ke.', 'ग्राहक अपने लिंक, पोर्टल या ऐप पर हर आइटम का हाल देखता है - "कंपनी को भेजा", "ठीक हो गया", "वापस सौंपा" - बिना दाम, कूरियर या सप्लायर के नाम के।') },
    ],
  },

  {
    id: 'buy', level: 'office', part: P.flows,
    title: T('Kharid: supplier se godaam tak', 'ख़रीद: सप्लायर से गोदाम तक'),
    purpose: T(
      'Bullet camera kam ho rahe hain - 20 naye mangwane hain. Purchase order, maal aana (GRN), supplier ka bill, aur paisa dena.',
      'बुलेट कैमरे कम हो रहे हैं - 20 नए मँगवाने हैं। परचेज़ ऑर्डर, माल आना (GRN), सप्लायर का बिल, और पैसा देना।',
    ),
    blocks: [
      { k: 'flow', title: T('Kharid ki zanjeer', 'ख़रीद की ज़ंजीर'), nodes: [
        { role: 'system', t: T('Stock kam', 'स्टॉक कम'), sub: T('reorder level', 'रीऑर्डर लेवल') },
        { role: 'office', t: T('Purchase order', 'परचेज़ ऑर्डर'), sub: T('Draft → Sent → Approved', 'Draft → Sent → Approved') },
        { role: 'store', t: T('Maal aaya: GRN', 'माल आया: GRN'), sub: T('stock badha', 'स्टॉक बढ़ा') },
        { role: 'accounts', t: T('Supplier bill', 'सप्लायर बिल'), sub: T('Post', 'Post') },
        { role: 'accounts', t: T('Payables', 'देय'), sub: T('kitna, kab tak', 'कितना, कब तक') },
        { role: 'accounts', t: T('Payment', 'पेमेंट') },
      ] },
      { k: 'steps', items: [
        { role: 'store', t: T('Kya kam hai, dekho', 'क्या कम है, देखें'), p: T('Stock report mein reorder level se neeche wale product upar dikhte hain.', 'स्टॉक रिपोर्ट में रीऑर्डर लेवल से नीचे वाले प्रोडक्ट ऊपर दिखते हैं।'), demo: T(`${BULLET}: bache 6, reorder level 10.`, `${BULLET}: बचे 6, रीऑर्डर लेवल 10।`), links: [L('/reports/product-stock', 'Stock', 'स्टॉक')] },
        { role: 'office', t: T('Purchase order banao', 'परचेज़ ऑर्डर बनाएँ'), p: T('Supplier, product, qty, kharid ka daam. Draft → Sent (supplier ko bheja) → Approved. Sent hone tak hi badal sakte ho.', 'सप्लायर, प्रोडक्ट, मात्रा, ख़रीद का दाम। Draft → Sent (सप्लायर को भेजा) → Approved। Sent होने तक ही बदल सकते हैं।'), demo: T('Shree Ganesh Distributors: 20 × Bullet @ ₹1,150 = ₹23,000 + GST ₹4,140 = ₹27,140.', 'श्री गणेश डिस्ट्रीब्यूटर्स: 20 × बुलेट @ ₹1,150 = ₹23,000 + GST ₹4,140 = ₹27,140।'), why: T('PO se pata rehta hai kya maanga tha - maal kam aaya ya daam alag laga to isi se milate hain.', 'PO से पता रहता है क्या माँगा था - माल कम आया या दाम अलग लगा तो इसी से मिलाते हैं।'), links: [L('/purchase/orders', 'Purchase Orders', 'परचेज़ ऑर्डर')] },
        { role: 'store', shot: 'goods-receipt', t: T('Maal aaya: Receive goods (GRN)', 'माल आया: Receive goods (GRN)'), p: T('Goods Receipt → "Receive goods" → PO chuno → kitna aaya → "Post receipt". Serial wale maal par "Scan serials".', 'Goods Receipt → "Receive goods" → PO चुनें → कितना आया → "Post receipt"। सीरियल वाले माल पर "Scan serials"।'), demo: T('Aaj 15 aaye, 5 agle hafte - PO "Partially Received" rehta hai; baaki 5 aane par "Received".', 'आज 15 आए, 5 अगले हफ़्ते - PO "Partially Received" रहता है; बाक़ी 5 आने पर "Received"।'), why: T('Stock sirf GRN se badhta hai. Bill se paisa ka hisaab banta hai, maal ka nahi - isliye dono alag.', 'स्टॉक सिर्फ़ GRN से बढ़ता है। बिल से पैसे का हिसाब बनता है, माल का नहीं - इसलिए दोनों अलग।'), links: [L('/goods-receipt', 'Goods Receipt Note', 'गुड्स रिसीट नोट')] },
        { role: 'accounts', shot: 'purchase-bills', t: T('Supplier ka bill darj karo', 'सप्लायर का बिल दर्ज करें'), p: T('Purchase Bill → supplier ka apna bill number → lines → "Post it". Bina PO wala bill post karne par Atlas khud maal bhi le leta hai.', 'परचेज़ बिल → सप्लायर का अपना बिल नंबर → लाइनें → "Post it"। बिना PO वाला बिल पोस्ट करने पर एटलस ख़ुद माल भी ले लेता है।'), demo: T('Bill SGD/1187, due 30 din baad.', 'बिल SGD/1187, देय 30 दिन बाद।'), why: T('Kharid ka asli daam yahin se aata hai - isi se har bikri ka faayda (margin) gina jaata hai. Bill nahi to faayda sirf andaaza.', 'ख़रीद का असली दाम यहीं से आता है - इसी से हर बिक्री का फ़ायदा (मार्जिन) गिना जाता है। बिल नहीं तो फ़ायदा सिर्फ़ अंदाज़ा।'), links: [L('/purchase/bills', 'Purchase Bills', 'परचेज़ बिल')] },
        { role: 'accounts', t: T('Kisko kitna dena hai', 'किसको कितना देना है'), p: T('Payables: supplier aur din ke hisaab se baaki bill. Paisa diya to "Pay this supplier". Cheque bounce hua to Reverse - delete nahi.', 'Payables: सप्लायर और दिन के हिसाब से बाक़ी बिल। पैसा दिया तो "Pay this supplier"। चेक बाउंस हुआ तो Reverse - डिलीट नहीं।'), why: T('Bill ka status (Unpaid, Part paid, Overdue, Paid) har baar paise aur tareekh se gina jaata hai, likha nahi jaata - isliye galat nahi hota.', 'बिल का स्टेटस (Unpaid, Part paid, Overdue, Paid) हर बार पैसे और तारीख़ से गिना जाता है, लिखा नहीं जाता - इसलिए ग़लत नहीं होता।'), links: [L('/purchase/payables', 'Payables', 'देय'), L('/supplier/account', 'Supplier Account', 'सप्लायर खाता')] },
        { role: 'store', t: T('Kharab maal supplier ko wapas', 'ख़राब माल सप्लायर को वापस'), p: T('Purchase Return → product, qty → "Dispatch" (stock ghata). Phir Accounts "Issue debit note" - supplier ka bakaya ghatta hai.', 'परचेज़ रिटर्न → प्रोडक्ट, मात्रा → "Dispatch" (स्टॉक घटा)। फिर अकाउंट्स "Issue debit note" - सप्लायर का बकाया घटता है।'), demo: T('1 Bullet dead-on-arrival → wapas → debit note ₹1,357.', '1 बुलेट शुरू से ख़राब → वापस → डेबिट नोट ₹1,357।'), why: T('Maal jaana aur paisa ghatna alag din ho sakte hain - isliye do kaagaz.', 'माल जाना और पैसा घटना अलग दिन हो सकते हैं - इसलिए दो काग़ज़।'), links: [L('/purchase-return', 'Purchase Return', 'परचेज़ रिटर्न')] },
      ] },
    ],
  },
  {
    id: 'van', level: 'field', part: P.flows,
    title: T('Van stock: technician ke saath ghoomta maal', 'वैन स्टॉक: टेक्नीशियन के साथ घूमता माल'),
    purpose: T(
      'Subah technician ko maal diya, shaam ko hisaab. Van ek chhota godaam hai - maal bika nahi, sirf jagah badli aur uspar ek naam aa gaya.',
      'सुबह टेक्नीशियन को माल दिया, शाम को हिसाब। वैन एक छोटा गोदाम है - माल बिका नहीं, सिर्फ़ जगह बदली और उस पर एक नाम आ गया।',
    ),
    blocks: [
      { k: 'flow', title: T('Van ka din', 'वैन का दिन'), nodes: [
        { role: 'store', t: T('Van mein maal (Load)', 'वैन में माल (Load)'), sub: T('subah', 'सुबह') },
        { role: 'tech', t: T('Job par laga', 'जॉब पर लगा'), sub: T('GDN', 'GDN') },
        { role: 'tech', t: T('Hand back', 'वापस'), sub: T('shaam', 'शाम') },
        { role: 'store', t: T('Hisaab', 'हिसाब'), sub: T('kam hai?', 'कम है?') },
        { role: 'office', t: T('Write off + kaaran', 'राइट-ऑफ़ + कारण'), sub: T('sirf kami par', 'सिर्फ़ कमी पर') },
      ] },
      { k: 'steps', items: [
        { role: 'store', shot: 'van-stock', t: T('Subah: van mein maal', 'सुबह: वैन में माल'), p: T('Van Stock → technician ki van → "Load" → maal aur qty. Ya technician store counter par phone ke "Load my van" se scan karke le jaata hai.', 'वैन स्टॉक → टेक्नीशियन की वैन → "Load" → माल और मात्रा। या टेक्नीशियन स्टोर काउंटर पर फ़ोन के "Load my van" से स्कैन करके ले जाता है।'), demo: T('Ravi ki van: 4 Bullet, 2 Dome.', 'रवि की वैन: 4 बुलेट, 2 डोम।'), why: T('Kul stock nahi badalta - godaam se ghata, van mein badha. Par ab us maal par Ravi ka naam hai.', 'कुल स्टॉक नहीं बदलता - गोदाम से घटा, वैन में बढ़ा। पर अब उस माल पर रवि का नाम है।'), links: [L('/van-stock', 'Van stock', 'वैन स्टॉक')] },
        { role: 'tech', t: T('Din mein: van se job par', 'दिन में: वैन से जॉब पर'), p: T('Job par parts lage to challan/GDN se van ka stock ghatta hai - store tak wapas aane ki zaroorat nahi.', 'जॉब पर पार्ट्स लगे तो चालान/GDN से वैन का स्टॉक घटता है - स्टोर तक वापस आने की ज़रूरत नहीं।'), phone: true },
        { role: 'store', t: T('Shaam: Hand back', 'शाम: Hand back'), p: T('Bacha maal wapas lo - "Hand back" ya "Hand back everything". Screen batati hai kya hona chahiye tha aur kya aaya.', 'बचा माल वापस लें - "Hand back" या "Hand back everything"। स्क्रीन बताती है क्या होना चाहिए था और क्या आया।'), demo: T('Ravi: 1 Bullet laga, 3 Bullet + 1 Dome wapas → 1 Dome kam.', 'रवि: 1 बुलेट लगा, 3 बुलेट + 1 डोम वापस → 1 डोम कम।'), links: [L('/van-stock', 'Van stock', 'वैन स्टॉक')] },
        { role: 'office', t: T('Kami: dhoondho ya write off', 'कमी: ढूँढें या राइट-ऑफ़'), p: T('Kami apne aap gayab nahi hoti - screen par tab tak rehti hai jab tak koi naam ke saath "Write off what is missing" + kaaran na kare. Approval rule laga ho to maalik ki haan chahiye.', 'कमी अपने आप ग़ायब नहीं होती - स्क्रीन पर तब तक रहती है जब तक कोई नाम के साथ "Write off what is missing" + कारण न करे। मंज़ूरी का नियम लगा हो तो मालिक की हाँ चाहिए।'), why: T('Kami khud mit jaaye to sab seekh jaate hain ki kami se fark nahi padta. Naam aur kaaran ke saath rehti hai, tabhi ginti ka matlab hai.', 'कमी ख़ुद मिट जाए तो सब सीख जाते हैं कि कमी से फ़र्क़ नहीं पड़ता। नाम और कारण के साथ रहती है, तभी गिनती का मतलब है।') },
      ] },
    ],
  },
  {
    id: 'returns', level: 'office', part: P.flows,
    title: T('Maal wapas aaya: Sales return aur Credit note', 'माल वापस आया: सेल्स रिटर्न और क्रेडिट नोट'),
    purpose: T(
      'Green Valley ko ek Bullet zyada chala gaya - wapas aaya. Maal ka kaagaz alag, paise ka alag.',
      'ग्रीन वैली को एक बुलेट ज़्यादा चला गया - वापस आया। माल का काग़ज़ अलग, पैसे का अलग।',
    ),
    blocks: [
      { k: 'flow', title: T('Wapsi ki zanjeer', 'वापसी की ज़ंजीर'), nodes: [
        { role: 'customer', t: T('Maal wapas', 'माल वापस') },
        { role: 'store', t: T('Sales return', 'सेल्स रिटर्न'), sub: T('stock mein ya kharab', 'स्टॉक में या ख़राब') },
        { role: 'accounts', t: T('Credit note', 'क्रेडिट नोट'), sub: T('bakaya ghata', 'बकाया घटा') },
        { role: 'accounts', t: T('Agle bill mein ya refund', 'अगले बिल में या रिफ़ंड') },
      ] },
      { k: 'steps', items: [
        { role: 'store', t: T('Sales return banao', 'सेल्स रिटर्न बनाएँ'), p: T('Invoice chuno → kaunsa item, kitna → kaaran → kya karein: "Back into stock" (bikne layak), "Damaged" (aaya par bikne layak nahi), "Scrapped" (aaya hi nahi / phenk diya).', 'इनवॉइस चुनें → कौन-सा आइटम, कितना → कारण → क्या करें: "Back into stock" (बिकने लायक़), "Damaged" (आया पर बिकने लायक़ नहीं), "Scrapped" (आया ही नहीं / फेंक दिया)।'), demo: T('INV-0088 se 1 Bullet, kaaran "Excess supplied", Back into stock.', 'INV-0088 से 1 बुलेट, कारण "Excess supplied", Back into stock।'), why: T('Sirf "Back into stock" se stock badhta hai. Kharab maal ko stock mein daala to agla customer kharab camera paayega.', 'सिर्फ़ "Back into stock" से स्टॉक बढ़ता है। ख़राब माल को स्टॉक में डाला तो अगला ग्राहक ख़राब कैमरा पाएगा।'), links: [L('/sales-return', 'Sales Return', 'सेल्स रिटर्न')] },
        { role: 'accounts', t: T('Credit note', 'क्रेडिट नोट'), p: T('Return par "Mark goods received" → phir "Issue credit note". Customer ka bakaya utna ghat jaata hai. Bina maal ke bhi credit note ban sakta hai: damage allowance, daam ki galti, kam maal.', 'रिटर्न पर "Mark goods received" → फिर "Issue credit note"। ग्राहक का बकाया उतना घट जाता है। बिना माल के भी क्रेडिट नोट बन सकता है: डैमेज अलाउंस, दाम की ग़लती, कम माल।'), demo: T('₹1,650 + GST = ₹1,947. Green Valley ka bakaya ₹5,216 → ₹3,269.', '₹1,650 + GST = ₹1,947। ग्रीन वैली का बकाया ₹5,216 → ₹3,269।'), why: T('Invoice ko kabhi badla ya mitaya nahi jaata - credit note us par lagta hai. GST ke niyam se credit note ki ek aakhri tareekh hoti hai (agle saal ka November, CA se pakka karein) - Atlas chetaavni deta hai.', 'इनवॉइस को कभी बदला या मिटाया नहीं जाता - क्रेडिट नोट उस पर लगता है। GST के नियम से क्रेडिट नोट की एक आख़िरी तारीख़ होती है (अगले साल का नवंबर, CA से पक्का करें) - एटलस चेतावनी देता है।'), links: [L('/credit-notes', 'Credit Notes', 'क्रेडिट नोट'), L('/customer/account', 'Customer Account', 'ग्राहक खाता')] },
      ] },
    ],
  },
  {
    id: 'amc', level: 'office', part: P.flows,
    title: T('AMC: saal bhar ka maintenance contract', 'AMC: साल भर का मेंटेनेंस कॉन्ट्रैक्ट'),
    purpose: T(
      'Green Valley ne 4 camera + DVR ka AMC liya. Ab jab bhi complaint aaye, Atlas pehle hi bata deta hai: kaun paisa dega.',
      'ग्रीन वैली ने 4 कैमरे + DVR का AMC लिया। अब जब भी शिकायत आए, एटलस पहले ही बता देता है: कौन पैसा देगा।',
    ),
    blocks: [
      { k: 'states', title: T('AMC ke status', 'AMC के स्टेटस'), states: [
        { code: 'draft', t: T('Draft', 'ड्राफ़्ट'), who: T('Office ne banaya', 'ऑफ़िस ने बनाया'), tone: 'new' },
        { code: 'active', t: T('Active', 'चालू'), who: T('Office ne chalu kiya', 'ऑफ़िस ने चालू किया'), tone: 'work' },
        { code: 'expired', t: T('Expired', 'ख़त्म'), who: T('Tareekh nikal gayi', 'तारीख़ निकल गई'), tone: 'wait' },
        { code: 'cancelled', t: T('Cancelled', 'रद्द'), who: T('Office, kaaran ke saath', 'ऑफ़िस, कारण के साथ'), tone: 'end' },
      ], side: [
        T('Expired se wapas Active ho sakta hai - der se renew karne wala bhi customer hai.', 'Expired से वापस Active हो सकता है - देर से रिन्यू करने वाला भी ग्राहक है।'),
        T('Cancelled aakhri hai - wapas nahi khulta, taaki kyun band hua wo mit na jaaye.', 'Cancelled आख़िरी है - वापस नहीं खुलता, ताकि क्यों बंद हुआ वो मिट न जाए।'),
      ] },
      { k: 'steps', items: [
        { role: 'office', t: T('Contract banao', 'कॉन्ट्रैक्ट बनाएँ'), p: T('Customer, shuru aur khatam ki tareekh, daam, cover: "Labour only" ya "Parts and labour". Product chuno - koi product nahi chuna to poori site cover.', 'ग्राहक, शुरू और ख़त्म की तारीख़, दाम, कवर: "Labour only" या "Parts and labour"। प्रोडक्ट चुनें - कोई प्रोडक्ट नहीं चुना तो पूरी साइट कवर।'), demo: T('Green Valley, 1 saal, ₹6,000, Parts and labour, 4 camera + DVR.', 'ग्रीन वैली, 1 साल, ₹6,000, Parts and labour, 4 कैमरे + DVR।'), links: [L('/services/amc', 'Maintenance Contracts', 'मेंटेनेंस कॉन्ट्रैक्ट')] },
        { role: 'office', t: T('Chalu karo (Active)', 'चालू करें (Active)'), p: T('Draft se Active haath se karna padta hai.', 'Draft से Active हाथ से करना पड़ता है।'), why: T('Pehle se type kiya contract sirf tareekh aane se chalu na ho jaaye - koi detail check kare tab.', 'पहले से टाइप किया कॉन्ट्रैक्ट सिर्फ़ तारीख़ आने से चालू न हो जाए - कोई डिटेल जाँचे तब।') },
        { role: 'office', t: T('Complaint par "kaun dega"', 'शिकायत पर "कौन देगा"'), p: T('Is customer ki complaint par Atlas dikhata hai: "Under AMC", "Under warranty" ya "Chargeable". Zyadatar customer AMC wale hon to Customisation mein estimate step band kar sakte ho.', 'इस ग्राहक की शिकायत पर एटलस दिखाता है: "Under AMC", "Under warranty" या "Chargeable"। ज़्यादातर ग्राहक AMC वाले हों तो कस्टमाइज़ेशन में एस्टिमेट स्टेप बंद कर सकते हैं।'), why: T('Technician bhejne se pehle pata ho ki kaun dega - baad mein counter par behas nahi.', 'टेक्नीशियन भेजने से पहले पता हो कि कौन देगा - बाद में काउंटर पर बहस नहीं।') },
        { role: 'office', t: T('Renewal', 'रिन्यूअल'), p: T('List mein jaldi khatam hone wale contract upar. Samay par customer ko yaad dilao.', 'लिस्ट में जल्दी ख़त्म होने वाले कॉन्ट्रैक्ट ऊपर। समय पर ग्राहक को याद दिलाएँ।'), links: [L('/services/amc', 'Maintenance Contracts', 'मेंटेनेंस कॉन्ट्रैक्ट')] },
      ] },
    ],
  },

  // ================================================================ people
  {
    id: 'leave', level: 'field', part: P.people,
    title: T('Chhutti, half day, WFH', 'छुट्टी, हाफ़ डे, WFH'),
    purpose: T('Imran ko kal ki chhutti chahiye. Maangna, haan/naa, aur salary par asar.', 'इमरान को कल की छुट्टी चाहिए। माँगना, हाँ/ना, और सैलरी पर असर।'),
    blocks: [
      { k: 'flow', title: T('Chhutti ki zanjeer', 'छुट्टी की ज़ंजीर'), nodes: [
        { role: 'tech', t: T('Request', 'अनुरोध'), sub: T('phone / My Desk', 'फ़ोन / माई डेस्क') },
        { role: 'office', t: T('Manager haan/naa', 'मैनेजर हाँ/ना'), sub: T('reporting line', 'रिपोर्टिंग लाइन') },
        { role: 'system', t: T('Attendance grid', 'अटेंडेंस ग्रिड') },
        { role: 'accounts', t: T('Payroll', 'पेरोल') },
      ] },
      { k: 'steps', items: [
        { role: 'tech', t: T('Chhutti maango', 'छुट्टी माँगें'), p: T('Phone app → Requests → Leave / Half day / Work from home / Comp-off → tareekh → kaaran. Website par My Desk se.', 'फ़ोन ऐप → Requests → Leave / Half day / Work from home / Comp-off → तारीख़ → कारण। वेबसाइट पर My Desk से।'), demo: T('Imran: kal 1 din, "ghar ka kaam".', 'इमरान: कल 1 दिन, "घर का काम"।'), phone: true },
        { role: 'office', t: T('Haan ya naa', 'हाँ या ना'), p: T('Request reporting line par upar jaati hai (Team Setup). Phone ke Approvals ya website ke My Desk se Approve / Reject (naa par kaaran zaroori).', 'अनुरोध रिपोर्टिंग लाइन पर ऊपर जाता है (टीम सेटअप)। फ़ोन के Approvals या वेबसाइट के My Desk से Approve / Reject (ना पर कारण ज़रूरी)।'), demo: T('Pooja ne approve kiya.', 'पूजा ने मंज़ूर किया।'), why: T('Koi apni chhutti khud approve nahi kar sakta (admin kare to "admin override" darj hota hai).', 'कोई अपनी छुट्टी ख़ुद मंज़ूर नहीं कर सकता (एडमिन करे तो "admin override" दर्ज होता है)।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क')] },
        { role: 'office', t: T('Chhutti ka hisaab', 'छुट्टी का हिसाब'), p: T('Kis kism ki chhutti kitni milti hai aur kisne kitni li - Leave Types & Allocation. Mahine ka grid sabki chhutti dikhata hai.', 'किस क़िस्म की छुट्टी कितनी मिलती है और किसने कितनी ली - Leave Types & Allocation। महीने का ग्रिड सबकी छुट्टी दिखाता है।'), links: [L('/holiday/leave-types', 'Leave Types', 'छुट्टी के प्रकार'), L('/attendance/grid', 'Monthly Grid', 'मंथली ग्रिड')] },
      ] },
    ],
  },
  {
    id: 'payroll', level: 'admin', part: P.people,
    title: T('Attendance se salary tak', 'अटेंडेंस से सैलरी तक'),
    purpose: T(
      'Mahine ke ant mein: haazri, chhutti, loan aur travel allowance se har vyakti ki payslip, phir paisa.',
      'महीने के अंत में: हाज़िरी, छुट्टी, लोन और यात्रा भत्ते से हर व्यक्ति की पे-स्लिप, फिर पैसा।',
    ),
    blocks: [
      { k: 'states', title: T('Payroll run ke status', 'पेरोल रन के स्टेटस'), states: [
        { code: 'draft', t: T('Draft', 'ड्राफ़्ट'), who: T('Generate kiya - dobara bana sakte ho', 'Generate किया - दोबारा बना सकते हैं'), tone: 'new' },
        { code: 'processed', t: T('Processed (lock)', 'प्रोसेस्ड (लॉक)'), who: T('Pakka + lock - loan EMI kati, payslip ab nahi badlegi', 'पक्का + लॉक - लोन EMI कटी, पे-स्लिप अब नहीं बदलेगी'), tone: 'work' },
        { code: 'paid', t: T('Paid', 'पेड'), who: T('Paisa de diya', 'पैसा दे दिया'), tone: 'end' },
      ] },
      { k: 'steps', items: [
        { role: 'owner', t: T('Har vyakti ki salary (ek baar)', 'हर व्यक्ति की सैलरी (एक बार)'), p: T('Contracts mein har employee ka salary structure: basic, allowance, PF/ESI jaise katauti.', 'Contracts में हर कर्मचारी का सैलरी स्ट्रक्चर: बेसिक, अलाउंस, PF/ESI जैसी कटौती।'), links: [L('/hrm/payroll/contracts', 'Contracts', 'कॉन्ट्रैक्ट'), L('/hrm/salary', 'Salary Structure', 'सैलरी स्ट्रक्चर')] },
        { role: 'office', t: T('Haazri saaf karo', 'हाज़िरी साफ़ करें'), p: T('Mahine ke ant se pehle: jo clock out bhool gaye unka Shift Log mein samay (kaaran ke saath), baaki chhutti approve.', 'महीने के अंत से पहले: जो क्लॉक आउट भूल गए उनका Shift Log में समय (कारण के साथ), बाक़ी छुट्टी मंज़ूर।'), why: T('Payslip haazri se banti hai. Galat haazri = galat salary.', 'पे-स्लिप हाज़िरी से बनती है। ग़लत हाज़िरी = ग़लत सैलरी।'), links: [L('/attendance/shifts', 'Shift Log', 'शिफ़्ट लॉग'), L('/attendance/grid', 'Monthly Grid', 'मंथली ग्रिड')] },
        { role: 'office', t: T('Travel allowance', 'यात्रा भत्ता'), p: T('Travel Allowance → kisko dena hai tick → "Raise (n) claims" → normal approval → Encashments & Reimbursements se paisa.', 'Travel Allowance → किसको देना है टिक → "Raise (n) claims" → सामान्य मंज़ूरी → Encashments & Reimbursements से पैसा।'), demo: T('Ravi 412 km bike @ ₹3 = ₹1,236.', 'रवि 412 किमी बाइक @ ₹3 = ₹1,236।'), links: [L('/hrm/payroll/travel', 'Travel Allowance', 'यात्रा भत्ता'), L('/hrm/payroll/claims', 'Encashments & Reimbursements', 'एनकैशमेंट और रीइम्बर्समेंट')] },
        { role: 'owner', shot: 'payroll', t: T('Payroll generate → check', 'पेरोल generate → जाँच'), p: T('Payroll Dashboard → mahina → generate. Har payslip mein din, chhutti, loan EMI dekho. Draft mein galti ho to theek karke dobara generate.', 'Payroll Dashboard → महीना → generate। हर पे-स्लिप में दिन, छुट्टी, लोन EMI देखें। ड्राफ़्ट में ग़लती हो तो ठीक करके दोबारा generate।'), links: [L('/hrm/payroll', 'Payroll Dashboard', 'पेरोल डैशबोर्ड')] },
        { role: 'owner', t: T('Process → Paid', 'Process → Paid'), p: T('"Process payroll" dabate hi run pakka aur lock ho jaata hai, aur loan ki EMI kat jaati hai. Paisa dene ke baad "Mark as paid".', '"Process payroll" दबाते ही रन पक्का और लॉक हो जाता है, और लोन की EMI कट जाती है। पैसा देने के बाद "Mark as paid"।'), why: T('Process ke baad koi payslip chupke se nahi badal sakti - jo employee ko di ya sarkar ko bheji, wahi rahegi.', 'Process के बाद कोई पे-स्लिप चुपके से नहीं बदल सकती - जो कर्मचारी को दी या सरकार को भेजी, वही रहेगी।') },
      ] },
    ],
  },
  {
    id: 'hr-life', level: 'office', part: P.people,
    title: T('Naukri ka safar: bharti se exit tak', 'नौकरी का सफ़र: भर्ती से एग्ज़िट तक'),
    purpose: T('Naya technician rakhna, use shuru karwana, aur kabhi koi chhode to saaf vidaai.', 'नया टेक्नीशियन रखना, उसे शुरू करवाना, और कभी कोई छोड़े तो साफ़ विदाई।'),
    blocks: [
      { k: 'flow', title: T('Bharti', 'भर्ती'), nodes: [
        { role: 'office', t: T('Applied', 'आवेदन') },
        { role: 'office', t: T('Screening', 'छँटाई') },
        { role: 'office', t: T('Interview', 'इंटरव्यू') },
        { role: 'office', t: T('Offer', 'ऑफ़र') },
        { role: 'office', t: T('Hired', 'रखा गया') },
        { role: 'owner', t: T('User banaya', 'यूज़र बनाया') },
        { role: 'office', t: T('Onboarding', 'ऑनबोर्डिंग'), sub: T('checklist', 'चेकलिस्ट') },
        { role: 'office', t: T('Confirmed', 'कन्फ़र्म') },
      ], foot: T('Candidate ek-ek stage aage badhta hai; "Rejected" kisi bhi stage se.', 'उम्मीदवार एक-एक स्टेज आगे बढ़ता है; "Rejected" किसी भी स्टेज से।') },
      { k: 'steps', items: [
        { role: 'office', t: T('Bharti', 'भर्ती'), p: T('Recruitment → opening → candidate → stage aage badhao, interview tay karo, note likho.', 'Recruitment → ओपनिंग → उम्मीदवार → स्टेज आगे बढ़ाएँ, इंटरव्यू तय करें, नोट लिखें।'), demo: T('"Technician - Installation": 6 candidate, 1 hired.', '"Technician - Installation": 6 उम्मीदवार, 1 रखा गया।'), links: [L('/hrm/recruitment', 'Recruitment', 'भर्ती'), L('/hrm/recruitment/interviews', 'Interviews', 'इंटरव्यू')] },
        { role: 'owner', t: T('Login banao aur jodo', 'लॉगिन बनाएँ और जोड़ें'), p: T('Hired ke baad Users mein login banao (role + branch), phir candidate se jodo. Ye jaan-boojh kar haath ka kaam hai.', 'Hired के बाद Users में लॉगिन बनाएँ (रोल + ब्रांच), फिर उम्मीदवार से जोड़ें। ये जान-बूझकर हाथ का काम है।'), links: [L('/settings/users', 'Users', 'यूज़र')] },
        { role: 'office', t: T('Onboarding', 'ऑनबोर्डिंग'), p: T('Onboarding → joiner ki details → onboarding checklist apne aap banti hai - har kaam tick karo. Probation ke baad "confirmed".', 'Onboarding → नए कर्मचारी की डिटेल → ऑनबोर्डिंग चेकलिस्ट अपने आप बनती है - हर काम टिक करें। प्रोबेशन के बाद "confirmed"।'), links: [L('/hrm/onboarding', 'Onboarding', 'ऑनबोर्डिंग')] },
        { role: 'office', t: T('Koi chhode: offboarding', 'कोई छोड़े: ऑफ़बोर्डिंग'), p: T('Employee resignation deta hai (notice, aakhri din) → manager accept → exit checklist apne aap → aakhri din "complete": login band, itihaas surakshit.', 'कर्मचारी इस्तीफ़ा देता है (नोटिस, आख़िरी दिन) → मैनेजर accept → एग्ज़िट चेकलिस्ट अपने आप → आख़िरी दिन "complete": लॉगिन बंद, इतिहास सुरक्षित।'), why: T('Login band hota hai, delete nahi - uske saare job, bill aur haazri ka record bacha rehta hai. Laptop wapas na aaya ho to bhi checklist mein dikhta rehta hai.', 'लॉगिन बंद होता है, डिलीट नहीं - उसके सारे जॉब, बिल और हाज़िरी का रिकॉर्ड बचा रहता है। लैपटॉप वापस न आया हो तो भी चेकलिस्ट में दिखता रहता है।'), links: [L('/hrm/offboarding', 'Offboarding', 'ऑफ़बोर्डिंग')] },
      ] },
    ],
  },
  {
    id: 'helpdesk', level: 'field', part: P.people,
    title: T('Helpdesk aur company ka saamaan', 'हेल्पडेस्क और कंपनी का सामान'),
    purpose: T('Staff ki andar ki dikkat (IT, HR, office) - customer ki complaint se alag.', 'स्टाफ़ की अंदर की दिक़्क़त (IT, HR, ऑफ़िस) - ग्राहक की शिकायत से अलग।'),
    blocks: [
      { k: 'states', title: T('Ticket ke status', 'टिकट के स्टेटस'), states: [
        { code: 'open', t: T('Open', 'खुला'), who: T('Staff ne daala', 'स्टाफ़ ने डाला'), tone: 'new' },
        { code: 'in_progress', t: T('In progress', 'काम चालू'), who: T('Kisi ko diya', 'किसी को दिया'), tone: 'work' },
        { code: 'resolved', t: T('Resolved', 'हल'), who: T('Theek kiya', 'ठीक किया'), tone: 'done' },
        { code: 'closed', t: T('Closed', 'बंद'), who: T('Band', 'बंद'), tone: 'end' },
      ], side: [T('Theek nahi hua to dono taraf se dobara khul sakta hai (Open).', 'ठीक नहीं हुआ तो दोनों तरफ़ से दोबारा खुल सकता है (Open)।')] },
      { k: 'steps', items: [
        { role: 'store', t: T('Ticket daalo', 'टिकट डालें'), p: T('Helpdesk → category (IT, HR...) → dikkat. Apna ticket sirf aap aur helpdesk wale dekhte hain.', 'हेल्पडेस्क → कैटेगरी (IT, HR...) → दिक़्क़त। अपना टिकट सिर्फ़ आप और हेल्पडेस्क वाले देखते हैं।'), demo: T('Sunil: "barcode scanner kaam nahi kar raha".', 'सुनील: "बारकोड स्कैनर काम नहीं कर रहा"।'), links: [L('/helpdesk', 'Helpdesk', 'हेल्पडेस्क')] },
        { role: 'office', t: T('Assign → hal → band', 'Assign → हल → बंद'), p: T('Ticket kisi ko do (apne aap In progress), theek hone par Resolved, phir Closed.', 'टिकट किसी को दें (अपने आप In progress), ठीक होने पर Resolved, फिर Closed।'), links: [L('/helpdesk', 'Helpdesk', 'हेल्पडेस्क')] },
        { role: 'office', t: T('Company ka saamaan', 'कंपनी का सामान'), p: T('Assets mein laptop, phone, toolkit - kiske paas hai. Exit ke waqt isi se wapas lena yaad rehta hai.', 'Assets में लैपटॉप, फ़ोन, टूलकिट - किसके पास है। एग्ज़िट के समय इसी से वापस लेना याद रहता है।'), links: [L('/assets', 'Assets', 'एसेट्स')] },
      ] },
    ],
  },

  // ================================================================ day
  {
    id: 'day', level: 'field', part: P.day,
    title: T('Demo din: subah 9 se shaam 7:30 tak', 'डेमो दिन: सुबह 9 से शाम 7:30 तक'),
    purpose: T(
      'Upar ke dono flow ek hi din mein, ghante ke hisaab se. Apna role chuno - sirf aapke kaam dikhenge.',
      'ऊपर के दोनों फ़्लो एक ही दिन में, घंटे के हिसाब से। अपना रोल चुनें - सिर्फ़ आपके काम दिखेंगे।',
    ),
    blocks: [
      { k: 'timeline', items: [
        { time: '09:00', role: 'owner', t: T('Dashboard', 'डैशबोर्ड'), p: T('Khule job, kisse kitna lena hai (kitne din purana), kisko dena hai.', 'खुले जॉब, किससे कितना लेना है (कितने दिन पुराना), किसको देना है।'), demo: T('Rajesh: 3 job khule, ₹42,000 lena baaki.', 'राजेश: 3 जॉब खुले, ₹42,000 लेना बाक़ी।'), links: [L('/dashboard', 'Dashboard', 'डैशबोर्ड')] },
        { time: '09:25', role: 'tech', t: T('Clock in', 'क्लॉक इन'), p: T('Phone par "Clock in". Ab se Clock out tak location darj hogi.', 'फ़ोन पर "Clock in"। अब से क्लॉक आउट तक लोकेशन दर्ज होगी।'), demo: T('Ravi aur Imran.', 'रवि और इमरान।'), phone: true },
        { time: '09:30', role: 'office', t: T('Kaun aaya', 'कौन आया'), p: T('Team Today: kaun shift par, kahan. Daily Checklist par tick.', 'Team Today: कौन शिफ़्ट पर, कहाँ। डेली चेकलिस्ट पर टिक।'), links: [L('/attendance/team-today', 'Team Today', 'टीम टुडे'), L('/attendance/checklist', 'Daily Checklist', 'डेली चेकलिस्ट')] },
        { time: '09:40', role: 'sales', t: T('Follow-up + quotation', 'फ़ॉलो-अप + कोटेशन'), p: T('Aaj ke follow-up. Green Valley ko quotation WhatsApp par.', 'आज के फ़ॉलो-अप। ग्रीन वैली को कोटेशन WhatsApp पर।'), demo: T('Amit: QT-0041, ₹13,216.', 'अमित: QT-0041, ₹13,216।'), links: [L('/crm/leads', 'Leads', 'लीड्स'), L('/quotation', 'Quotations', 'कोटेशन')] },
        { time: '10:00', role: 'office', t: T('Complaint aayi', 'शिकायत आई'), p: T('Sharma Medical ka phone - complaint darj, High.', 'शर्मा मेडिकल का फ़ोन - शिकायत दर्ज, High।'), demo: T('Pooja: CMP-0113.', 'पूजा: CMP-0113।'), links: [L('/services/complaints', 'Complaints', 'शिकायतें')] },
        { time: '10:05', role: 'office', t: T('Imran ko diya', 'इमरान को दिया'), p: T('Technician chuna - phone par turant.', 'टेक्नीशियन चुना - फ़ोन पर तुरंत।') },
        { time: '10:10', role: 'tech', t: T('Accept + visit 11 baje', 'स्वीकार + विज़िट 11 बजे'), p: T('"Accept job" → "Book a visit".', '"Accept job" → "Book a visit"।'), demo: T('Imran.', 'इमरान।'), phone: true },
        { time: '10:30', role: 'sales', t: T('Haan mil gayi → order', 'हाँ मिल गई → ऑर्डर'), p: T('Quotation → "Convert to Order" → Sales order.', 'कोटेशन → "Convert to Order" → सेल्स ऑर्डर।'), demo: T('Amit: SO-0019.', 'अमित: SO-0019।'), links: [L('/sales/orders', 'Sales Orders', 'सेल्स ऑर्डर')] },
        { time: '10:45', role: 'office', t: T('Installation job', 'इंस्टॉलेशन जॉब'), p: T('Order ke menu se "Create installation job" → Ravi ko diya.', 'ऑर्डर के मेन्यू से "Create installation job" → रवि को दिया।'), demo: T('CMP-0112.', 'CMP-0112।') },
        { time: '10:50', role: 'tech', t: T('Accept + visit 2 baje', 'स्वीकार + विज़िट 2 बजे'), p: T('Ravi job accept karke samay rakhta hai.', 'रवि जॉब स्वीकार करके समय रखता है।'), phone: true },
        { time: '10:55', role: 'tech', t: T('On my way', 'On my way'), p: T('Imran nikla. Customer ko "Technician on the way".', 'इमरान निकला। ग्राहक को "Technician on the way"।'), phone: true },
        { time: '11:00', role: 'office', t: T('Installation ke parts', 'इंस्टॉलेशन के पार्ट्स'), p: T('Pooja ne CMP-0112 par 3 Bullet + 1 Dome + 1 DVR ka challan banaya → "Send for approval".', 'पूजा ने CMP-0112 पर 3 बुलेट + 1 डोम + 1 DVR का चालान बनाया → "Send for approval"।'), links: [L('/services/complaints', 'Jobs', 'जॉब')] },
        { time: '11:10', role: 'store', t: T('Approve + DVR serial', 'मंज़ूर + DVR सीरियल'), p: T('Sunil ne My Desk mein approve kiya → "Parts counter" mein DVR ka serial chuna → issue (GDN) → maal Ravi ko.', 'सुनील ने My Desk में मंज़ूर किया → "Parts counter" में DVR का सीरियल चुना → issue (GDN) → माल रवि को।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क'), L('/goods-dispatch/job-parts', 'Parts counter', 'पार्ट्स काउंटर')] },
        { time: '11:15', role: 'tech', t: T('Working on site', 'Working on site'), p: T('Dukaan se 50 m ke andar - check pass. EzyKam kharab mila.', 'दुकान से 50 मीटर के अंदर - चेक पास। EzyKam ख़राब मिला।'), phone: true },
        { time: '11:30', role: 'tech', t: T('Challan + kharab part', 'चालान + ख़राब पार्ट'), p: T('Naya EzyKam + Dome → "Send for approval". Purana EzyKam "Log faulty part".', 'नया EzyKam + डोम → "Send for approval"। पुराना EzyKam "Log faulty part"।'), phone: true },
        { time: '11:35', role: 'store', t: T('Approve', 'मंज़ूर'), p: T('My Desk → approve → GDN apne aap. Imran "Leave site" karke store se maal le gaya, wapas aakar phir "Working on site".', 'My Desk → मंज़ूर → GDN अपने आप। इमरान "Leave site" करके स्टोर से माल ले गया, वापस आकर फिर "Working on site"।'), demo: T('Sunil.', 'सुनील।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क')] },
        { time: '11:40', role: 'office', t: T('Estimate', 'एस्टिमेट'), p: T('Dome + installation ₹1,850 + GST → "Send estimate". Customer ne link par haan kaha.', 'डोम + इंस्टॉलेशन ₹1,850 + GST → "Send estimate"। ग्राहक ने लिंक पर हाँ कहा।') },
        { time: '12:30', role: 'tech', t: T('Work done → code', 'काम पूरा → कोड'), p: T('Imran: "Work done" → customer ka code → job apne aap Closed.', 'इमरान: "Work done" → ग्राहक का कोड → जॉब अपने आप बंद।'), phone: true },
        { time: '12:45', role: 'office', t: T('Bill this job', 'Bill this job'), p: T('Draft invoice → check → Issue → WhatsApp par link.', 'ड्राफ़्ट इनवॉइस → जाँच → Issue → WhatsApp पर लिंक।'), demo: T('₹2,183.', '₹2,183।'), links: [L('/invoices', 'Invoices', 'इनवॉइस')] },
        { time: '13:00', role: 'accounts', t: T('Cash receipt', 'कैश रसीद'), p: T('Sharma Medical ne cash diya → receipt → invoice par allocate.', 'शर्मा मेडिकल ने कैश दिया → रसीद → इनवॉइस पर allocate।'), demo: T('Neha: ₹2,183.', 'नेहा: ₹2,183।'), links: [L('/receipts', 'Receipts', 'रसीदें')] },
        { time: '13:45', role: 'tech', t: T('On my way → Working on site', 'On my way → Working on site'), p: T('Ravi Green Valley pahuncha, gate par GPS check pass.', 'रवि ग्रीन वैली पहुँचा, गेट पर GPS चेक पास।'), phone: true },
        { time: '17:15', role: 'tech', t: T('Work done → code', 'काम पूरा → कोड'), p: T('4 camera chalu, photo li, Kulkarni ji ka code → Closed.', '4 कैमरे चालू, फ़ोटो ली, कुलकर्णी जी का कोड → बंद।'), phone: true },
        { time: '17:30', role: 'accounts', t: T('Invoice + UPI', 'इनवॉइस + UPI'), p: T('Order → "Raise invoice" → Issue. ₹8,000 UPI ki receipt.', 'ऑर्डर → "Raise invoice" → Issue। ₹8,000 UPI की रसीद।'), demo: T('INV-0088 ₹13,216; bakaya ₹5,216.', 'INV-0088 ₹13,216; बकाया ₹5,216।'), links: [L('/invoices', 'Invoices', 'इनवॉइस'), L('/receipts', 'Receipts', 'रसीदें')] },
        { time: '18:00', role: 'store', t: T('Kharab maal + bacha maal', 'ख़राब माल + बचा माल'), p: T('Purana EzyKam aaya → Replacements mein CP Plus ko bhejne ka case. Bacha hua part wapas stock mein.', 'पुराना EzyKam आया → रिप्लेसमेंट में CP Plus को भेजने का केस। बचा हुआ पार्ट वापस स्टॉक में।'), links: [L('/services/replacements', 'Replacements', 'रिप्लेसमेंट')] },
        { time: '18:30', role: 'office', t: T('Din ka review', 'दिन का रिव्यू'), p: T('Job Board par khule job, My Desk mein baaki approval, Technician Performance.', 'जॉब बोर्ड पर खुले जॉब, My Desk में बाक़ी मंज़ूरी, टेक्नीशियन परफ़ॉर्मेंस।'), links: [L('/services/board', 'Job Board', 'जॉब बोर्ड'), L('/my/reminders', 'My Desk', 'माई डेस्क'), L('/services/technicians', 'Technician Performance', 'टेक्नीशियन परफ़ॉर्मेंस')] },
        { time: '19:00', role: 'tech', t: T('Clock out', 'क्लॉक आउट'), p: T('Din ke km apne aap gine gaye - mahine ke end mein travel allowance banta hai.', 'दिन के किमी अपने आप गिने गए - महीने के अंत में यात्रा भत्ता बनता है।'), phone: true },
        { time: '19:15', role: 'owner', t: T('Shaam ka hisaab', 'शाम का हिसाब'), p: T('Aaj ki bikri ₹15,399, collection ₹10,183, 2 job band. Kuch ajeeb lage to Activity Log.', 'आज की बिक्री ₹15,399, कलेक्शन ₹10,183, 2 जॉब बंद। कुछ अजीब लगे तो एक्टिविटी लॉग।'), links: [L('/dashboard', 'Dashboard', 'डैशबोर्ड'), L('/reports/activity-log', 'Activity Log', 'एक्टिविटी लॉग')] },
      ] },
    ],
  },

  // ================================================================ month
  {
    id: 'month-end', level: 'admin', part: P.month,
    title: T('Mahine ka ant: hisaab milana aur mahina band karna', 'महीने का अंत: हिसाब मिलाना और महीना बंद करना'),
    purpose: T(
      'Har mahine ki 1 se 5 tareekh ke beech. Isi kram mein - GST file karne se pehle sab saaf, file karne ke baad mahina band.',
      'हर महीने की 1 से 5 तारीख़ के बीच। इसी क्रम में - GST फ़ाइल करने से पहले सब साफ़, फ़ाइल करने के बाद महीना बंद।',
    ),
    blocks: [
      { k: 'flow', title: T('Mahine ke ant ka kram', 'महीने के अंत का क्रम'), nodes: [
        { role: 'accounts', t: T('Draft saaf', 'ड्राफ़्ट साफ़') },
        { role: 'accounts', t: T('Bank milao', 'बैंक मिलाएँ') },
        { role: 'store', t: T('Stock check', 'स्टॉक चेक') },
        { role: 'accounts', t: T('Bakaya + dena', 'बकाया + देना') },
        { role: 'accounts', t: T('GST report', 'GST रिपोर्ट') },
        { role: 'owner', t: T('P&L dekho', 'P&L देखें') },
        { role: 'owner', t: T('Payroll', 'पेरोल') },
        { role: 'owner', t: T('Mahina band', 'महीना बंद') },
      ] },
      { k: 'steps', items: [
        { role: 'accounts', t: T('1. Draft saaf karo', '1. ड्राफ़्ट साफ़ करें'), p: T('Invoice, bill aur receipt jo abhi draft mein hain - ya issue karo ya cancel. Draft kisi report mein nahi aata.', 'इनवॉइस, बिल और रसीद जो अभी ड्राफ़्ट में हैं - या issue करें या कैंसल। ड्राफ़्ट किसी रिपोर्ट में नहीं आता।'), links: [L('/invoices', 'Invoices', 'इनवॉइस'), L('/purchase/bills', 'Purchase Bills', 'परचेज़ बिल')] },
        { role: 'accounts', t: T('2. Bank milao', '2. बैंक मिलाएँ'), p: T('Bank statement aur Atlas ki receipts/payments milao. Jo nahi mila wo dhoondho.', 'बैंक स्टेटमेंट और एटलस की रसीदें/पेमेंट मिलाएँ। जो नहीं मिला वो ढूँढें।'), links: [L('/bank/summary', 'Bank Statement', 'बैंक स्टेटमेंट')] },
        { role: 'store', t: T('3. Stock check', '3. स्टॉक चेक'), p: T('Stock › Checks: shelf ki ginti aur serial number milte hain? Kuch expire hone wala? Fark ho to product par Adjust Stock + kaaran.', 'स्टॉक चेक: शेल्फ़ की गिनती और सीरियल नंबर मिलते हैं? कुछ एक्सपायर होने वाला? फ़र्क़ हो तो प्रोडक्ट पर Adjust Stock + कारण।'), links: [L('/reports/stock-health', 'Stock › Checks', 'स्टॉक › चेक'), L('/goods-dispatch/dead-stock', 'Dead stock & scrap', 'डेड स्टॉक और स्क्रैप')] },
        { role: 'accounts', t: T('4. Kisse lena, kisko dena', '4. किससे लेना, किसको देना'), p: T('Customer Account mein bakaya (kitne din purana), Payables mein supplier ka. Purane bakaye par phone karo.', 'Customer Account में बकाया (कितने दिन पुराना), Payables में सप्लायर का। पुराने बकाये पर फ़ोन करें।'), links: [L('/customer/account', 'Customer Account', 'ग्राहक खाता'), L('/purchase/payables', 'Payables', 'देय')] },
        { role: 'accounts', t: T('5. GST report', '5. GST रिपोर्ट'), p: T('Mahine ki GST report nikaal kar CA ko do / file karo.', 'महीने की GST रिपोर्ट निकालकर CA को दें / फ़ाइल करें।'), links: [L('/reports/gst', 'GST Computation', 'GST कंप्यूटेशन')] },
        { role: 'owner', t: T('6. Faayda-nuksaan', '6. फ़ायदा-नुक़सान'), p: T('P&L: maal, service aur AMC se kamaai, kharcha aur faayda. Balance Sheet: kya hai, kya dena hai. Salary aur kiraya tabhi aate hain jab darj hon.', 'P&L: माल, सर्विस और AMC से कमाई, ख़र्चा और फ़ायदा। बैलेंस शीट: क्या है, क्या देना है। सैलरी और किराया तभी आते हैं जब दर्ज हों।'), links: [L('/reports/profit-loss', 'Profit & Loss', 'लाभ-हानि'), L('/reports/balance-sheet', 'Balance Sheet', 'बैलेंस शीट')] },
        { role: 'owner', t: T('7. Payroll', '7. पेरोल'), p: T('Upar ka "Attendance se salary tak" chapter.', 'ऊपर का "अटेंडेंस से सैलरी तक" अध्याय।'), links: [L('/hrm/payroll', 'Payroll Dashboard', 'पेरोल डैशबोर्ड')] },
        { role: 'owner', shot: 'period-lock', t: T('8. Mahina band karo', '8. महीना बंद करें'), p: T('GST file hone ke baad Close the Books mein wo mahina lock karo.', 'GST फ़ाइल होने के बाद Close the Books में वो महीना लॉक करें।'), why: T('Lock ke baad us mahine ki tareekh ka koi naya invoice, receipt ya bill nahi ban sakta - warna file ki hui GST return aur kitaab alag ho jaati hai, aur notice aane par pata chalta hai.', 'लॉक के बाद उस महीने की तारीख़ का कोई नया इनवॉइस, रसीद या बिल नहीं बन सकता - वरना फ़ाइल की हुई GST रिटर्न और किताब अलग हो जाती है, और नोटिस आने पर पता चलता है।'), links: [L('/settings/period-lock', 'Close the Books', 'किताब बंद')] },
      ] },
    ],
  },

  // ================================================================ books
  {
    id: 'book-tech', level: 'field', part: P.books,
    title: T('Technician ki kitaab', 'टेक्नीशियन की किताब'),
    purpose: T('Roz, hafte aur mahine mein kya karna hai - sab phone par.', 'रोज़, हफ़्ते और महीने में क्या करना है - सब फ़ोन पर।'),
    blocks: [
      { k: 'steps', title: T('Roz', 'रोज़'), items: [
        { role: 'tech', t: T('Clock in, jobs dekho', 'क्लॉक इन, जॉब देखें'), p: T('Subah Clock in. My work card par aaj ke job. Naye job ko 2 ghante mein Accept ya Decline.', 'सुबह क्लॉक इन। My work कार्ड पर आज के जॉब। नए जॉब को 2 घंटे में Accept या Decline।'), phone: true },
        { role: 'tech', t: T('Har job ke step', 'हर जॉब के कदम'), p: T('Book a visit → On my way → Working on site → parts → Work done + photo → customer ka code.', 'Book a visit → On my way → Working on site → पार्ट्स → Work done + फ़ोटो → ग्राहक का कोड।'), phone: true },
        { role: 'tech', t: T('Item le jaana ho', 'आइटम ले जाना हो'), p: T('Job → Items → "Take for repair" - pickup receipt bina signal ke bhi banti hai. Item store ko do.', 'जॉब → Items → "Take for repair" - पिकअप रसीद बिना सिग्नल के भी बनती है। आइटम स्टोर को दें।'), phone: true },
        { role: 'tech', t: T('Shaam', 'शाम'), p: T('Bacha aur kharab maal store ko. Clock out.', 'बचा और ख़राब माल स्टोर को। क्लॉक आउट।'), phone: true },
      ] },
      { k: 'steps', title: T('Hafta / mahina', 'हफ़्ता / महीना'), items: [
        { role: 'tech', t: T('Apna kaam dekho', 'अपना काम देखें'), p: T('Technician Performance mein apni line: kitne job, samay, rating.', 'टेक्नीशियन परफ़ॉर्मेंस में अपनी लाइन: कितने जॉब, समय, रेटिंग।'), links: [L('/services/technicians', 'Technician Performance', 'टेक्नीशियन परफ़ॉर्मेंस')] },
        { role: 'tech', t: T('Chhutti pehle se maango', 'छुट्टी पहले से माँगें'), p: T('Phone → Requests.', 'फ़ोन → Requests।'), phone: true },
      ] },
    ],
  },
  {
    id: 'book-store', level: 'field', part: P.books,
    title: T('Store ki kitaab', 'स्टोर की किताब'),
    purpose: T('Maal kahan hai, kiske paas hai, aur ginti milti hai ya nahi.', 'माल कहाँ है, किसके पास है, और गिनती मिलती है या नहीं।'),
    blocks: [
      { k: 'steps', title: T('Roz', 'रोज़'), items: [
        { role: 'store', t: T('Subah van load', 'सुबह वैन लोड'), p: T('Har technician ki van mein din ka maal.', 'हर टेक्नीशियन की वैन में दिन का माल।'), links: [L('/van-stock', 'Van stock', 'वैन स्टॉक')] },
        { role: 'store', t: T('Din bhar challan', 'दिन भर चालान'), p: T('My Desk mein challan aate hi approve. "Parts counter" khuli rakho - serial wala maal aur stock kam wale challan wahin issue hote hain.', 'My Desk में चालान आते ही मंज़ूर। "Parts counter" खुली रखें - सीरियल वाला माल और स्टॉक कम वाले चालान वहीं issue होते हैं।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क'), L('/goods-dispatch/job-parts', 'Parts counter', 'पार्ट्स काउंटर')] },
        { role: 'store', t: T('Maal aaya to GRN', 'माल आया तो GRN'), p: T('Usi din Receive goods - kal par mat chhodo.', 'उसी दिन Receive goods - कल पर मत छोड़ें।'), links: [L('/goods-receipt', 'Goods Receipt Note', 'गुड्स रिसीट नोट')] },
        { role: 'store', t: T('Repair ke item', 'रिपेयर के आइटम'), p: T('Supplier Dispatch: "To send" ka dabba banao, supplier ka jawab likho, jo wapas aaye wo RMA receipt par lo. Late dabbe laal dikhte hain - phone karo.', 'सप्लायर डिस्पैच: "To send" का डिब्बा बनाएँ, सप्लायर का जवाब लिखें, जो वापस आए वो RMA रसीद पर लें। देर वाले डिब्बे लाल दिखते हैं - फ़ोन करें।'), links: [L('/services/dispatch', 'Supplier Dispatch', 'सप्लायर डिस्पैच')] },
        { role: 'store', t: T('Shaam hand back', 'शाम हैंड बैक'), p: T('Har van ka hisaab - kami ho to usi din batao.', 'हर वैन का हिसाब - कमी हो तो उसी दिन बताएँ।'), links: [L('/van-stock', 'Van stock', 'वैन स्टॉक')] },
      ] },
      { k: 'steps', title: T('Hafta / mahina', 'हफ़्ता / महीना'), items: [
        { role: 'store', t: T('Kam stock → PO', 'कम स्टॉक → PO'), p: T('Hafte mein ek baar reorder level se neeche wale dekho.', 'हफ़्ते में एक बार रीऑर्डर लेवल से नीचे वाले देखें।'), links: [L('/reports/product-stock', 'Stock', 'स्टॉक')] },
        { role: 'store', t: T('Kharab maal ka faisla', 'ख़राब माल का फ़ैसला'), p: T('Replacements aur Dead stock: company ko bhejo ya scrap.', 'रिप्लेसमेंट और डेड स्टॉक: कंपनी को भेजें या स्क्रैप।'), links: [L('/services/replacements', 'Replacements', 'रिप्लेसमेंट'), L('/goods-dispatch/dead-stock', 'Dead stock', 'डेड स्टॉक')] },
        { role: 'store', t: T('Mahine ki ginti', 'महीने की गिनती'), p: T('Stock › Checks + shelf ki ginti.', 'स्टॉक चेक + शेल्फ़ की गिनती।'), links: [L('/reports/stock-health', 'Stock › Checks', 'स्टॉक › चेक')] },
      ] },
    ],
  },
  {
    id: 'book-office', level: 'office', part: P.books,
    title: T('Office / Manager ki kitaab', 'ऑफ़िस / मैनेजर की किताब'),
    purpose: T('Koi job atke nahi, koi customer intezaar na kare.', 'कोई जॉब अटके नहीं, कोई ग्राहक इंतज़ार न करे।'),
    blocks: [
      { k: 'steps', title: T('Roz', 'रोज़'), items: [
        { role: 'office', shot: 'job-board', t: T('Subah', 'सुबह'), p: T('Team Today (kaun aaya), Daily Checklist, Job Board par kal ke khule job.', 'Team Today (कौन आया), डेली चेकलिस्ट, जॉब बोर्ड पर कल के खुले जॉब।'), links: [L('/attendance/team-today', 'Team Today', 'टीम टुडे'), L('/services/board', 'Job Board', 'जॉब बोर्ड')] },
        { role: 'office', t: T('Din bhar', 'दिन भर'), p: T('Nayi complaint → turant technician ko. Laal (samay seema chhooti) job pehle. Estimate bhejo, job band karo, Bill this job.', 'नई शिकायत → तुरंत टेक्नीशियन को। लाल (समय सीमा छूटी) जॉब पहले। एस्टिमेट भेजें, जॉब बंद करें, Bill this job।'), links: [L('/services/complaints', 'Complaints', 'शिकायतें')] },
        { role: 'office', t: T('Wapas aaye item', 'वापस आए आइटम'), p: T('Supplier Dispatch → "Back - hand to customer": har complaint par "Hand back" (GDN), refit visit, phir "Bill this job".', 'सप्लायर डिस्पैच → "Back - hand to customer": हर शिकायत पर "Hand back" (GDN), रीफ़िट विज़िट, फिर "Bill this job"।'), links: [L('/services/dispatch', 'Supplier Dispatch', 'सप्लायर डिस्पैच')] },
        { role: 'office', t: T('Shaam', 'शाम'), p: T('My Desk khaali karo - approval, reminder.', 'My Desk ख़ाली करें - मंज़ूरी, रिमाइंडर।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क')] },
      ] },
      { k: 'steps', title: T('Hafta / mahina', 'हफ़्ता / महीना'), items: [
        { role: 'office', t: T('Technician review', 'टेक्नीशियन रिव्यू'), p: T('Technician Performance: der se accept, dobara khule job, kam rating.', 'टेक्नीशियन परफ़ॉर्मेंस: देर से स्वीकार, दोबारा खुले जॉब, कम रेटिंग।'), links: [L('/services/technicians', 'Technician Performance', 'टेक्नीशियन परफ़ॉर्मेंस')] },
        { role: 'office', t: T('AMC renewal', 'AMC रिन्यूअल'), p: T('Agle mahine khatam hone wale contract - customer ko phone.', 'अगले महीने ख़त्म होने वाले कॉन्ट्रैक्ट - ग्राहक को फ़ोन।'), links: [L('/services/amc', 'Maintenance Contracts', 'मेंटेनेंस कॉन्ट्रैक्ट')] },
        { role: 'office', t: T('Haazri saaf', 'हाज़िरी साफ़'), p: T('Mahine ke ant se pehle Shift Log aur chhutti.', 'महीने के अंत से पहले Shift Log और छुट्टी।'), links: [L('/attendance/shifts', 'Shift Log', 'शिफ़्ट लॉग')] },
      ] },
    ],
  },
  {
    id: 'book-sales', level: 'office', part: P.books,
    title: T('Sales ki kitaab', 'सेल्स की किताब'),
    purpose: T('Har poochhtaachh ka follow-up, har haan ka order.', 'हर पूछताछ का फ़ॉलो-अप, हर हाँ का ऑर्डर।'),
    blocks: [
      { k: 'steps', title: T('Roz', 'रोज़'), items: [
        { role: 'sales', t: T('Aaj ke follow-up', 'आज के फ़ॉलो-अप'), p: T('Leads mein aaj ki tareekh wale - phone, note, agli tareekh.', 'लीड्स में आज की तारीख़ वाले - फ़ोन, नोट, अगली तारीख़।'), links: [L('/crm/leads', 'Leads', 'लीड्स')] },
        { role: 'sales', t: T('Quotation → order', 'कोटेशन → ऑर्डर'), p: T('Haan mili to usi din "Convert to Order". Purani quotation jo expire ho gayi - band karo ya naya daam.', 'हाँ मिली तो उसी दिन "Convert to Order"। पुरानी कोटेशन जो एक्सपायर हो गई - बंद करें या नया दाम।'), links: [L('/quotation', 'Quotations', 'कोटेशन'), L('/sales/orders', 'Sales Orders', 'सेल्स ऑर्डर')] },
      ] },
      { k: 'steps', title: T('Mahina', 'महीना'), items: [
        { role: 'sales', t: T('Target', 'टारगेट'), p: T('My Target: mahine ka target aur kahan tak pahunche.', 'My Target: महीने का टारगेट और कहाँ तक पहुँचे।'), links: [L('/my/target', 'My Target', 'मेरा टारगेट')] },
      ] },
    ],
  },
  {
    id: 'book-accounts', level: 'office', part: P.books,
    title: T('Accounts ki kitaab', 'अकाउंट्स की किताब'),
    purpose: T('Har paisa sahi jagah, har bakaya saamne.', 'हर पैसा सही जगह, हर बकाया सामने।'),
    blocks: [
      { k: 'steps', title: T('Roz', 'रोज़'), items: [
        { role: 'accounts', t: T('Paisa aaya to usi din receipt', 'पैसा आया तो उसी दिन रसीद'), p: T('Har UPI, cash, cheque ki receipt - aur sahi invoice par allocate.', 'हर UPI, कैश, चेक की रसीद - और सही इनवॉइस पर allocate।'), links: [L('/receipts', 'Receipts', 'रसीदें')] },
        { role: 'accounts', t: T('Invoice issue', 'इनवॉइस issue'), p: T('Band job aur deliver hue order ke invoice issue karke WhatsApp par.', 'बंद जॉब और डिलीवर हुए ऑर्डर के इनवॉइस issue करके WhatsApp पर।'), links: [L('/invoices', 'Invoices', 'इनवॉइस')] },
        { role: 'accounts', t: T('Supplier bill', 'सप्लायर बिल'), p: T('Aate hi darj aur post.', 'आते ही दर्ज और पोस्ट।'), links: [L('/purchase/bills', 'Purchase Bills', 'परचेज़ बिल')] },
      ] },
      { k: 'steps', title: T('Hafta / mahina', 'हफ़्ता / महीना'), items: [
        { role: 'accounts', t: T('Bakaya ki list', 'बकाया की सूची'), p: T('Hafte mein ek baar: 30 din se purana bakaya - phone ya reminder.', 'हफ़्ते में एक बार: 30 दिन से पुराना बकाया - फ़ोन या रिमाइंडर।'), links: [L('/customer/account', 'Customer Account', 'ग्राहक खाता')] },
        { role: 'accounts', t: T('Mahine ka ant', 'महीने का अंत'), p: T('Upar ka "Mahine ka ant" chapter, step 1 se 5.', 'ऊपर का "महीने का अंत" अध्याय, कदम 1 से 5।'), links: [L('/reports/gst', 'GST Computation', 'GST कंप्यूटेशन')] },
      ] },
    ],
  },
  {
    id: 'book-owner', level: 'admin', part: P.books,
    title: T('Maalik ki kitaab', 'मालिक की किताब'),
    purpose: T('Din mein 15 minute - poora business haath mein.', 'दिन में 15 मिनट - पूरा बिज़नेस हाथ में।'),
    blocks: [
      { k: 'steps', title: T('Roz', 'रोज़'), items: [
        { role: 'owner', shot: 'dashboard', t: T('Subah 5 minute', 'सुबह 5 मिनट'), p: T('Dashboard: khule job, kisse kitna lena hai, kisko dena hai.', 'डैशबोर्ड: खुले जॉब, किससे कितना लेना है, किसको देना है।'), links: [L('/dashboard', 'Dashboard', 'डैशबोर्ड')] },
        { role: 'owner', t: T('Din mein', 'दिन में'), p: T('Phone par Urgent approval (discount, refund) - call ki tarah bajta hai.', 'फ़ोन पर Urgent मंज़ूरी (डिस्काउंट, रिफ़ंड) - कॉल की तरह बजता है।'), phone: true },
        { role: 'owner', t: T('Shaam 10 minute', 'शाम 10 मिनट'), p: T('Aaj ki bikri, collection, band job. Kuch ajeeb lage to Activity Log.', 'आज की बिक्री, कलेक्शन, बंद जॉब। कुछ अजीब लगे तो एक्टिविटी लॉग।'), links: [L('/dashboard', 'Dashboard', 'डैशबोर्ड'), L('/reports/activity-log', 'Activity Log', 'एक्टिविटी लॉग')] },
      ] },
      { k: 'steps', title: T('Hafta / mahina', 'हफ़्ता / महीना'), items: [
        { role: 'owner', t: T('Hafta', 'हफ़्ता'), p: T('Bakaya, technician performance, van ki kami.', 'बकाया, टेक्नीशियन परफ़ॉर्मेंस, वैन की कमी।'), links: [L('/customer/account', 'Customer Account', 'ग्राहक खाता'), L('/services/technicians', 'Technician Performance', 'टेक्नीशियन परफ़ॉर्मेंस')] },
        { role: 'owner', t: T('Mahina', 'महीना'), p: T('P&L, payroll process + paid, GST ke baad mahina band.', 'P&L, पेरोल प्रोसेस + पेड, GST के बाद महीना बंद।'), links: [L('/reports/profit-loss', 'Profit & Loss', 'लाभ-हानि'), L('/settings/period-lock', 'Close the Books', 'किताब बंद')] },
        { role: 'owner', t: T('Kaun kya badal raha hai', 'कौन क्या बदल रहा है'), p: T('Device Management: koi galat jagah se login to turant band karo.', 'डिवाइस मैनेजमेंट: कोई ग़लत जगह से लॉगिन तो तुरंत बंद करें।'), links: [L('/settings/login-sessions', 'Device Management', 'डिवाइस मैनेजमेंट')] },
      ] },
    ],
  },

  // ================================================================ help
  {
    id: 'mistakes', level: 'field', part: P.help,
    title: T('Aam galtiyan aur unka ilaaj', 'आम ग़लतियाँ और उनका इलाज'),
    purpose: T('Jo galtiyan pehle mahine mein sabse zyada hoti hain.', 'जो ग़लतियाँ पहले महीने में सबसे ज़्यादा होती हैं।'),
    blocks: [
      { k: 'steps', items: [
        { role: 'tech', t: T('"Working on site" nahi dab raha', '"Working on site" नहीं दब रहा'), p: T('Site se 50 m door ho, ya GPS kamzor hai. Bahar aakar try karo, ya "Ask manager for an override". Nakli location app chal raha ho to hamesha mana.', 'साइट से 50 मीटर दूर हैं, या GPS कमज़ोर है। बाहर आकर कोशिश करें, या "Ask manager for an override"। नकली लोकेशन ऐप चल रहा हो तो हमेशा मना।'), phone: true },
        { role: 'tech', t: T('Challan ka button nahi dikh raha', 'चालान का बटन नहीं दिख रहा'), p: T('Challan sirf "Working on site" ke dauraan banta hai. Ya aapki company ne ye kaam store ko diya hai - tab "Your office raises challans here" dikhega; store ko batao kya chahiye.', 'चालान सिर्फ़ "Working on site" के दौरान बनता है। या आपकी कंपनी ने ये काम स्टोर को दिया है - तब "Your office raises challans here" दिखेगा; स्टोर को बताएँ क्या चाहिए।'), phone: true },
        { role: 'store', t: T('Approve hua par GDN nahi bana', 'मंज़ूर हुआ पर GDN नहीं बना'), p: T('Approve to hua par stock kam tha (ya maal serial wala hai) - challan "Parts counter" mein ruka hai. Serial chuno / maal aane par issue karo.', 'मंज़ूर तो हुआ पर स्टॉक कम था (या माल सीरियल वाला है) - चालान "Parts counter" में रुका है। सीरियल चुनें / माल आने पर issue करें।'), links: [L('/goods-dispatch/job-parts', 'Parts counter', 'पार्ट्स काउंटर')] },
        { role: 'office', t: T('Job "Waiting to close" mein atka', 'जॉब "Waiting to close" में अटका'), p: T('Band karne ki approval kisi ke My Desk mein padi hai. Technician ne "Customer approved, but has no code" dabaya tha to pehle customer ko call karke note likho.', 'बंद करने की मंज़ूरी किसी के My Desk में पड़ी है। टेक्नीशियन ने "Customer approved, but has no code" दबाया था तो पहले ग्राहक को कॉल करके नोट लिखें।'), links: [L('/my/reminders', 'My Desk', 'माई डेस्क')] },
        { role: 'accounts', t: T('Paisa aaya par invoice abhi bhi bakaya', 'पैसा आया पर इनवॉइस अभी भी बकाया'), p: T('Receipt allocate nahi hui. Receipt kholo aur invoice par lagao.', 'रसीद allocate नहीं हुई। रसीद खोलें और इनवॉइस पर लगाएँ।'), links: [L('/receipts', 'Receipts', 'रसीदें')] },
        { role: 'accounts', t: T('Galat invoice ban gaya', 'ग़लत इनवॉइस बन गया'), p: T('Delete nahi hota. Draft hai to badlo; issue ho chuka to kaaran likh kar revision, ya credit note.', 'डिलीट नहीं होता। ड्राफ़्ट है तो बदलें; issue हो चुका तो कारण लिखकर रिविज़न, या क्रेडिट नोट।'), links: [L('/invoices', 'Invoices', 'इनवॉइस'), L('/credit-notes', 'Credit Notes', 'क्रेडिट नोट')] },
        { role: 'owner', t: T('Number kam dikh raha hai', 'संख्या कम दिख रही है'), p: T('Pehle dekho koi cheez draft mein to nahi. Draft kisi report mein nahi aata.', 'पहले देखें कोई चीज़ ड्राफ़्ट में तो नहीं। ड्राफ़्ट किसी रिपोर्ट में नहीं आता।'), links: [L('/dashboard', 'Dashboard', 'डैशबोर्ड')] },
      ] },
      { k: 'note', tone: 'good', text: T(
        'Koi sawaal is kitaab mein nahi mila? Bagal wali Handbook mein har screen ka FAQ hai, aur Ctrl+K se koi bhi number ya naam dhoondh sakte ho.',
        'कोई सवाल इस किताब में नहीं मिला? बगल वाली हैंडबुक में हर स्क्रीन का FAQ है, और Ctrl+K से कोई भी नंबर या नाम ढूँढ सकते हैं।',
      ) },
    ],
  },
];

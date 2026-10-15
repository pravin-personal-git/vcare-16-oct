'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { landingLeadAction } from './actions';
import {
  Reveal, useCountUp, useLoop, usePointerGlow, useReveal, useScrollProgress,
} from './motion';
import './landing.css';

/**
 * THE LANDING PAGE (rebuilt 10 Oct 2026).
 *
 * Pravin on what was here before: "so apathetic, just a random AI slop ...
 * build it fully interactive and crazy and in a modern way". He was right.
 * It was a stack of static boxes that could have been any SaaS on earth, and
 * it was the one page a stranger meets us on.
 *
 * WHAT THIS PAGE HAS TO DO, in order: say what Vcare is in four seconds,
 * SHOW the one thing that is actually hard to explain in words - that an
 * enquiry becomes a quotation becomes an order becomes a bill becomes the
 * books, with nothing typed twice - and then let somebody touch it before
 * they talk to a salesperson.
 *
 * So the centre of the page is a pipeline that plays by itself (FlowPipeline).
 * Not a picture of a flow: the document number changes, the money appears, a
 * pulse travels down the wire, and the next node lights. That is the product.
 *
 * MOTION IS EARNED OR IT IS NOT THERE. Everything moves either because it is
 * showing a sequence (the pipeline, the module showcase), because it marks
 * arrival (reveal on scroll, counting figures), or because it invites a touch
 * (the pointer glow, the sheen on the button). Nothing loops just to be busy.
 * `lib/home/motion` and `landing.css` both go completely still under
 * `prefers-reduced-motion`, and the page still says everything it says.
 *
 * NO ANIMATION LIBRARY - see the note in motion.tsx. The whole page is
 * IntersectionObserver, requestAnimationFrame and CSS keyframes.
 */

type Lang = 'en' | 'hi';
type T = { en: string; hi: string };
const t = (s: T, l: Lang) => s[l];

const MODULES: { key: string; icon: string; name: T; problem: T; fix: T; example: T; points: T[] }[] = [
  {
    key: 'sales', icon: '📈', name: { en: 'Sales', hi: 'बिक्री' },
    problem: { en: 'Enquiries get lost in WhatsApp, and quotations are typed again and again in Excel.', hi: 'पूछताछ WhatsApp में खो जाती है, और कोटेशन बार-बार Excel में बनाना पड़ता है।' },
    fix: { en: 'Every enquiry becomes a lead with a follow-up date. One click turns it into a quotation, then an order, then a GST invoice.', hi: 'हर पूछताछ एक लीड बनती है, follow-up की तारीख के साथ। एक क्लिक में कोटेशन, फिर ऑर्डर, फिर GST बिल।' },
    example: { en: 'Sharma Electricals sends a quotation on WhatsApp. The customer says yes. The order is ready in one click - nothing typed twice.', hi: 'शर्मा इलेक्ट्रिकल्स WhatsApp पर कोटेशन भेजता है। ग्राहक हाँ कहता है। एक क्लिक में ऑर्डर तैयार - कुछ दोबारा नहीं लिखना।' },
    points: [
      { en: 'GST worked out for you - CGST+SGST or IGST by state', hi: 'GST अपने आप - राज्य के हिसाब से CGST+SGST या IGST' },
      { en: 'Salesperson, targets and incentive per person', hi: 'हर व्यक्ति का सेल्सपर्सन, टारगेट और इंसेंटिव' },
      { en: 'Big discounts can wait for the owner approval', hi: 'बड़ा डिस्काउंट मालिक की मंज़ूरी के बाद ही' },
    ],
  },
  {
    key: 'stock', icon: '📦', name: { en: 'Stock', hi: 'स्टॉक' },
    problem: { en: 'Nobody knows what is really on the shelf until the customer is waiting.', hi: 'शेल्फ पर असल में क्या है, ये तब पता चलता है जब ग्राहक इंतज़ार कर रहा हो।' },
    fix: { en: 'Stock moves only with a document - bill, dispatch, return. Scan a barcode or serial number with the phone to find any unit.', hi: 'स्टॉक सिर्फ़ किसी दस्तावेज़ से हिलता है - बिल, डिस्पैच, वापसी। फ़ोन से बारकोड या सीरियल स्कैन करके कोई भी यूनिट ढूँढें।' },
    example: { en: 'Where is camera FW8318029? Type it once - see who bought it, when, and its warranty.', hi: 'कैमरा FW8318029 कहाँ है? एक बार लिखें - किसने ख़रीदा, कब, और वारंटी कब तक।' },
    points: [
      { en: 'Reorder alerts before you run out', hi: 'ख़त्म होने से पहले reorder की याद' },
      { en: 'Stock value at cost, always up to date', hi: 'लागत पर स्टॉक की क़ीमत, हमेशा ताज़ा' },
      { en: 'Van stock for technicians on the road', hi: 'रास्ते में टेक्नीशियन के लिए वैन स्टॉक' },
    ],
  },
  {
    key: 'service', icon: '🛠️', name: { en: 'Service & complaints', hi: 'सर्विस और शिकायतें' },
    problem: { en: 'Complaints come by phone, get forgotten, and you never know if the technician really went.', hi: 'शिकायतें फ़ोन पर आती हैं, भूल जाती हैं, और पता नहीं चलता टेक्नीशियन सच में गया या नहीं।' },
    fix: { en: 'Each complaint has an owner, a deadline and steps. The technician marks on site from the phone (location checked), and the job closes only with the customer OTP.', hi: 'हर शिकायत का एक ज़िम्मेदार, एक डेडलाइन और कदम होते हैं। टेक्नीशियन फ़ोन से साइट पर लगाता है (लोकेशन जाँची जाती है), और काम ग्राहक के OTP से ही बंद होता है।' },
    example: { en: 'A customer DVR stops at 9 am. By 9:05 Deepak has the job on his phone; by 12 the customer has confirmed with a code.', hi: 'ग्राहक का DVR सुबह 9 बजे बंद होता है। 9:05 तक दीपक के फ़ोन पर काम; 12 बजे तक ग्राहक कोड से पुष्टि कर देता है।' },
    points: [
      { en: 'Parts approved before they leave the store', hi: 'पार्ट्स स्टोर से निकलने से पहले मंज़ूर' },
      { en: 'AMC contracts with renewal reminders', hi: 'AMC कॉन्ट्रैक्ट, रिन्यूअल की याद के साथ' },
      { en: 'Each technician sees only their own jobs', hi: 'हर टेक्नीशियन को सिर्फ़ अपने काम दिखते हैं' },
    ],
  },
  {
    key: 'team', icon: '👥', name: { en: 'Staff, attendance & payroll', hi: 'स्टाफ़, हाज़िरी और सैलरी' },
    problem: { en: 'Attendance on paper, leave on WhatsApp, salary worked out by hand at month end.', hi: 'हाज़िरी काग़ज़ पर, छुट्टी WhatsApp पर, सैलरी महीने के आख़िर में हाथ से।' },
    fix: { en: 'Clock in from the phone inside the office area. Leave and claims are asked for in the app and approved by the manager. Payroll reads attendance and loans by itself.', hi: 'ऑफ़िस के दायरे में फ़ोन से हाज़िरी। छुट्टी और क्लेम ऐप में माँगें, मैनेजर मंज़ूर करे। सैलरी हाज़िरी और लोन ख़ुद पढ़ती है।' },
    example: { en: 'A staff loan of ₹20,000 at ₹2,000 a month comes off each payslip and closes itself after the tenth.', hi: '₹20,000 का लोन, ₹2,000 महीना - हर सैलरी स्लिप से कटता है और दसवें महीने ख़ुद बंद।' },
    points: [
      { en: 'Kilometres travelled by field staff', hi: 'फ़ील्ड स्टाफ़ ने कितने किलोमीटर चले' },
      { en: 'PF, ESIC and TDS on the payslip', hi: 'सैलरी स्लिप पर PF, ESIC और TDS' },
      { en: 'Reporting line decides who approves leave', hi: 'किसकी छुट्टी कौन मंज़ूर करे, रिपोर्टिंग लाइन से' },
    ],
  },
  {
    key: 'money', icon: '💰', name: { en: 'Accounts & GST', hi: 'हिसाब और GST' },
    problem: { en: 'Payments received, payments owed and GST returns live in three different places.', hi: 'मिला हुआ पैसा, देना बाक़ी, और GST रिटर्न - तीन अलग जगह।' },
    fix: { en: 'Every invoice, receipt and supplier payment posts to the books by itself. GST report, profit and loss and balance sheet are always ready.', hi: 'हर बिल, रसीद और सप्लायर पेमेंट हिसाब में ख़ुद जाता है। GST रिपोर्ट, नफ़ा-नुक़सान और बैलेंस शीट हमेशा तैयार।' },
    example: { en: 'Close March after filing - nobody can back-date a bill into it by mistake.', hi: 'रिटर्न भरने के बाद मार्च बंद करें - कोई ग़लती से पुरानी तारीख़ का बिल नहीं डाल सकता।' },
    points: [
      { en: 'Who owes you, oldest first', hi: 'किस पर कितना बाक़ी, सबसे पुराना पहले' },
      { en: 'Refunds and supplier payments can need approval', hi: 'रिफ़ंड और सप्लायर पेमेंट पर मंज़ूरी लगा सकते हैं' },
      { en: 'Credit notes and returns tied to the bill', hi: 'क्रेडिट नोट और वापसी बिल से जुड़े' },
    ],
  },
  {
    key: 'shop', icon: '🛒', name: { en: 'Online shop', hi: 'ऑनलाइन दुकान' },
    problem: { en: 'Customers ask what do you have and at what price, again and again.', hi: 'ग्राहक बार-बार पूछते हैं क्या है और कितने का?' },
    fix: { en: 'Your own shop page with photos and prices, from the same product list. Customers add to a list and send an enquiry - it arrives as a lead.', hi: 'फ़ोटो और दाम के साथ आपकी अपनी दुकान, उसी प्रोडक्ट लिस्ट से। ग्राहक लिस्ट बनाकर पूछताछ भेजे - वो लीड बनकर आती है।' },
    example: { en: 'See who looked at a camera and saved it but did not ask - and call them.', hi: 'देखें किसने कैमरा देखा, सेव किया पर पूछा नहीं - और उन्हें कॉल करें।' },
    points: [
      { en: 'Reviews you approve before they show', hi: 'रिव्यू, जो आप मंज़ूर करें तभी दिखें' },
      { en: 'Wishlist and people also viewed', hi: 'विशलिस्ट और लोगों ने ये भी देखा' },
      { en: 'Works on any phone, no app needed', hi: 'किसी भी फ़ोन पर, ऐप की ज़रूरत नहीं' },
    ],
  },
];

/**
 * THE PIPELINE. One job through the whole product, in the order it happens.
 *
 * Deliberately one STORY and not six features: the thing nobody believes
 * until they see it is that the bill at step five was never typed - it is the
 * quotation from step two, which was the enquiry from step one.
 */
const FLOW: { icon: string; name: T; doc: string; note: T; tone: string }[] = [
  { icon: '💬', name: { en: 'Enquiry', hi: 'पूछताछ' }, doc: 'LEAD-114', tone: 'var(--saffron)', note: { en: 'WhatsApp from Gupta Infra, 9:04 am', hi: 'गुप्ता इन्फ़्रा का WhatsApp, सुबह 9:04' } },
  { icon: '📄', name: { en: 'Quotation', hi: 'कोटेशन' }, doc: 'QT-BR001-2026-0007', tone: 'var(--blue)', note: { en: '4 cameras + DVR. GST worked out by state.', hi: '4 कैमरे + DVR। GST राज्य के हिसाब से अपने आप।' } },
  { icon: '✅', name: { en: 'Order', hi: 'ऑर्डर' }, doc: 'SO-BR001-2026-0004', tone: 'var(--cyan)', note: { en: 'Customer said yes. One click - nothing retyped.', hi: 'ग्राहक ने हाँ कहा। एक क्लिक - कुछ दोबारा नहीं।' } },
  { icon: '🔧', name: { en: 'Job', hi: 'काम' }, doc: 'JOB-2026-0041', tone: 'var(--saffron)', note: { en: 'Deepak on site 10:30. Closed with the customer code.', hi: 'दीपक 10:30 पर साइट पर। ग्राहक के कोड से बंद।' } },
  { icon: '🧾', name: { en: 'Invoice', hi: 'बिल' }, doc: 'INV-BR001-2026-0042', tone: 'var(--blue)', note: { en: '₹1,18,000 · CGST 9% + SGST 9%', hi: '₹1,18,000 · CGST 9% + SGST 9%' } },
  { icon: '🏦', name: { en: 'The books', hi: 'हिसाब' }, doc: 'LEDGER', tone: 'var(--green)', note: { en: 'Posted by itself. Profit and GST already right.', hi: 'अपने आप हिसाब में। नफ़ा और GST पहले से सही।' } },
];

const STEPS: T[] = [
  { en: 'Complaint received', hi: 'शिकायत मिली' },
  { en: 'Technician assigned', hi: 'टेक्नीशियन तय' },
  { en: 'On the way', hi: 'रास्ते में' },
  { en: 'On site (location checked)', hi: 'साइट पर (लोकेशन जाँची)' },
  { en: 'Work done', hi: 'काम पूरा' },
  { en: 'Closed with customer OTP', hi: 'ग्राहक के OTP से बंद' },
];

const CHAOS: { before: T; after: T }[] = [
  { before: { en: 'Quotation typed again in Excel', hi: 'कोटेशन फिर से Excel में' }, after: { en: 'One click from the enquiry', hi: 'पूछताछ से एक क्लिक में' } },
  { before: { en: 'Stock counted on a Sunday', hi: 'रविवार को स्टॉक गिनना' }, after: { en: 'Always right, every document moves it', hi: 'हमेशा सही, हर दस्तावेज़ से हिलता है' } },
  { before: { en: 'Did the technician actually go?', hi: 'टेक्नीशियन सच में गया क्या?' }, after: { en: 'Location checked, closed by customer code', hi: 'लोकेशन जाँची, ग्राहक के कोड से बंद' } },
  { before: { en: 'Salary worked out by hand', hi: 'सैलरी हाथ से बनाना' }, after: { en: 'Reads attendance and loans itself', hi: 'हाज़िरी और लोन ख़ुद पढ़ती है' } },
  { before: { en: 'GST figures hunted at the last minute', hi: 'आख़िरी वक़्त पर GST के आँकड़े ढूँढना' }, after: { en: 'Report ready on any day you ask', hi: 'जिस दिन माँगो, रिपोर्ट तैयार' } },
];

const FAQ: { q: T; a: T }[] = [
  { q: { en: 'Do I need a computer?', hi: 'क्या कंप्यूटर चाहिए?' }, a: { en: 'No. Vcare works in any browser, and staff and technicians get the Vcare Android app.', hi: 'नहीं। Vcare किसी भी ब्राउज़र में चलता है, और स्टाफ़ व टेक्नीशियन के लिए Vcare का Android ऐप है।' } },
  { q: { en: 'Can I bring my old data?', hi: 'क्या पुराना डेटा आ सकता है?' }, a: { en: 'Yes. Customers, products and stock come in from Excel; we help you move.', hi: 'हाँ। ग्राहक, प्रोडक्ट और स्टॉक Excel से आ जाते हैं; हम मदद करते हैं।' } },
  { q: { en: 'Is my data safe?', hi: 'क्या मेरा डेटा सुरक्षित है?' }, a: { en: 'Each business has its own system and database. Every change is recorded with who made it.', hi: 'हर बिज़नेस का अपना सिस्टम और डेटाबेस। हर बदलाव किसने किया, दर्ज रहता है।' } },
  { q: { en: 'Can I choose only some modules?', hi: 'क्या कुछ ही मॉड्यूल ले सकते हैं?' }, a: { en: 'Yes. Start with what you need - sales, service or staff - and add the rest later.', hi: 'हाँ। जो चाहिए उससे शुरू करें - बिक्री, सर्विस या स्टाफ़ - बाक़ी बाद में।' } },
];

const INTERESTS: T[] = [
  { en: 'Sales & GST billing', hi: 'बिक्री और GST बिल' }, { en: 'Stock', hi: 'स्टॉक' }, { en: 'Service & complaints', hi: 'सर्विस और शिकायतें' },
  { en: 'Staff & payroll', hi: 'स्टाफ़ और सैलरी' }, { en: 'Accounts', hi: 'हिसाब' }, { en: 'Online shop', hi: 'ऑनलाइन दुकान' },
];

const BELT: T[] = [
  { en: 'Leads', hi: 'लीड' }, { en: 'Quotations', hi: 'कोटेशन' }, { en: 'Sales orders', hi: 'ऑर्डर' }, { en: 'GST invoices', hi: 'GST बिल' },
  { en: 'Stock & barcodes', hi: 'स्टॉक और बारकोड' }, { en: 'Service jobs', hi: 'सर्विस' }, { en: 'AMC contracts', hi: 'AMC' },
  { en: 'Attendance', hi: 'हाज़िरी' }, { en: 'Payroll', hi: 'सैलरी' }, { en: 'Approvals', hi: 'मंज़ूरी' },
  { en: 'Purchase & suppliers', hi: 'ख़रीद और सप्लायर' }, { en: 'Ledgers & P&L', hi: 'खाता और नफ़ा-नुक़सान' }, { en: 'Online shop', hi: 'ऑनलाइन दुकान' },
];

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// =========================================================================

export function LandingClient({ whatsapp }: { whatsapp: string | null }) {
  const [lang, setLang] = useState<Lang>('en');
  const L = (s: T) => t(s, lang);
  const progress = useScrollProgress();

  return (
    <div className="mos min-h-screen overflow-x-hidden" lang={lang === 'hi' ? 'hi' : 'en'}>
      {/* ---------------------------------------------------------- top bar */}
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--ink)]/95">
        {/* How far down the page you are. One pixel; it tells a long page that
            it has an end, which is most of why people keep scrolling. */}
        <div className="h-0.5 w-full bg-transparent">
          <div
            className="h-full bg-gradient-to-r from-[var(--blue)] to-[var(--cyan)] transition-[width] duration-150"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Wordmark />
          <nav className="ms-auto flex items-center gap-1 text-sm">
            {[
              { href: '#flow', label: { en: 'How it works', hi: 'कैसे चलता है' } },
              { href: '#modules', label: { en: 'Modules', hi: 'मॉड्यूल' } },
              { href: '#demo', label: { en: 'Try it', hi: 'आज़माएँ' } },
            ].map((x) => (
              <a key={x.href} href={x.href} className="hidden rounded-full px-3 py-1.5 text-[var(--muted)] transition hover:bg-white/5 hover:text-white md:inline-block">
                {L(x.label)}
              </a>
            ))}
            <div className="ms-1 inline-flex overflow-hidden rounded-full border border-[var(--line)]" role="group" aria-label="Language">
              {(['en', 'hi'] as Lang[]).map((l) => (
                <button
                  key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                  className={`px-3 py-1.5 text-micro font-bold transition ${lang === l ? 'bg-[var(--blue)] text-white' : 'text-[var(--muted)] hover:text-white'}`}
                >
                  {l === 'en' ? 'EN' : 'हिंदी'}
                </button>
              ))}
            </div>
            <Link href="/login" className="ms-1 rounded-full border border-[var(--line)] px-3.5 py-1.5 text-xs font-bold text-[var(--fg)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]">
              {L({ en: 'Sign in', hi: 'साइन इन' })}
            </Link>
          </nav>
        </div>
      </header>

      <Hero lang={lang} whatsapp={whatsapp} />
      <Belt lang={lang} />
      <FlowPipeline lang={lang} />
      <ChaosVsOrder lang={lang} />
      <ModuleShowcase lang={lang} />
      <LiveDemos lang={lang} />
      <PhoneBand lang={lang} />
      <Faq lang={lang} />
      <ContactForm lang={lang} />
      <Footer lang={lang} />
    </div>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--blue)] to-[var(--cyan)] text-base font-black text-white shadow-[0_0_20px_rgba(34,211,238,0.35)]">
        M
      </span>
      <span className="text-lg font-extrabold tracking-tight">
        MAALIK<span className="bg-gradient-to-r from-[var(--blue)] to-[var(--cyan)] bg-clip-text text-transparent"> OS</span>
      </span>
      <span className="hidden text-micro uppercase tracking-widest text-[var(--muted)] sm:inline">by N.A.I.R.</span>
    </span>
  );
}

/** A headline whose words arrive one after another. */
function Words({ text, from = 0, accent = false }: { text: string; from?: number; accent?: boolean }) {
  return (
    <>
      {text.split(' ').map((w, i) => (
        <span
          key={`${w}-${i}`}
          className={`mos-word ${accent ? 'mos-underline relative bg-gradient-to-r from-[var(--blue)] to-[var(--cyan)] bg-clip-text text-transparent' : ''}`}
          style={{ animationDelay: `${(from + i) * 70}ms` }}
        >
          {w}
          {' '}
        </span>
      ))}
    </>
  );
}

// -------------------------------------------------------------------- hero

function Hero({ lang, whatsapp }: { lang: Lang; whatsapp: string | null }) {
  const L = (s: T) => t(s, lang);
  const line1 = L({ en: 'Your whole business', hi: 'पूरा बिज़नेस' });
  const line2 = L({ en: 'in one place.', hi: 'एक ही जगह।' });
  const line3 = L({ en: 'Not five registers and ten WhatsApp groups.', hi: 'पाँच रजिस्टर और दस WhatsApp ग्रुप नहीं।' });
  const n1 = line1.split(' ').length;

  return (
    <section className="relative overflow-hidden">
      {/* the field behind everything */}
      <div className="mos-grid pointer-events-none absolute inset-0 overflow-hidden opacity-70" aria-hidden />
      <div className="mos-orb mos-orb-a left-[-8rem] top-[-6rem] h-80 w-80 bg-[var(--blue)]/25" aria-hidden />
      <div className="mos-orb mos-orb-b right-[-6rem] top-24 h-96 w-96 bg-[var(--cyan)]/16" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--ink)] to-transparent" aria-hidden />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/5 px-3 py-1.5 text-micro font-bold uppercase tracking-widest text-[var(--cyan)]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="mos-ping absolute inline-flex h-full w-full rounded-full bg-[var(--cyan)]" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--cyan)]" />
            </span>
            {L({ en: 'Built for Indian small businesses', hi: 'भारतीय छोटे व्यापार के लिए' })}
          </span>

          <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-display">
            <Words text={line1} />
            <br />
            <Words text={line2} from={n1} accent />
            <span className="mt-3 block text-xl font-bold text-[var(--muted)] sm:text-2xl">
              <Words text={line3} from={n1 + line2.split(' ').length + 1} />
            </span>
          </h1>

          <p className="mos-reveal mos-in mt-6 max-w-xl text-base text-[var(--muted)] sm:text-lg" style={{ transitionDelay: '600ms' }}>
            {L({
              en: 'Leads, quotations with GST, stock, service jobs, attendance, payroll, accounts and an online shop. One system, on the web and on the phone.',
              hi: 'लीड, GST वाले कोटेशन, स्टॉक, सर्विस, हाज़िरी, सैलरी, हिसाब और ऑनलाइन दुकान। एक ही सिस्टम - वेब पर भी, फ़ोन पर भी।',
            })}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#contact"
              className="mos-shine relative overflow-hidden rounded-full bg-gradient-to-r from-[var(--blue)] to-[var(--cyan)] px-7 py-3.5 text-base font-bold text-[#04101f] shadow-[0_8px_30px_rgba(34,211,238,0.3)] transition hover:scale-[1.03]"
            >
              <span className="relative z-10">{L({ en: 'Book a free demo', hi: 'मुफ़्त डेमो बुक करें' })}</span>
            </a>
            <a href="#flow" className="rounded-full border border-[var(--line)] px-6 py-3.5 text-base font-bold text-[var(--fg)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]">
              {L({ en: 'See how it works', hi: 'देखें कैसे चलता है' })} ↓
            </a>
            {whatsapp && (
              <a
                href={`https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(lang === 'hi' ? 'नमस्ते, मुझे Vcare के बारे में जानना है।' : 'Hello, I would like to know about Vcare.')}`}
                target="_blank" rel="noreferrer"
                className="rounded-full border border-[var(--green)]/50 px-5 py-3.5 text-base font-bold text-[var(--green)] transition hover:bg-[var(--green)]/10"
              >
                WhatsApp
              </a>
            )}
          </div>
        </div>

        <HeroPanel lang={lang} />
      </div>
    </section>
  );
}

/** The morning dashboard, alive: figures count up and one alert cycles. */
function HeroPanel({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  const [ref, seen] = useReveal<HTMLDivElement>();
  const glow = usePointerGlow<HTMLDivElement>();

  const sales = useCountUp(124500, seen, 1500);
  const jobs = useCountUp(7, seen, 900);
  const due = useCountUp(3.4, seen, 1400);
  const present = useCountUp(18, seen, 1100);

  const alerts: T[] = [
    { en: 'Waiting on you: refund ₹4,200 to Gupta Infra', hi: 'आपकी मंज़ूरी बाक़ी: गुप्ता इन्फ़्रा को ₹4,200 रिफ़ंड' },
    { en: 'Deepak reached the site at Nehru Nagar', hi: 'दीपक नेहरू नगर साइट पर पहुँचा' },
    { en: '2 cameras below reorder level', hi: '2 कैमरे reorder level से नीचे' },
    { en: 'Sharma Traders accepted QT-0007', hi: 'शर्मा ट्रेडर्स ने QT-0007 मंज़ूर किया' },
  ];
  const [a] = useLoop(alerts.length, 3200);

  const tiles = [
    { k: { en: 'Sales today', hi: 'आज की बिक्री' }, v: inr(sales), c: 'text-[var(--cyan)]' },
    { k: { en: 'Open jobs', hi: 'खुले काम' }, v: String(Math.round(jobs)), c: 'text-[var(--saffron)]' },
    { k: { en: 'Due from customers', hi: 'ग्राहकों पर बाक़ी' }, v: `₹${due.toFixed(1)} L`, c: 'text-[var(--red)]' },
    { k: { en: 'Staff present', hi: 'हाज़िर स्टाफ़' }, v: `${Math.round(present)} / 20`, c: 'text-[var(--green)]' },
  ];

  return (
    <div
      ref={(el) => { (ref as React.MutableRefObject<HTMLDivElement | null>).current = el; (glow as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      className="mos-spot relative rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-2xl"
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--red)]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--saffron)]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--green)]/70" />
        <p className="ms-2 text-micro uppercase tracking-widest text-[var(--muted)]">
          {L({ en: 'Your dashboard, every morning', hi: 'आपका डैशबोर्ड, हर सुबह' })}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {tiles.map((x) => (
          <div key={x.k.en} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4">
            <p className="text-micro uppercase tracking-wide text-[var(--muted)]">{L(x.k)}</p>
            <p className={`mt-1.5 text-2xl font-extrabold tabular-nums ${x.c}`}>{x.v}</p>
          </div>
        ))}
      </div>

      <MiniChart seen={seen} lang={lang} />

      {/* One alert at a time, remounted by key so it drops in again. */}
      <div className="mt-4 min-h-[3.25rem] rounded-2xl border border-[var(--saffron)]/30 bg-[var(--saffron)]/10 p-3">
        <p key={a} className="mos-drop text-sm text-[var(--fg)]">
          <span aria-hidden>🔔 </span>{L(alerts[a]!)}
        </p>
      </div>
    </div>
  );
}

/** Seven bars that grow when the panel arrives. Decorative, so hidden from readers. */
function MiniChart({ seen, lang }: { seen: boolean; lang: Lang }) {
  const bars = [38, 62, 45, 81, 58, 92, 70];
  return (
    <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4">
      <p className="text-micro uppercase tracking-wide text-[var(--muted)]">
        {t({ en: 'This week', hi: 'इस हफ़्ते' }, lang)}
      </p>
      <div className="mt-3 flex h-20 items-end gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <div
            key={i}
            className={`mos-bar flex-1 rounded-t-md bg-gradient-to-t from-[var(--blue)] to-[var(--cyan)] ${seen ? 'mos-bar-in' : ''}`}
            style={{ height: `${h}%`, transitionDelay: `${300 + i * 70}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- belt

function Belt({ lang }: { lang: Lang }) {
  const row = [...BELT, ...BELT];
  return (
    <div className="mos-belt-wrap relative overflow-hidden border-y border-[var(--line)] bg-[var(--panel)]/40 py-3">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[var(--ink)] to-transparent" aria-hidden />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[var(--ink)] to-transparent" aria-hidden />
      <div className="mos-belt flex w-max gap-3" aria-hidden>
        {row.map((x, i) => (
          <span key={i} className="whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-4 py-1.5 text-xs font-semibold text-[var(--muted)]">
            {t(x, lang)}
          </span>
        ))}
      </div>
      {/* The belt is decorative motion; the same list, readable, for anybody
          using a screen reader or holding the page still. */}
      <p className="sr-only">{BELT.map((x) => t(x, lang)).join(', ')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- pipeline

/**
 * THE CENTREPIECE. One job walking through the whole product, by itself.
 *
 * It loops without being asked because the point is not a diagram somebody
 * studies - it is a thing happening, glanced at while reading the sentence
 * beside it. Hovering pauses it, so anybody who DOES want to study one node
 * can. Clicking a node jumps there.
 */
function FlowPipeline({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  const [hover, setHover] = useState(false);
  const [i, setI] = useLoop(FLOW.length, 2300, hover);
  const node = FLOW[i]!;
  const n = FLOW.length;

  // The rail runs between the FIRST and LAST icon centres, not edge to edge:
  // each node sits in a 1/n column and is centred in it, so the first centre
  // is half a column in. A rail that ran the full width would stick out past
  // the nodes at both ends and read as a wire going nowhere.
  const inset = `${50 / n}%`;
  const done = `${(i / (n - 1)) * 100}%`;

  const pause = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onFocus: () => setHover(true),
    onBlur: () => setHover(false),
  };

  return (
    <section id="flow" className="relative mx-auto max-w-6xl px-4 py-20 lg:py-28">
      <Reveal>
        <p className="text-micro font-bold uppercase tracking-[0.2em] text-[var(--cyan)]">
          {L({ en: 'The whole point', hi: 'असली बात' })}
        </p>
        <h2 className="mt-3 max-w-2xl text-3xl font-black leading-tight sm:text-4xl">
          {L({ en: 'One enquiry becomes the bill, and then the books.', hi: 'एक पूछताछ ही बिल बनती है, और फिर हिसाब।' })}
        </h2>
        <p className="mt-3 max-w-2xl text-base text-[var(--muted)]">
          {L({
            en: 'Nothing here is typed twice. Watch one job travel - or hover a step to stop it and read.',
            hi: 'यहाँ कुछ भी दोबारा नहीं लिखा जाता। एक काम को चलते देखिए - या किसी कदम पर रुककर पढ़िए।',
          })}
        </p>
      </Reveal>

      <Reveal delay={120}>
        <div className="mt-14">
          <div className="relative">
            {/* ---------- the rail, on a wide screen: one line the whole way
                 across, a lit section as far as the job has got, and the
                 document itself travelling at the head of it. */}
            <div className="pointer-events-none absolute top-7 hidden h-0.5 lg:block" style={{ left: inset, right: inset }} aria-hidden>
              <span className="absolute inset-0 rounded-full bg-white/25" />
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--green)] via-[var(--blue)] to-[var(--cyan)] shadow-[0_0_10px_rgba(34,211,238,0.6)] transition-[width] duration-700 ease-out"
                style={{ width: done }}
              />
              <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--cyan)] shadow-[0_0_16px_var(--cyan)] transition-[left] duration-700 ease-out"
                style={{ left: done }}
              />
            </div>

            {/* Arrowheads, one between each pair. They are what makes a row of
                icons read as a DIRECTION rather than a menu, and they light up
                behind the job as it passes. */}
            <div className="pointer-events-none absolute inset-x-0 top-7 hidden lg:block" aria-hidden>
              {FLOW.slice(0, -1).map((f, k) => (
                <span
                  key={f.doc}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 text-base transition-colors duration-500 ${
                    k < i ? 'text-[var(--cyan)]' : 'text-white/30'
                  }`}
                  style={{ left: `${((k + 1) / n) * 100}%` }}
                >
                  ▶
                </span>
              ))}
            </div>

            {/* ---------- and on a phone, the same rail turned on its side */}
            <div className="pointer-events-none absolute bottom-7 left-6 top-7 w-0.5 lg:hidden" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-white/25" />
              <span
                className="absolute inset-x-0 top-0 rounded-full bg-gradient-to-b from-[var(--green)] via-[var(--blue)] to-[var(--cyan)] transition-[height] duration-700 ease-out"
                style={{ height: done }}
              />
            </div>

            <ol className="relative flex flex-col gap-7 lg:flex-row lg:gap-0">
              {FLOW.map((f, k) => {
                const past = k < i;
                const live = k === i;
                return (
                  <li key={f.doc} className="lg:flex-1">
                    <button
                      type="button"
                      onClick={() => setI(k)}
                      {...pause}
                      aria-current={live ? 'step' : undefined}
                      className="group flex w-full items-center gap-4 text-start lg:flex-col lg:items-center lg:gap-0 lg:text-center"
                    >
                      <span className="relative grid shrink-0 place-items-center">
                        {live && (
                          <span
                            className="mos-ping absolute h-14 w-14 rounded-2xl"
                            style={{ background: f.tone, opacity: 0.3 }}
                            aria-hidden
                          />
                        )}
                        <span
                          className={`relative grid h-14 w-14 place-items-center rounded-2xl border text-xl transition-all duration-500 ${
                            live
                              ? 'scale-110 border-transparent text-white'
                              : past
                                ? 'border-[var(--green)]/50 bg-[var(--green)]/15 text-[var(--green)]'
                                : 'border-[var(--line)] bg-[var(--panel-2)] opacity-60 group-hover:opacity-100'
                          }`}
                          style={live ? { background: f.tone, boxShadow: `0 0 30px ${f.tone}` } : undefined}
                        >
                          <span aria-hidden>{past ? '✓' : f.icon}</span>
                        </span>
                      </span>
                      <span className="lg:mt-4">
                        <span className={`block text-sm font-bold transition-colors ${live ? 'text-white' : past ? 'text-[var(--fg)]' : 'text-[var(--muted)]'}`}>
                          {L(f.name)}
                        </span>
                        <span className="mt-0.5 block font-mono text-micro tracking-tight text-[var(--muted)]/60">{f.doc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* ---------- what is happening at the step that is lit */}
          <div className="mt-12 overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6 sm:p-8">
            <div key={i} className="mos-drop">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="grid h-11 w-11 place-items-center rounded-xl text-lg"
                  style={{ background: node.tone, boxShadow: `0 0 24px ${node.tone}` }}
                  aria-hidden
                >
                  {node.icon}
                </span>
                <span className="text-xl font-extrabold">{L(node.name)}</span>
                <span className="rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-3 py-1 font-mono text-micro text-[var(--muted)]">
                  {node.doc}
                </span>
                <span className="ms-auto text-micro uppercase tracking-widest text-[var(--muted)]">
                  {L({ en: 'Step', hi: 'कदम' })} {i + 1}/{n}
                </span>
              </div>
              <p className="mt-4 text-lg text-[var(--fg)]">{L(node.note)}</p>
              {i === n - 1 && (
                <p className="mt-4 border-t border-[var(--line)] pt-4 text-sm text-[var(--green)]">
                  {L({
                    en: 'Six documents, one job, nothing retyped - and the ledger was never opened by hand.',
                    hi: 'छह दस्तावेज़, एक काम, कुछ दोबारा नहीं लिखा - और खाता हाथ से कभी खोला ही नहीं गया।',
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// -------------------------------------------------------------- comparison

function ChaosVsOrder({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  return (
    <section className="border-y border-[var(--line)] bg-[var(--panel)]/30">
      <div className="mx-auto max-w-5xl px-4 py-20">
        <Reveal>
          <h2 className="text-3xl font-black sm:text-4xl">
            {L({ en: 'What changes on day one', hi: 'पहले ही दिन क्या बदलता है' })}
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-3">
          {CHAOS.map((c, i) => (
            <Reveal key={c.before.en} delay={i * 90}>
              <div className="grid items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4 sm:grid-cols-[1fr_auto_1fr]">
                <p className="text-sm text-[var(--muted)] line-through decoration-[var(--red)]/60 decoration-2">
                  {L(c.before)}
                </p>
                <span className="justify-self-start text-lg text-[var(--cyan)] sm:justify-self-center" aria-hidden>→</span>
                <p className="text-sm font-semibold text-[var(--fg)]">
                  <span className="me-1.5 text-[var(--green)]" aria-hidden>✓</span>{L(c.after)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- modules

/**
 * The modules, advancing by themselves with a ring that fills.
 *
 * A row of tabs nobody clicks shows one module; this shows all six to
 * somebody who only scrolls past. Clicking still takes over, and from then on
 * it stays where it was put.
 */
function ModuleShowcase({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  const [held, setHeld] = useState(false);
  const [i, setI] = useLoop(MODULES.length, 5200, held);
  const m = MODULES[i]!;

  return (
    <section id="modules" className="mx-auto max-w-6xl px-4 py-20 lg:py-24">
      <Reveal>
        <p className="text-micro font-bold uppercase tracking-[0.2em] text-[var(--cyan)]">
          {L({ en: 'Module by module', hi: 'हर मॉड्यूल' })}
        </p>
        <h2 className="mt-3 text-3xl font-black sm:text-4xl">
          {L({ en: 'Take what you need. Add the rest later.', hi: 'जो चाहिए वो लें। बाक़ी बाद में।' })}
        </h2>
      </Reveal>

      <Reveal delay={100}>
        <div className="mt-10 grid gap-6 lg:grid-cols-[17rem_1fr]">
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0" role="tablist">
            {MODULES.map((x, k) => {
              const on = k === i;
              return (
                <button
                  key={x.key} type="button" role="tab" aria-selected={on}
                  onClick={() => { setI(k); setHeld(true); }}
                  className={`relative flex shrink-0 items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-start font-semibold transition-all ${
                    on ? 'border-[var(--cyan)]/50 bg-[var(--panel-2)] text-white' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--cyan)]/30 hover:text-white'
                  }`}
                >
                  <span className="text-lg" aria-hidden>{x.icon}</span>
                  <span className="text-sm">{L(x.name)}</span>
                  {/* the bar that fills while this one is showing */}
                  {on && !held && (
                    <span
                      key={`t-${i}`}
                      className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-gradient-to-r from-[var(--blue)] to-[var(--cyan)]"
                      style={{ animation: 'mos-underline 5.2s linear forwards' }}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div key={m.key} className="mos-drop rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6 sm:p-8" role="tabpanel">
            <h3 className="text-2xl font-extrabold">
              <span aria-hidden>{m.icon}</span> {L(m.name)}
            </h3>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--red)]/25 bg-[var(--red)]/10 p-4">
                <p className="text-micro font-bold uppercase tracking-widest text-[var(--red)]">
                  {L({ en: 'Today', hi: 'आज' })}
                </p>
                <p className="mt-1.5 text-sm text-[var(--fg)]">{L(m.problem)}</p>
              </div>
              <div className="rounded-2xl border border-[var(--green)]/25 bg-[var(--green)]/10 p-4">
                <p className="text-micro font-bold uppercase tracking-widest text-[var(--green)]">
                  {L({ en: 'With Vcare', hi: 'Vcare के साथ' })}
                </p>
                <p className="mt-1.5 text-sm text-[var(--fg)]">{L(m.fix)}</p>
              </div>
            </div>
            <p className="mt-4 rounded-2xl border-s-4 border-[var(--cyan)] bg-[var(--panel-2)] p-4 text-sm italic text-[var(--fg)]">
              {L({ en: 'For example: ', hi: 'जैसे: ' })}{L(m.example)}
            </p>
            <ul className="mt-5 grid gap-2.5">
              {m.points.map((p) => (
                <li key={p.en} className="flex gap-2.5 text-sm text-[var(--muted)]">
                  <span className="text-[var(--green)]" aria-hidden>✓</span>{L(p)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ------------------------------------------------------------------- demos

function LiveDemos({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  return (
    <section id="demo" className="border-y border-[var(--line)] bg-[var(--panel)]/30">
      <div className="mx-auto max-w-6xl px-4 py-20">
        <Reveal>
          <p className="text-micro font-bold uppercase tracking-[0.2em] text-[var(--cyan)]">
            {L({ en: 'Touch it', hi: 'छूकर देखिए' })}
          </p>
          <h2 className="mt-3 text-3xl font-black sm:text-4xl">
            {L({ en: 'Try it right here. No sign-up.', hi: 'यहीं आज़माइए। कोई साइन-अप नहीं।' })}
          </h2>
          <p className="mt-3 max-w-2xl text-base text-[var(--muted)]">
            {L({ en: 'These are real calculations, running in your browser.', hi: 'ये असली हिसाब हैं, आपके ही ब्राउज़र में चल रहे।' })}
          </p>
        </Reveal>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <Reveal delay={0}><GstDemo lang={lang} /></Reveal>
          <Reveal delay={110}><JobDemo lang={lang} /></Reveal>
          <Reveal delay={220}><ApprovalDemo lang={lang} /></Reveal>
        </div>
      </div>
    </section>
  );
}

const CARD = 'h-full rounded-3xl border border-[var(--line)] bg-[var(--panel-2)] p-5';
const FIELD = 'w-full rounded-lg border border-[var(--line)] bg-[var(--ink)] px-2 py-1.5 text-[var(--fg)] outline-none focus:border-[var(--cyan)]';
const EYEBROW = 'text-micro font-bold uppercase tracking-widest text-[var(--cyan)]';

/** Demo 1: a quotation line with GST - change the numbers and the state. */
function GstDemo({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  const [qty, setQty] = useState(4);
  const [price, setPrice] = useState(2500);
  const [disc, setDisc] = useState(5);
  const [same, setSame] = useState(true);
  const r = useMemo(() => {
    const base = qty * price * (1 - disc / 100);
    const tax = base * 0.18;
    return { base, tax, total: base + tax };
  }, [qty, price, disc]);

  return (
    <div className={CARD}>
      <p className={EYEBROW}>{L({ en: 'Quotation with GST', hi: 'GST वाला कोटेशन' })}</p>
      <p className="mt-1.5 font-semibold">2MP Dome Camera · 18% GST</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <label className="text-[var(--muted)]">{L({ en: 'Qty', hi: 'मात्रा' })}
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} className={FIELD} />
        </label>
        <label className="text-[var(--muted)]">{L({ en: 'Price ₹', hi: 'दाम ₹' })}
          <input type="number" min={0} value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))} className={FIELD} />
        </label>
        <label className="text-[var(--muted)]">{L({ en: 'Disc %', hi: 'छूट %' })}
          <input type="number" min={0} max={50} value={disc} onChange={(e) => setDisc(Math.min(50, Math.max(0, Number(e.target.value))))} className={FIELD} />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
        <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />
        {L({ en: 'Customer in the same state', hi: 'ग्राहक इसी राज्य में' })}
      </label>
      <dl className="mt-4 grid gap-1.5 text-sm tabular-nums">
        <div className="flex justify-between text-[var(--muted)]"><dt>{L({ en: 'Taxable', hi: 'कर योग्य' })}</dt><dd>{inr(r.base)}</dd></div>
        {same ? (
          <>
            <div className="flex justify-between text-[var(--muted)]"><dt>CGST 9%</dt><dd>{inr(r.tax / 2)}</dd></div>
            <div className="flex justify-between text-[var(--muted)]"><dt>SGST 9%</dt><dd>{inr(r.tax / 2)}</dd></div>
          </>
        ) : (
          <div className="flex justify-between text-[var(--muted)]"><dt>IGST 18%</dt><dd>{inr(r.tax)}</dd></div>
        )}
        <div className="mt-1 flex justify-between border-t border-[var(--line)] pt-2 text-lg font-extrabold text-[var(--cyan)]">
          <dt>{L({ en: 'Total', hi: 'कुल' })}</dt><dd>{inr(r.total)}</dd>
        </div>
      </dl>
      {disc > 10 && (
        <p className="mos-drop mt-3 rounded-lg border border-[var(--saffron)]/30 bg-[var(--saffron)]/10 p-2.5 text-xs text-[var(--fg)]">
          ⏳ {L({ en: 'Over 10% discount - this would wait for the owner to approve.', hi: '10% से ज़्यादा छूट - ये मालिक की मंज़ूरी का इंतज़ार करेगा।' })}
        </p>
      )}
    </div>
  );
}

/** Demo 2: a complaint's journey - it walks on its own, or press Next. */
function JobDemo({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  const [held, setHeld] = useState(false);
  const [step, setStep] = useLoop(STEPS.length, 1700, held);

  return (
    <div className={CARD}>
      <p className={EYEBROW}>{L({ en: 'A complaint, start to finish', hi: 'एक शिकायत, शुरू से अंत तक' })}</p>
      <ol className="mt-4 grid gap-1.5">
        {STEPS.map((s, i) => (
          <li
            key={s.en}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-all duration-500 ${
              i === step ? 'bg-[var(--blue)]/15 font-bold text-white'
                : i < step ? 'text-[var(--green)]' : 'text-[var(--muted)]/50'
            }`}
          >
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-micro transition-all ${
              i < step ? 'bg-[var(--green)] text-[#04101f]'
                : i === step ? 'scale-110 bg-[var(--blue)] text-white' : 'bg-[var(--line)]'
            }`}
            >
              {i < step ? '✓' : i + 1}
            </span>
            {L(s)}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => { setHeld(true); setStep((step + 1) % STEPS.length); }}
          className="rounded-full bg-[var(--blue)] px-4 py-2 text-xs font-bold text-white transition hover:brightness-110"
        >
          {L({ en: 'Next step', hi: 'अगला कदम' })}
        </button>
        <button
          type="button"
          onClick={() => { setHeld(false); setStep(0); }}
          className="rounded-full border border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)] transition hover:text-white"
        >
          {L({ en: 'Play again', hi: 'फिर से चलाएँ' })}
        </button>
      </div>
      {step === STEPS.length - 1 && (
        <p className="mos-drop mt-3 text-xs text-[var(--green)]">
          {L({ en: 'Closed only after the customer types their code - no fake closures.', hi: 'ग्राहक के कोड डालने के बाद ही बंद - झूठा बंद नहीं।' })}
        </p>
      )}
    </div>
  );
}

/** Demo 3: approvals - try to refund as staff, then approve as owner. */
function ApprovalDemo({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  const [state, setState] = useState<'idle' | 'waiting' | 'approved' | 'rejected'>('idle');
  return (
    <div className={CARD}>
      <p className={EYEBROW}>{L({ en: 'Approvals that protect money', hi: 'पैसे की हिफ़ाज़त करने वाली मंज़ूरी' })}</p>
      <p className="mt-1.5 font-semibold">{L({ en: 'Refund ₹4,200 to a customer', hi: 'ग्राहक को ₹4,200 रिफ़ंड' })}</p>
      <div className="mt-4 min-h-[7.5rem] rounded-2xl border border-[var(--line)] bg-[var(--ink)] p-4 text-sm">
        {state === 'idle' && (
          <button type="button" onClick={() => setState('waiting')} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#04101f] transition hover:scale-[1.03]">
            {L({ en: 'Staff: record the refund', hi: 'स्टाफ़: रिफ़ंड दर्ज करें' })}
          </button>
        )}
        {state === 'waiting' && (
          <div className="mos-drop grid gap-3">
            <p className="text-[var(--saffron)]">
              ⏳ {L({ en: 'Sent for approval - it happens once approved. Waiting on: Owner.', hi: 'मंज़ूरी के लिए भेजा - मंज़ूर होते ही होगा। इंतज़ार: मालिक।' })}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setState('approved')} className="rounded-full bg-[var(--green)] px-4 py-2 text-xs font-bold text-[#04101f]">
                {L({ en: 'Owner: Approve', hi: 'मालिक: मंज़ूर' })}
              </button>
              <button type="button" onClick={() => setState('rejected')} className="rounded-full border border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)]">
                {L({ en: 'Reject', hi: 'मना' })}
              </button>
            </div>
          </div>
        )}
        {state === 'approved' && (
          <p className="mos-drop text-[var(--green)]">
            ✓ {L({ en: 'Approved - the refund is recorded and posted to the books, with both names on it.', hi: 'मंज़ूर - रिफ़ंड दर्ज और हिसाब में गया, दोनों के नाम के साथ।' })}
          </p>
        )}
        {state === 'rejected' && (
          <p className="mos-drop text-[var(--red)]">
            ✗ {L({ en: 'Rejected - nothing moved. The staff member sees the reason.', hi: 'मना - कुछ नहीं हिला। स्टाफ़ को कारण दिखता है।' })}
          </p>
        )}
      </div>
      {state !== 'idle' && (
        <button type="button" onClick={() => setState('idle')} className="mt-3 text-xs text-[var(--cyan)] hover:underline">
          {L({ en: 'Try again', hi: 'फिर से' })}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- phone

function PhoneBand({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  const [ring, setRing] = useState(false);

  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 lg:grid-cols-2 lg:py-24">
      <Reveal>
        <p className="text-micro font-bold uppercase tracking-[0.2em] text-[var(--cyan)]">
          {L({ en: 'Vcare on the phone', hi: 'फ़ोन पर Vcare' })}
        </p>
        <h2 className="mt-3 text-3xl font-black sm:text-4xl">
          {L({ en: 'For the people who are never at a desk.', hi: 'उनके लिए जो कभी डेस्क पर होते ही नहीं।' })}
        </h2>
        <ul className="mt-6 grid gap-3">
          {[
            { en: 'Technicians: jobs, visits, parts and the customer code', hi: 'टेक्नीशियन: काम, विज़िट, पार्ट्स और ग्राहक का कोड' },
            { en: 'Sales: leads, follow-ups and calls logged by themselves', hi: 'सेल्स: लीड, follow-up और कॉल अपने आप दर्ज' },
            { en: 'Everyone: clock in, ask for leave, see what waits on them', hi: 'सब: हाज़िरी, छुट्टी माँगना, और क्या मंज़ूरी बाक़ी है' },
            { en: 'Owner: the whole business, and approvals from anywhere', hi: 'मालिक: पूरा बिज़नेस, और कहीं से भी मंज़ूरी' },
          ].map((p, i) => (
            <li key={p.en} className="flex gap-2.5 text-base text-[var(--muted)]" style={{ transitionDelay: `${i * 70}ms` }}>
              <span className="text-[var(--green)]" aria-hidden>✓</span>{L(p)}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => { setRing(true); window.setTimeout(() => setRing(false), 7000); }}
          className="mt-7 rounded-full border border-[var(--saffron)]/50 px-5 py-3 text-sm font-bold text-[var(--saffron)] transition hover:bg-[var(--saffron)]/10"
        >
          {L({ en: 'Show me an urgent alert →', hi: 'अर्जेंट अलर्ट दिखाइए →' })}
        </button>
      </Reveal>

      <Reveal delay={120} className="justify-self-center">
        <Phone lang={lang} ring={ring} />
      </Reveal>
    </section>
  );
}

function Phone({ lang, ring }: { lang: Lang; ring: boolean }) {
  const L = (s: T) => t(s, lang);
  const jobs = [
    { title: { en: 'DVR not recording', hi: 'DVR रिकॉर्ड नहीं कर रहा' }, when: '10:30 · Nehru Nagar' },
    { title: { en: 'Install 4 cameras', hi: '4 कैमरे लगाने हैं' }, when: '13:00 · Supela' },
    { title: { en: 'Follow up: Rao Traders', hi: 'Follow up: राव ट्रेडर्स' }, when: '16:00 · Call' },
  ];
  return (
    <div className="relative w-[17rem]">
      <div className="absolute -inset-6 rounded-[3rem] bg-[var(--cyan)]/10 blur-2xl" aria-hidden />
      <div className="relative rounded-[2.5rem] border-[10px] border-[#0a1120] bg-[var(--panel)] p-4 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-14 rounded-full bg-[var(--line)]" aria-hidden />

        {ring ? (
          /* The call-style alert, exactly as the phone shows it - and this is
             the version that reaches a phone nobody is signed into: it says
             that something is waiting, and nothing else. */
          <div className="mos-drop grid min-h-[17rem] place-items-center rounded-2xl bg-gradient-to-b from-[var(--saffron)]/25 to-transparent p-4 text-center">
            <div>
              <span className="mos-shake block text-4xl" aria-hidden>🔔</span>
              <p className="mt-4 text-lg font-extrabold">Vcare</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {L({ en: 'Something urgent needs you. Open Vcare and sign in.', hi: 'कुछ ज़रूरी आपका इंतज़ार कर रहा है। Vcare खोलकर साइन इन करें।' })}
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <span className="rounded-full border border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)]">
                  {L({ en: 'Dismiss', hi: 'हटाएँ' })}
                </span>
                <span className="rounded-full bg-[var(--green)] px-4 py-2 text-xs font-bold text-[#04101f]">
                  {L({ en: 'Open', hi: 'खोलें' })}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-[17rem]">
            <p className="text-micro uppercase tracking-widest text-[var(--muted)]">{L({ en: 'Today', hi: 'आज' })}</p>
            {jobs.map((j, i) => (
              <div key={j.when} className="mos-drop mt-2.5 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3" style={{ animationDelay: `${i * 140}ms` }}>
                <p className="text-sm font-semibold">{L(j.title)}</p>
                <p className="text-micro text-[var(--muted)]">{j.when}</p>
              </div>
            ))}
            <div className="mt-4 rounded-xl bg-gradient-to-r from-[var(--blue)] to-[var(--cyan)] p-2.5 text-center text-sm font-bold text-[#04101f]">
              {L({ en: 'I am on site', hi: 'मैं साइट पर हूँ' })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- faq

function Faq({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  return (
    <section id="faq" className="border-y border-[var(--line)] bg-[var(--panel)]/30">
      <div className="mx-auto max-w-3xl px-4 py-20">
        <Reveal>
          <h2 className="text-3xl font-black sm:text-4xl">{L({ en: 'Questions people ask', hi: 'लोग क्या पूछते हैं' })}</h2>
        </Reveal>
        <div className="mt-8 grid gap-3">
          {FAQ.map((f, i) => (
            <Reveal key={f.q.en} delay={i * 80}>
              <details className="group rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4 transition hover:border-[var(--cyan)]/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                  {L(f.q)}
                  <span className="shrink-0 text-[var(--cyan)] transition-transform duration-300 group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-3 text-sm text-[var(--muted)]">{L(f.a)}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- contact

function ContactForm({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: '', phone: '', business: '', businessType: '', city: '', teamSize: '', message: '', website: '' });
  const [interest, setInterest] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const field = 'w-full rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-3 text-[var(--fg)] outline-none transition placeholder:text-[var(--muted)]/70 focus:border-[var(--cyan)]';
  const send = () => start(async () => {
    setError(null);
    const r = await landingLeadAction({ ...f, interest, lang });
    if (r.error) setError(r.error); else setDone(true);
  });

  return (
    <section id="contact" className="relative overflow-hidden">
      <div className="mos-orb mos-orb-a left-1/3 top-10 h-72 w-72 bg-[var(--blue)]/18" aria-hidden />
      <div className="relative mx-auto max-w-3xl px-4 py-20 lg:py-24">
        <Reveal>
          <h2 className="text-3xl font-black sm:text-4xl">{L({ en: 'Book a free demo', hi: 'मुफ़्त डेमो बुक करें' })}</h2>
          <p className="mt-3 text-base text-[var(--muted)]">
            {L({
              en: 'Leave your number - we call within one working day and show Vcare on your own products.',
              hi: 'अपना नंबर छोड़ें - हम एक कामकाजी दिन में कॉल करके आपके ही प्रोडक्ट पर Vcare दिखाएँगे।',
            })}
          </p>
        </Reveal>

        {done ? (
          <p className="mos-drop mt-8 rounded-3xl border border-[var(--green)]/30 bg-[var(--green)]/10 p-6 text-lg font-semibold text-[var(--green)]">
            {L({ en: 'Thank you. We will call you soon.', hi: 'धन्यवाद। हम जल्दी कॉल करेंगे।' })}
          </p>
        ) : (
          <Reveal delay={100}>
            <div className="mt-8 grid gap-3 rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 sm:grid-cols-2 sm:p-7">
              <input aria-label="Name" placeholder={L({ en: 'Your name *', hi: 'आपका नाम *' })} value={f.name} onChange={set('name')} className={field} />
              <input aria-label="Mobile" inputMode="numeric" placeholder={L({ en: 'Mobile number *', hi: 'मोबाइल नंबर *' })} value={f.phone} onChange={set('phone')} className={field} />
              <input aria-label="Business" placeholder={L({ en: 'Business name', hi: 'बिज़नेस का नाम' })} value={f.business} onChange={set('business')} className={field} />
              <input aria-label="City" placeholder={L({ en: 'City', hi: 'शहर' })} value={f.city} onChange={set('city')} className={field} />
              <select aria-label="Business type" value={f.businessType} onChange={set('businessType')} className={field}>
                <option value="">{L({ en: 'Type of business', hi: 'बिज़नेस का प्रकार' })}</option>
                {['CCTV / Security', 'Electrical', 'Service & repair', 'Trading / Distribution', 'Retail shop', 'Manufacturing', 'Other'].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select aria-label="Team size" value={f.teamSize} onChange={set('teamSize')} className={field}>
                <option value="">{L({ en: 'How many people work with you?', hi: 'आपके साथ कितने लोग काम करते हैं?' })}</option>
                {['1-5', '6-20', '21-50', '50+'].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <div className="sm:col-span-2">
                <p className="mb-2.5 text-sm font-semibold">{L({ en: 'What interests you?', hi: 'आपको क्या चाहिए?' })}</p>
                <div className="flex flex-wrap gap-2">
                  {INTERESTS.map((x) => {
                    const on = interest.includes(x.en);
                    return (
                      <button
                        key={x.en} type="button" aria-pressed={on}
                        onClick={() => setInterest((cur) => (on ? cur.filter((y) => y !== x.en) : [...cur, x.en]))}
                        className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                          on ? 'border-[var(--cyan)] bg-[var(--cyan)]/15 text-[var(--cyan)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-white'
                        }`}
                      >
                        {L(x)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <textarea aria-label="Message" rows={3} placeholder={L({ en: 'Anything you want us to know (optional)', hi: 'कुछ और बताना हो (वैकल्पिक)' })} value={f.message} onChange={set('message')} className={`${field} sm:col-span-2`} />
              {/* Hidden from people; bots fill it in. */}
              <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} className="hidden" name="website" />
              {error && <p role="alert" className="text-sm text-[var(--red)] sm:col-span-2">{error}</p>}
              <button
                type="button" disabled={pending} onClick={send}
                className="mos-shine relative overflow-hidden rounded-full bg-gradient-to-r from-[var(--blue)] to-[var(--cyan)] px-6 py-3.5 font-bold text-[#04101f] transition hover:scale-[1.01] disabled:opacity-60 sm:col-span-2"
              >
                <span className="relative z-10">
                  {pending ? L({ en: 'Sending…', hi: 'भेज रहे हैं…' }) : L({ en: 'Request a call back', hi: 'कॉल बैक माँगें' })}
                </span>
              </button>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ footer

function Footer({ lang }: { lang: Lang }) {
  const L = (s: T) => t(s, lang);
  return (
    <footer className="border-t border-[var(--line)] py-10 text-center text-sm text-[var(--muted)]">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex justify-center"><Wordmark /></div>
        {/*
          THE THREE DOORS, NAMED (10 Oct 2026).

          Three different people sign in to Vcare at three different
          addresses, and this page used to offer one of them under the wrong
          label - a visitor who is a CUSTOMER of one of our clients would have
          landed on the staff door and never got in.
        */}
        <nav className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link href="/login" className="transition hover:text-[var(--cyan)]">{L({ en: 'Staff sign-in', hi: 'स्टाफ़ साइन-इन' })}</Link>
          <Link href="/portal/login" className="transition hover:text-[var(--cyan)]">{L({ en: 'Customer sign-in', hi: 'ग्राहक साइन-इन' })}</Link>
          <Link href="/shop" className="transition hover:text-[var(--cyan)]">{L({ en: 'Shops', hi: 'दुकानें' })}</Link>
          <Link href="/privacy" className="transition hover:text-[var(--cyan)]">{L({ en: 'Privacy', hi: 'गोपनीयता' })}</Link>
        </nav>
        <p className="mt-6 text-micro uppercase tracking-widest">
          © {new Date().getFullYear()} N.A.I.R. Solutions · Vcare
        </p>
      </div>
    </footer>
  );
}

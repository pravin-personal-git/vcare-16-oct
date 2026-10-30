/**
 * The help chat's search (30 Oct 2026). Plain matching, not a language model:
 * every answer is a written guide, so it can never invent a button that does
 * not exist. Questions arrive in Hinglish, English or Hindi-in-Roman, with
 * spelling of every kind ("chalan", "kese banaye", "bil"), or as an error
 * message pasted as it appeared - all of which have to land on the same guide.
 */

export interface HelpStep {
  /** What to do, in plain Hinglish. Button names in [brackets] render as button chips. */
  do: string;
  /** The page it happens on. */
  href?: string;
  /** public/help/<shot>.jpg - a picture of the screen with the thing to press ringed. */
  shot?: string;
}

export interface HelpArticle {
  id: string;
  level: 'field' | 'office' | 'admin';
  area: string;
  /** The question as people ask it. */
  q: string;
  /** Other ways it is asked, and any error text it answers. */
  also: string[];
  /** One line: the answer before the steps. */
  short: string;
  /** Who usually does it. */
  who?: string;
  steps: HelpStep[];
  /** "Kaam nahi bana?" - what goes wrong and what to do. */
  problems?: { if: string; then: string }[];
  /** The page to open. */
  open?: { href: string; label: string };
  related?: string[];
  /** Route prefixes where this is a likely question (suggested on that page). */
  pages?: string[];
}

// Words that carry no meaning in a how-to question, in all three ways people write.
const STOP = new Set(`kaise kese kaisey kaese kese kesay kya kia kyu kyun kab kaha kahan kidhar kahaan hai h he hain ho hota hoti hote
ka ki ke ko me mein mai main se par pe pr ek aur ya bhi to toh tha thi the na mat
karu karun kare karein karna karo kar krna krne kru kre krein karte karta karti karke krke
how what where when why which who is are am do does did can could should would will i my me we our you your the a an to of in on for
it this that with from at by be please plz pls batao bataiye bolo samjhao help madad chahiye chahie
gaya gayi gaye raha rahe rahi rha rhe hua hui sakta sakte sakti jata jaata jati`.split(/\s+/));

/**
 * Action and mood words: "naya", "galat", "nahi" are in half of all questions,
 * so on their own they must not pick a guide. "naya user kaise banaye" was
 * answered with "Nayi enquiry" on "naya" + "banaye" alone (30 Oct 2026).
 */
const GENERIC = new Set(['create', 'error', 'find', 'delete', 'assign', 'old']);

/** Spellings and synonyms -> one word, so "chalan", "GDN" and "parts" meet "challan". */
const SAME: [string, string[]][] = [
  ['challan', ['chalan', 'chalaan', 'challaan', 'challn', 'gdn', 'parts', 'part', 'saman', 'samaan', 'maal']],
  ['create', ['banana', 'banaye', 'banayen', 'banau', 'banao', 'bnana', 'bnaye', 'bnau', 'banane', 'raise', 'raised', 'new', 'naya', 'nayi', 'naye', 'add', 'jodo', 'jode', 'jodna', 'make', 'banta', 'generate', 'create', 'creating', 'nikalna', 'nikale', 'kholna']],
  ['return', ['wapas', 'vapas', 'wapis', 'vapis', 'lautana', 'returned', 'back', 'unused', 'bacha']],
  ['invoice', ['bill', 'bil', 'billing', 'invoices', 'inv']],
  ['payment', ['paisa', 'paise', 'paymnet', 'pyment', 'payments', 'jama', 'received', 'amount', 'collection', 'udhaar', 'baki', 'baaki', 'due', 'outstanding']],
  ['enquiry', ['inquiry', 'enquiries', 'enq', 'lead', 'leads', 'puchtach', 'poochtach']],
  ['complaint', ['complain', 'complaints', 'shikayat', 'cmp', 'comp', 'ticket', 'service', 'repair']],
  ['serial', ['serials', 'sr', 'srno', 'barcode', 'imei']],
  ['quotation', ['quote', 'quotations', 'qtn', 'estimate', 'rate']],
  ['installation', ['install', 'installations', 'fitting', 'lagana', 'lagwana', 'echn']],
  ['technician', ['tech', 'engineer', 'mistri', 'technicians', 'fitter']],
  ['stock', ['inventory', 'godown']],
  ['customer', ['party', 'client', 'grahak', 'customers']],
  ['order', ['orders', 'so']],
  ['purchase', ['kharid', 'kharidna', 'buy', 'supplier', 'po']],
  ['visit', ['visits', 'schedule', 'appointment']],
  ['assign', ['assigned', 'allot', 'dena', 'do']],
  ['error', ['problem', 'issue', 'galti', 'galat', 'wrong', 'nahi', 'nhi', 'ni', 'unable', 'cant', 'cannot', 'not', 'fail', 'failed', 'stuck', 'chal', 'khul']],
  ['delete', ['hatana', 'hatao', 'remove', 'cancel', 'withdraw']],
  ['find', ['search', 'dhundhna', 'dhoondhna', 'dhundho', 'dhundhe', 'dhoondhe', 'dhundhu', 'dhoondho', 'khojna', 'locate', 'pata']],
  ['old', ['purana', 'purane', 'puraana', 'previous', 'legacy', 'mongo']],
  ['login', ['password', 'signin', 'sign', 'locked', 'lock']],
];
const CANON = new Map<string, string>();
for (const [to, from] of SAME) { CANON.set(to, to); for (const f of from) CANON.set(f, to); }

export function words(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => CANON.get(w) ?? CANON.get(w.replace(/(s|e|en|ein|o|on)$/, '')) ?? w);
}

/** Same word, or one typo apart for words of five letters and more. */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return a.length >= 4 && b.startsWith(a);
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export interface Hit { article: HelpArticle; score: number }

/**
 * Best guides for a question. A question word in the guide's own question counts
 * most, then its other phrasings; a pasted error message is matched on its text.
 */
export function search(query: string, library: HelpArticle[], limit = 3): Hit[] {
  const q = words(query);
  if (!q.length) return [];
  const raw = query.toLowerCase().trim();
  const topical = q.filter((w) => !GENERIC.has(w));
  const hits: Hit[] = [];
  for (const article of library) {
    const title = words(article.q);
    const rest = words([...article.also, article.area].join(' '));
    const found = (w: string) => title.some((t) => near(w, t)) || rest.some((t) => near(w, t));
    // The question names a subject; a guide that shares none of it is not an answer.
    const onTopic = topical.length === 0 || topical.some(found);
    let score = 0;
    for (const w of q) {
      if (title.some((t) => near(w, t))) score += 3;
      else if (rest.some((t) => near(w, t))) score += 2;
    }
    if (!onTopic) score = 0;
    // Every question word found: a clear answer, not a partial one.
    if (q.every(found)) score += 2;
    // An error pasted as it appeared on screen.
    if (raw.length > 12 && article.also.some((a) => a.length > 12 && (a.toLowerCase().includes(raw) || raw.includes(a.toLowerCase())))) score += 10;
    if (score > 0) hits.push({ article, score: score / Math.sqrt(q.length + 1) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Good enough to answer straight away, rather than offer choices. */
export const CONFIDENT = 2.4;

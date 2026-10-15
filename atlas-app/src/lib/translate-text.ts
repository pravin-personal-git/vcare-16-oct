/**
 * THE HINDI TRANSLATION ENGINE - pure, so it is tested as a rule.
 *
 * Atlas's screens are written with English literals in hundreds of files.
 * Rekeying every one through message ids would take weeks and break on every
 * new screen. Instead, when Hindi is chosen, the shell translates what is
 * actually RENDERED - every text node, placeholder, tooltip and aria-label -
 * against one dictionary (src/i18n/hi/*.json), harvested from the source by
 * scratch/i18n/extract.cjs. See components/shell/HindiTranslator.
 *
 * Two kinds of entry:
 *   exact      "Receive goods"            -> "माल प्राप्त करें"
 *   template   "Units ({0})"              -> "यूनिट ({0})"
 *              "{0} of {1} serials"       -> "{1} में से {0} सीरियल"
 * A template's placeholders are numbers, names and codes that the screen
 * filled in; they are carried across unchanged and may be reordered, which
 * Hindi word order needs.
 *
 * WHAT IS NEVER TRANSLATED: text with no Latin letters (already Hindi, or a
 * number), and anything the dictionary does not know - it stays English
 * rather than being guessed at word by word, which produces nonsense.
 */

export type Dictionary = Record<string, string>;

/** One way of writing a string, so layout whitespace never blocks a match. */
export const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Template {
  re: RegExp;
  /** Placeholder index for each capture group, in capture order. */
  order: number[];
  out: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(key: string, out: string): Template | null {
  const order: number[] = [];
  const parts = key.split(/(\{\d+\})/);
  let src = '^';
  for (const p of parts) {
    const m = /^\{(\d+)\}$/.exec(p);
    if (m) { order.push(Number(m[1])); src += '(.+?)'; } else src += escapeRe(p);
  }
  if (order.length === 0) return null;
  // A template must carry real words of its own. A bare "{0}" - or "{0} {1}" -
  // would match ANY text on the screen and replace it with its Hindi.
  if (!/[A-Za-z]{2}/.test(key.replace(/\{\d+\}/g, ''))) return null;
  return { re: new RegExp(`${src}$`), order, out };
}

export interface Translator {
  /** The Hindi for `text`, or null when the dictionary does not know it. */
  translate(text: string): string | null;
  size: number;
}

export function buildTranslator(dict: Dictionary): Translator {
  const exact = new Map<string, string>();
  const templates: Template[] = [];
  for (const [en, hi] of Object.entries(dict)) {
    if (!hi || !en) continue;
    const k = normalise(en);
    if (/\{\d+\}/.test(k)) { const t = compile(k, hi); if (t) templates.push(t); } else exact.set(k, hi);
  }
  // Longest literal text first, so "Units in stock ({0})" wins over "{0}".
  templates.sort((a, b) => b.re.source.replace(/\(\.\+\?\)/g, '').length - a.re.source.replace(/\(\.\+\?\)/g, '').length);

  const memo = new Map<string, string | null>();

  function translate(text: string): string | null {
    const k = normalise(text);
    if (!k || !/[A-Za-z]/.test(k)) return null;
    if (memo.has(k)) return memo.get(k)!;
    let hit: string | null = exact.get(k) ?? null;
    if (hit === null) {
      for (const t of templates) {
        const m = t.re.exec(k);
        if (!m) continue;
        const vals: Record<number, string> = {};
        t.order.forEach((idx, i) => { vals[idx] = m[i + 1]; });
        // A placeholder value that is itself known English is translated too:
        // "Status: {0}" with "Pending" gives "स्थिति: लंबित".
        hit = t.out.replace(/\{(\d+)\}/g, (_, n) => {
          const v = vals[Number(n)] ?? '';
          // English plural suffixes filled into "{0} asset{1}" - Hindi has no
          // such ending, so a bare "s" / "es" is dropped rather than printed.
          if (v === 's' || v === 'es') return '';
          return exact.get(normalise(v)) ?? v;
        });
        break;
      }
    }
    if (memo.size > 20_000) memo.clear();
    memo.set(k, hit);
    return hit;
  }

  return { translate, size: exact.size + templates.length };
}

/**
 * Translate a text node's value, keeping its leading and trailing whitespace
 * so inline layout ("Owed to " + <b>name</b>) does not collapse.
 */
export function translatePreservingSpace(t: Translator, value: string): string | null {
  const hi = t.translate(value);
  if (hi === null) return null;
  const lead = /^\s*/.exec(value)![0];
  const trail = /\s*$/.exec(value)![0];
  return `${lead}${hi}${trail}`;
}

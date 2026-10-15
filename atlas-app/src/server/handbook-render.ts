import 'server-only';
import { CHAPTERS, LEVELS, LEVEL_LABEL, type HbChapter, type HbLink, type Level, type Txt } from './handbook-content';

/**
 * Turns the handbook content into ONE self-contained HTML document.
 *
 * The same document is shown inside Atlas (in an iframe on /handbook) and
 * handed out as a file people open on their own laptop, so the two can never
 * drift apart. It carries its own CSS and a few lines of script for the
 * language switch, the light/dark switch, search, the "view as" filter and the
 * step ticks - no network needed once it is open.
 *
 * WHAT A PERSON CAN SEE IS DECIDED BEFORE THIS RUNS. `forLevel` drops every
 * chapter and question above the reader's level, so the admin chapters are not
 * hidden in the page - they are not in it. The "view as" chips only narrow
 * further, down to the lower levels (an admin checking what a helper sees).
 */

export interface RenderOptions {
  level: Level;
  migrated: boolean;
  orgName: string;
  /** 'app' = inside Atlas; 'file' = downloaded copy, links open the live site. */
  mode: 'app' | 'file';
  /** Origin used for links in the downloaded copy. */
  origin: string;
  /**
   * Is this link's page switched off for the business (F-01)? A step that
   * only points at such pages is left out, and a chapter left with no steps,
   * questions or table goes too.
   */
  isOff?: (href: string) => boolean;
}

/** Drop steps and questions whose every link is switched off; drop chapters left empty. */
export function withoutOff(chapters: HbChapter[], isOff?: (href: string) => boolean): HbChapter[] {
  if (!isOff) return chapters;
  const keep = (links?: HbLink[]) => !links?.length || links.some((l) => !isOff(l.href));
  return chapters
    .map((c) => ({ ...c, steps: c.steps?.filter((s) => keep(s.links)), faqs: c.faqs?.filter((f) => keep(f.links)) }))
    .filter((c) => (c.steps?.length ?? 0) + (c.faqs?.length ?? 0) > 0 || !!c.table || !!c.notes?.length);
}

const rank = (l: Level) => LEVELS.indexOf(l);

/** The chapters (and questions) one person may read. */
export function forLevel(level: Level, migrated: boolean): HbChapter[] {
  return CHAPTERS
    .filter((c) => rank(c.level) <= rank(level) && (!c.migrated || migrated))
    .map((c) => (c.faqs ? { ...c, faqs: c.faqs.filter((f) => rank(f.level) <= rank(level)) } : c));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const tx = (t: Txt | string) =>
  typeof t === 'string'
    ? esc(t)
    : `<span lang="en">${esc(t.en)}</span><span lang="hi">${esc(t.hi)}</span>`;

export function renderHandbook(opts: RenderOptions): string {
  const chapters = withoutOff(forLevel(opts.level, opts.migrated), opts.isOff);
  const allowed = LEVELS.filter((l) => rank(l) <= rank(opts.level));

  const href = (h: string) => (opts.mode === 'file' ? opts.origin + h : h);
  const target = opts.mode === 'file' ? ' target="_blank" rel="noopener"' : '';
  const link = (l: HbLink) => `<a class="go" href="${esc(href(l.href))}"${target}>${tx(l.label)} ↗</a>`;

  // ---- table of contents, grouped
  const groups: { g: Txt; items: HbChapter[] }[] = [];
  for (const c of chapters) {
    const last = groups[groups.length - 1];
    if (last && last.g.en === c.group.en) last.items.push(c);
    else groups.push({ g: c.group, items: [c] });
  }
  const toc = groups.map((g) => `
    <div class="toc-group"><div class="toc-g">${tx(g.g)}</div>
      ${g.items.map((c) => `<a href="#${c.id}" data-lv="${c.level}" data-toc="${c.id}">${tx(c.title)}</a>`).join('')}
    </div>`).join('');

  // ---- chapters
  const body = chapters.map((c, ci) => {
    const steps = c.steps?.length
      ? `<ol class="steps">${c.steps.map((s, i) => `
          <li class="step item" data-key="${c.id}.${i}">
            <label class="tick"><input type="checkbox" aria-label="Done"><span></span></label>
            <div><h4>${tx(s.t)}</h4><p>${tx(s.p)}</p>${s.links?.length ? `<div class="links">${s.links.map(link).join('')}</div>` : ''}</div>
          </li>`).join('')}</ol>`
      : '';
    const table = c.table
      ? `<div class="tbl"><table><thead><tr>${c.table.head.map((h) => `<th>${tx(h)}</th>`).join('')}</tr></thead><tbody>${c.table.rows
          .map((r) => `<tr class="item">${r.map((cell, i) =>
            i === c.table!.linkCol && typeof cell === 'string'
              ? `<td><a class="go" href="${esc(href(cell))}"${target}><span lang="en">Open</span><span lang="hi">खोलें</span> ↗</a></td>`
              : `<td${i === 0 ? ' class="k"' : ''}>${tx(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      : '';
    const faqs = c.faqs?.length
      ? `<div class="faqs">${c.faqs.map((f) => `
          <details class="item" data-lv="${f.level}"><summary>${tx(f.q)}${f.level !== 'field' ? `<em class="lv lv-${f.level}">${tx(LEVEL_LABEL[f.level])}</em>` : ''}</summary>
            <p>${tx(f.a)}</p>${f.links?.length ? `<div class="links">${f.links.map(link).join('')}</div>` : ''}</details>`).join('')}</div>`
      : '';
    const notes = (c.notes ?? []).map((n) => `<div class="note ${n.tone}">${tx(n.text)}</div>`).join('');
    return `
    <section class="ch" id="${c.id}" data-lv="${c.level}">
      <header><span class="num">${String(ci + 1).padStart(2, '0')}</span>
        <div><div class="grp">${tx(c.group)}${c.level !== 'field' ? ` <em class="lv lv-${c.level}">${tx(LEVEL_LABEL[c.level])}</em>` : ''}</div>
        <h2>${tx(c.title)}</h2><p class="purpose">${tx(c.purpose)}</p></div>
        ${c.steps?.length ? `<span class="prog" data-prog="${c.id}"></span>` : ''}
      </header>
      ${table}${steps}${faqs}${notes}
    </section>`;
  }).join('');

  const chips = allowed.length > 1
    ? `<div class="chips" role="group" aria-label="View as">
        <span class="lbl"><span lang="en">View as</span><span lang="hi">किसके लिए</span></span>
        ${allowed.map((l) => `<button type="button" data-view="${l}"${l === opts.level ? ' aria-pressed="true"' : ''}>${tx(LEVEL_LABEL[l])}</button>`).join('')}
      </div>`
    : '';

  const download = opts.mode === 'app'
    ? `<a class="btn" href="/api/handbook/download" target="_top"><span lang="en">Download for my computer</span><span lang="hi">कंप्यूटर के लिए डाउनलोड</span></a>`
    : `<a class="btn" href="${esc(opts.origin)}/handbook" target="_blank" rel="noopener"><span lang="en">Open Atlas</span><span lang="hi">एटलस खोलें</span> ↗</a>`;

  const stamp = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  return `<!doctype html>
<html lang="en" data-lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.orgName)} - Atlas Handbook</title>
${opts.mode === 'app' ? '<base target="_top">' : ''}
<style>${CSS}</style>
</head>
<body>
<div class="top">
  <div class="brand">
    <div class="t"><span lang="en">Atlas Handbook</span><span lang="hi">एटलस हैंडबुक</span></div>
    <div class="s">${esc(opts.orgName)} · <span lang="en">for</span><span lang="hi">के लिए:</span> ${tx(LEVEL_LABEL[opts.level])} · ${esc(stamp)}</div>
  </div>
  <div class="ctl">
    <input id="q" type="search" placeholder="Search the handbook… / खोजें…" autocomplete="off">
    <button type="button" id="lang" title="English / हिंदी">हिंदी</button>
    <button type="button" id="theme" title="Light / dark"><span class="sun">☀</span><span class="moon">☾</span></button>
    <a class="btn ghost" href="${esc(href('/handbook/sop'))}"${target}><span lang="en">SOP guidebook</span><span lang="hi">SOP गाइडबुक</span></a>
    ${download}
  </div>
</div>
<div class="bar">${chips}<span class="count" id="count"></span></div>
<div class="wrap">
  <nav class="toc" aria-label="Contents">${toc}</nav>
  <main>
    ${body}
    <p class="empty" id="empty" hidden><span lang="en">Nothing matches. Try another word.</span><span lang="hi">कुछ नहीं मिला। कोई और शब्द आज़माएँ।</span></p>
    <footer><span lang="en">This handbook shows what your role in Atlas lets you do. Ticks are saved on this computer only.</span><span lang="hi">यह हैंडबुक वही दिखाती है जो एटलस में आपकी भूमिका से हो सकता है। टिक सिर्फ़ इसी कंप्यूटर पर सेव होते हैं।</span></footer>
  </main>
</div>
<script>${JS.replace('__LEVEL__', opts.level)}</script>
</body>
</html>`;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#17202b;--mute:#5b6675;--line:#dfe3e8;--acc:#e8620c;--acc-ink:#fff;--soft:#fff3ea;--tip:#eaf2ff;--tip-b:#2f6fd6;--warn:#fff4dc;--warn-b:#c98a00;--good:#e8f7ee;--good-b:#1f8a4c;--office:#6d4bd1;--admin:#c0392b;color-scheme:light}
:root[data-theme=dark]{--bg:#0f141a;--card:#171e26;--ink:#e6ebf1;--mute:#98a4b3;--line:#2a3440;--acc:#ff8a3d;--acc-ink:#1a0e05;--soft:#2a1d13;--tip:#15243a;--tip-b:#6ea1f2;--warn:#2d2410;--warn-b:#e0b04a;--good:#12291c;--good-b:#4cc07f;--office:#a88cf5;--admin:#f07a6c;color-scheme:dark}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth;scroll-padding-top:120px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Segoe UI",system-ui,-apple-system,"Nirmala UI","Noto Sans Devanagari",sans-serif}
html[data-lang=en] [lang=hi],html[data-lang=hi] [lang=en]{display:none}
a{color:var(--acc)}
.top{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--card);border-bottom:1px solid var(--line)}
.brand .t{font-weight:700;font-size:18px}.brand .s{color:var(--mute);font-size:13px}
.ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#q{height:40px;width:min(340px,70vw);padding:0 12px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
#q:focus{outline:none;border-color:var(--acc)}
button,.btn{height:40px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font:inherit;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.btn{background:var(--acc);border-color:var(--acc);color:var(--acc-ink)}.btn.ghost{background:var(--card);color:var(--ink);border-color:var(--line)}
#theme .moon{display:none}:root[data-theme=dark] #theme .sun{display:none}:root[data-theme=dark] #theme .moon{display:inline}
.bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid var(--line)}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.chips .lbl{color:var(--mute);font-size:13px;margin-inline-end:4px}
.chips button{height:32px;border-radius:999px;font-size:13px}
.chips button[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.count{color:var(--mute);font-size:13px}
.wrap{display:grid;grid-template-columns:250px minmax(0,1fr);gap:24px;max-width:1200px;margin:0 auto;padding:20px}
.toc{position:sticky;top:130px;align-self:start;max-height:calc(100vh - 150px);overflow:auto;font-size:14px}
.toc-group{margin-bottom:14px}.toc-g{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-bottom:4px}
.toc a{display:block;padding:4px 10px;border-radius:8px;color:var(--ink);text-decoration:none;border-inline-start:3px solid transparent}
.toc a:hover{background:var(--soft)}.toc a.on{border-color:var(--acc);background:var(--soft)}
main{min-width:0}
.ch{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:18px}
.ch header{display:flex;gap:14px;align-items:flex-start}
.num{font-weight:800;color:var(--acc);font-size:20px;font-variant-numeric:tabular-nums;min-width:30px}
.ch header>div{flex:1}
.grp{font-size:12px;color:var(--mute);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
h2{margin:2px 0 4px;font-size:21px;line-height:1.3;text-wrap:balance}
.purpose{margin:0;color:var(--mute);max-width:68ch}
.prog{font-size:12px;font-weight:700;color:var(--good-b);white-space:nowrap}
.lv{font-style:normal;font-size:11px;font-weight:700;border:1px solid;border-radius:999px;padding:1px 8px;margin-inline-start:6px;text-transform:none;letter-spacing:0;vertical-align:middle}
.lv-office{color:var(--office)}.lv-admin{color:var(--admin)}
.steps{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:10px}
.step{display:flex;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
.step h4{margin:0 0 2px;font-size:15px}.step p{margin:0;max-width:72ch}
.step.done{opacity:.6}.step.done h4{text-decoration:line-through}
.tick{position:relative;flex:none;margin-top:2px}.tick input{position:absolute;opacity:0;width:22px;height:22px;margin:0;cursor:pointer}
.tick span{display:block;width:22px;height:22px;border:2px solid var(--mute);border-radius:6px}
.tick input:checked+span{background:var(--good-b);border-color:var(--good-b)}
.tick input:checked+span::after{content:"✓";display:block;color:#fff;font-weight:900;text-align:center;line-height:18px;font-size:14px}
.tick input:focus-visible+span{outline:2px solid var(--acc);outline-offset:2px}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.go{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--soft);text-decoration:none;white-space:nowrap}
.tbl{overflow-x:auto;margin-top:14px;border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:14px}
th{text-align:start;background:var(--bg);color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px}
td{padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}td.k{font-weight:700;white-space:nowrap}
.faqs{margin-top:14px;display:grid;gap:8px}
details{border:1px solid var(--line);border-radius:12px;background:var(--bg);padding:0 14px}
summary{cursor:pointer;padding:12px 0;font-weight:600}details p{margin:0 0 12px;max-width:72ch}
.note{margin-top:12px;padding:10px 14px;border-radius:10px;border-inline-start:4px solid}
.note.tip{background:var(--tip);border-color:var(--tip-b)}.note.warn{background:var(--warn);border-color:var(--warn-b)}.note.good{background:var(--good);border-color:var(--good-b)}
mark{background:#ffd54a;color:#000;border-radius:3px}
.empty{color:var(--mute);text-align:center;padding:30px}
footer{color:var(--mute);font-size:13px;padding:10px 0 30px}
@media (max-width:820px){.wrap{grid-template-columns:1fr;padding:16px}.toc{position:static;max-height:none;display:flex;gap:6px;overflow-x:auto;padding-bottom:6px}.toc-group{margin:0;display:contents}.toc-g{display:none}.toc a{white-space:nowrap;border:1px solid var(--line);border-radius:999px}.top,.bar{padding-inline:16px}#q{width:100%}.ctl{width:100%}html{scroll-padding-top:200px}}
`;

// Plain ES5-ish so it runs in any browser someone opens the file in.
const JS = `
(function(){
  var R=document.documentElement,own='__LEVEL__',order=['field','office','admin'];
  function get(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function set(k,v){try{localStorage.setItem(k,v)}catch(e){}}
  // language
  function lang(l){R.setAttribute('data-lang',l);R.lang=l;document.getElementById('lang').textContent=l==='en'?'हिंदी':'English';set('hb.lang',l)}
  lang(get('hb.lang')||'en');
  document.getElementById('lang').onclick=function(){lang(R.getAttribute('data-lang')==='en'?'hi':'en');filter()};
  // theme
  var th=get('hb.theme')||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  function theme(t){R.setAttribute('data-theme',t);set('hb.theme',t)}
  theme(th);
  document.getElementById('theme').onclick=function(){theme(R.getAttribute('data-theme')==='dark'?'light':'dark')};
  // ticks
  var steps=document.querySelectorAll('.step');
  function prog(){document.querySelectorAll('[data-prog]').forEach(function(p){var s=document.querySelectorAll('#'+p.getAttribute('data-prog')+' .step'),d=0;s.forEach(function(x){if(x.classList.contains('done'))d++});p.textContent=d?d+' / '+s.length+' ✓':''})}
  steps.forEach(function(s){var k='hb.tick.'+s.getAttribute('data-key'),c=s.querySelector('input');if(get(k)==='1'){c.checked=true;s.classList.add('done')}c.onchange=function(){s.classList.toggle('done',c.checked);set(k,c.checked?'1':'0');prog()}});
  prog();
  // view-as + search
  var view=own,q=document.getElementById('q');
  document.querySelectorAll('[data-view]').forEach(function(b){b.onclick=function(){view=b.getAttribute('data-view');document.querySelectorAll('[data-view]').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});filter()}});
  function ok(lv){return order.indexOf(lv)<=order.indexOf(view)}
  function filter(){
    var term=q.value.trim().toLowerCase(),shown=0;
    document.querySelectorAll('.ch').forEach(function(ch){
      var vis=ok(ch.getAttribute('data-lv')),any=false;
      var head=ch.querySelector('header').textContent.toLowerCase().indexOf(term)>=0;
      ch.querySelectorAll('.item').forEach(function(it){
        var lvOk=!it.hasAttribute('data-lv')||ok(it.getAttribute('data-lv'));
        var m=lvOk&&(!term||head||it.textContent.toLowerCase().indexOf(term)>=0);
        it.hidden=!m;if(m)any=true;
        if(term&&m&&it.tagName==='DETAILS'&&!head)it.open=true;
      });
      var has=ch.querySelectorAll('.item').length>0;
      var show=vis&&(!term||head||any)&&(!has||any||head);
      ch.hidden=!show;if(show)shown++;
      var t=document.querySelector('[data-toc="'+ch.id+'"]');if(t)t.hidden=!show;
    });
    document.getElementById('empty').hidden=shown>0;
    document.getElementById('count').textContent=term?shown+(R.getAttribute('data-lang')==='en'?' chapters match':' अध्याय मिले'):'';
  }
  q.oninput=filter;filter();
  // highlight the chapter in view
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){document.querySelectorAll('.toc a').forEach(function(a){a.classList.toggle('on',a.getAttribute('data-toc')===e.target.id)})}})},{rootMargin:'-40% 0px -55% 0px'});document.querySelectorAll('.ch').forEach(function(c){io.observe(c)})}
  // in-page links scroll inside this document even with <base target=_top>
  document.querySelectorAll('a[href^="#"]').forEach(function(a){a.onclick=function(e){e.preventDefault();var el=document.getElementById(a.getAttribute('href').slice(1));if(el)el.scrollIntoView({behavior:'smooth'})}});
  if(location.hash){var el=document.getElementById(location.hash.slice(1));if(el)el.scrollIntoView()}
})();
`;

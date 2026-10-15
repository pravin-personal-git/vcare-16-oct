import 'server-only';
import { LEVELS, type Level } from '@/lib/levels';
import {
  READER_ROLES, ROLE_LABEL, ROLE_LEVEL, SOP_CHAPTERS,
  type SopBlock, type SopChapter, type SopLink, type SopStep, type Tx,
} from './sop-content';

/**
 * Turns the SOP guidebook into ONE self-contained HTML document - the same
 * shape as the handbook (handbook-render.ts): shown in an iframe on
 * /handbook/sop and downloadable as a file whose links open the live site.
 *
 * Flowcharts are plain HTML boxes and arrows, not a drawing library: they
 * work offline in the downloaded file, print, follow the language switch
 * and reflow to a column on a phone.
 *
 * Chapters above the reader's level are dropped here, before rendering - the
 * setup chapter is not hidden in a technician's copy, it is not in it.
 */

export interface SopRenderOptions {
  level: Level;
  orgName: string;
  mode: 'app' | 'file';
  origin: string;
  /** Is this link's page switched off for the business (F-01)? */
  isOff?: (href: string) => boolean;
}

const rank = (l: Level) => LEVELS.indexOf(l);

/** The chapters one reader may see, with steps whose only links are switched off removed. */
export function sopFor(level: Level, isOff?: (href: string) => boolean): SopChapter[] {
  const keep = (s: SopStep) => !isOff || !s.links?.length || s.links.some((l) => !isOff(l.href));
  return SOP_CHAPTERS
    .filter((c) => rank(c.level) <= rank(level))
    .map((c) => ({
      ...c,
      blocks: c.blocks
        .map((b): SopBlock => (b.k === 'steps' || b.k === 'timeline' ? { ...b, items: b.items.filter(keep) } as SopBlock : b))
        .filter((b) => !((b.k === 'steps' || b.k === 'timeline') && b.items.length === 0)),
    }));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Hinglish is marked hi-Latn, Hindi hi - the CSS shows one of the two. */
const tx = (t: Tx | string) =>
  typeof t === 'string'
    ? esc(t)
    : `<span lang="hi-Latn">${esc(t.hl)}</span><span lang="hi">${esc(t.hi)}</span>`;

const both = (hl: string, hi: string) => tx({ hl, hi });

export function renderSop(opts: SopRenderOptions): string {
  const chapters = sopFor(opts.level, opts.isOff);
  const roles = READER_ROLES.filter((r) => rank(ROLE_LEVEL[r]) <= rank(opts.level));

  const href = (h: string) => (opts.mode === 'file' ? opts.origin + h : h);
  const target = opts.mode === 'file' ? ' target="_blank" rel="noopener"' : '';
  const link = (l: SopLink) => `<a class="go" href="${esc(href(l.href))}"${target}>${tx(l.label)} ↗</a>`;
  const badge = (r: keyof typeof ROLE_LABEL) => `<span class="rb r-${r}">${tx(ROLE_LABEL[r])}</span>`;

  // Screenshots live in public/sop and are served without signing in (they
  // show only the demo company). The downloaded file points at the live site.
  const shotFig = (name: string, t: Tx) => {
    const src = esc(href(`/sop/${name}.jpg`));
    return `<figure class="shot"><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(t.hl)}" loading="lazy" width="800" height="483"></a>
      <figcaption>${both('Atlas ki asli screen (demo company) - badi dekhne ke liye dabao', 'एटलस की असली स्क्रीन (डेमो कंपनी) - बड़ी देखने के लिए दबाएँ')}</figcaption></figure>`;
  };

  let tick = 0;
  const step = (s: SopStep, chapterId: string, time?: string) => {
    const key = `${chapterId}.${tick++}`;
    return `
      <li class="step item${time ? ' tl' : ''}" data-role="${s.role}" data-key="${key}">
        ${time ? `<div class="time">${esc(time)}</div>` : ''}
        <label class="tick"><input type="checkbox" aria-label="Done"><span></span></label>
        <div class="sb">
          <div class="sh">${badge(s.role)}${s.phone ? `<span class="ph">📱 ${both('Phone', 'फ़ोन')}</span>` : ''}<h4>${tx(s.t)}</h4></div>
          <p>${tx(s.p)}</p>
          ${s.demo ? `<div class="demo"><b>${both('Demo', 'डेमो')}</b> ${tx(s.demo)}</div>` : ''}
          ${s.why ? `<div class="why"><b>${both('Kyun?', 'क्यों?')}</b> ${tx(s.why)}</div>` : ''}
          ${s.links?.length ? `<div class="links">${s.links.map(link).join('')}</div>` : ''}
          ${s.shot ? shotFig(s.shot, s.t) : ''}
        </div>
      </li>`;
  };

  const block = (b: SopBlock, c: SopChapter): string => {
    switch (b.k) {
      case 'para': return `<p class="para">${tx(b.text)}</p>`;
      case 'why': return `<div class="note why-n"><b>${both('Business ka logic', 'बिज़नेस का लॉजिक')}</b> ${tx(b.text)}</div>`;
      case 'note': return `<div class="note ${b.tone}">${tx(b.text)}</div>`;
      case 'cards': return `<div class="cards">${b.items.map((i) => `<div class="card item"><h4>${tx(i.t)}</h4><p>${tx(i.p)}</p></div>`).join('')}</div>`;
      case 'table': return `${b.title ? `<h3>${tx(b.title)}</h3>` : ''}<div class="tbl"><table><thead><tr>${b.head.map((h) => `<th>${tx(h)}</th>`).join('')}</tr></thead><tbody>${
        b.rows.map((r) => `<tr class="item">${r.map((cell, i) => `<td${i === 0 ? ' class="k"' : ''}>${tx(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      case 'flow': return `
        <figure class="flow">
          <figcaption>${tx(b.title)}</figcaption>
          <ol>${b.nodes.map((n, i) => `${i ? '<li class="arr" aria-hidden="true"></li>' : ''}<li class="node" data-role="${n.role}">
            <span class="n">${i + 1}</span>${badge(n.role)}<strong>${tx(n.t)}</strong>${n.sub ? `<small>${tx(n.sub)}</small>` : ''}</li>`).join('')}</ol>
          ${b.foot ? `<p class="foot">${tx(b.foot)}</p>` : ''}
        </figure>`;
      case 'states': return `
        <figure class="flow states">
          <figcaption>${tx(b.title)}</figcaption>
          <ol>${b.states.map((s, i) => `${i ? '<li class="arr" aria-hidden="true"></li>' : ''}<li class="st t-${s.tone}">
            <strong>${tx(s.t)}</strong><small>${tx(s.who)}</small><code>${esc(s.code)}</code></li>`).join('')}</ol>
          ${b.side?.length ? `<div class="side"><b>${both('Aur raaste', 'और रास्ते')}</b><ul>${b.side.map((s) => `<li>${tx(s)}</li>`).join('')}</ul></div>` : ''}
        </figure>`;
      case 'steps': return `${b.title ? `<h3>${tx(b.title)}</h3>` : ''}<ol class="steps">${b.items.map((s) => step(s, c.id)).join('')}</ol>`;
      case 'timeline': return `<ol class="steps timeline">${b.items.map((s) => step(s, c.id, s.time)).join('')}</ol>`;
    }
  };

  // ---- table of contents, grouped by part
  const groups: { p: Tx; items: SopChapter[] }[] = [];
  for (const c of chapters) {
    const last = groups[groups.length - 1];
    if (last && last.p.hl === c.part.hl) last.items.push(c);
    else groups.push({ p: c.part, items: [c] });
  }
  const toc = groups.map((g) => `
    <div class="toc-group"><div class="toc-g">${tx(g.p)}</div>
      ${g.items.map((c) => `<a href="#${c.id}" data-toc="${c.id}">${tx(c.title)}</a>`).join('')}
    </div>`).join('');

  const body = chapters.map((c, ci) => {
    tick = 0;
    const hasSteps = c.blocks.some((b) => b.k === 'steps' || b.k === 'timeline');
    return `
    <section class="ch" id="${c.id}">
      <header><span class="num">${String(ci + 1).padStart(2, '0')}</span>
        <div><div class="grp">${tx(c.part)}</div><h2>${tx(c.title)}</h2><p class="purpose">${tx(c.purpose)}</p></div>
        ${hasSteps ? `<span class="prog" data-prog="${c.id}"></span>` : ''}
      </header>
      ${c.blocks.map((b) => block(b, c)).join('')}
    </section>`;
  }).join('');

  const chips = `<div class="chips" role="group" aria-label="Main kaun hoon">
      <span class="lbl">${both('Main kaun hoon?', 'मैं कौन हूँ?')}</span>
      <button type="button" data-role-pick="" aria-pressed="true">${both('Sab', 'सब')}</button>
      ${roles.map((r) => `<button type="button" data-role-pick="${r}" aria-pressed="false" class="c-${r}">${tx(ROLE_LABEL[r])}</button>`).join('')}
    </div>`;

  const handbook = `<a class="btn ghost" href="${esc(href('/handbook'))}"${target}>${both('Handbook', 'हैंडबुक')}</a>`;
  const download = opts.mode === 'app'
    ? `<a class="btn" href="/api/handbook/download?doc=sop" target="_top">${both('Download', 'डाउनलोड')}</a>`
    : `<a class="btn" href="${esc(opts.origin)}/handbook/sop" target="_blank" rel="noopener">${both('Atlas kholo', 'एटलस खोलें')} ↗</a>`;

  const stamp = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  return `<!doctype html>
<html lang="hi-Latn" data-lang="hl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.orgName)} - SOP Guidebook</title>
${opts.mode === 'app' ? '<base target="_top">' : ''}
<style>${CSS}</style>
</head>
<body>
<div class="top">
  <div class="brand">
    <div class="t">${both('SOP Guidebook: ek din ka business', 'SOP गाइडबुक: एक दिन का बिज़नेस')}</div>
    <div class="s">${esc(opts.orgName)} · ${esc(stamp)}</div>
  </div>
  <div class="ctl">
    <input id="q" type="search" placeholder="Khojo… / खोजें…" autocomplete="off">
    <button type="button" id="lang" title="Hinglish / हिंदी">हिंदी</button>
    <button type="button" id="theme" title="Light / dark"><span class="sun">☀</span><span class="moon">☾</span></button>
    ${handbook}${download}
  </div>
</div>
<div class="bar">${chips}<span class="count" id="count"></span></div>
<div class="wrap">
  <nav class="toc" aria-label="Contents">${toc}</nav>
  <main>
    ${body}
    <p class="empty" id="empty" hidden>${both('Kuch nahi mila. Koi aur shabd likho.', 'कुछ नहीं मिला। कोई और शब्द लिखें।')}</p>
    <footer>${both('Demo ke naam aur rakam sirf misaal hain. Tick sirf isi computer ya phone par yaad rehte hain.', 'डेमो के नाम और रकम सिर्फ़ मिसाल हैं। टिक सिर्फ़ इसी कंप्यूटर या फ़ोन पर याद रहते हैं।')}</footer>
  </main>
</div>
<script>${JS}</script>
</body>
</html>`;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#17202b;--mute:#5b6675;--line:#dfe3e8;--acc:#e8620c;--acc-ink:#fff;--soft:#fff3ea;--tip:#eaf2ff;--tip-b:#2f6fd6;--warn:#fff4dc;--warn-b:#c98a00;--good:#e8f7ee;--good-b:#1f8a4c;--why:#f3efff;--why-b:#6d4bd1;
--r-owner:#c0392b;--r-office:#6d4bd1;--r-sales:#0e8a6a;--r-store:#b7791f;--r-tech:#2f6fd6;--r-accounts:#be185d;--r-customer:#475569;--r-system:#64748b;color-scheme:light}
:root[data-theme=dark]{--bg:#0f141a;--card:#171e26;--ink:#e6ebf1;--mute:#98a4b3;--line:#2a3440;--acc:#ff8a3d;--acc-ink:#1a0e05;--soft:#2a1d13;--tip:#15243a;--tip-b:#6ea1f2;--warn:#2d2410;--warn-b:#e0b04a;--good:#12291c;--good-b:#4cc07f;--why:#1e1833;--why-b:#a88cf5;
--r-owner:#f07a6c;--r-office:#a88cf5;--r-sales:#3ccf9f;--r-store:#e0b04a;--r-tech:#6ea1f2;--r-accounts:#f472b6;--r-customer:#94a3b8;--r-system:#94a3b8;color-scheme:dark}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth;scroll-padding-top:130px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 "Segoe UI",system-ui,-apple-system,"Nirmala UI","Noto Sans Devanagari",sans-serif}
html[data-lang=hl] [lang=hi],html[data-lang=hi] [lang=hi-Latn]{display:none}
a{color:var(--acc)}
.top{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--card);border-bottom:1px solid var(--line)}
.brand .t{font-weight:700;font-size:18px}.brand .s{color:var(--mute);font-size:13px}
.ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#q{height:40px;width:min(300px,70vw);padding:0 12px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
#q:focus{outline:none;border-color:var(--acc)}
button,.btn{height:40px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font:inherit;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.btn{background:var(--acc);border-color:var(--acc);color:var(--acc-ink)}.btn.ghost{background:var(--card);color:var(--ink);border-color:var(--line)}
#theme .moon{display:none}:root[data-theme=dark] #theme .sun{display:none}:root[data-theme=dark] #theme .moon{display:inline}
.bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid var(--line);background:var(--card)}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.chips .lbl{color:var(--mute);font-size:13px;font-weight:600;margin-inline-end:4px}
.chips button{height:34px;border-radius:999px;font-size:13px}
.chips button[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.count{color:var(--mute);font-size:13px}
.wrap{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;max-width:1240px;margin:0 auto;padding:20px}
.toc{position:sticky;top:140px;align-self:start;max-height:calc(100vh - 160px);overflow:auto;font-size:14px}
.toc-group{margin-bottom:14px}.toc-g{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-bottom:4px}
.toc a{display:block;padding:4px 10px;border-radius:8px;color:var(--ink);text-decoration:none;border-inline-start:3px solid transparent}
.toc a:hover{background:var(--soft)}.toc a.on{border-color:var(--acc);background:var(--soft)}
main{min-width:0}
.ch{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:18px}
.ch header{display:flex;gap:14px;align-items:flex-start;margin-bottom:6px}
.num{font-weight:800;color:var(--acc);font-size:20px;font-variant-numeric:tabular-nums;min-width:30px}
.ch header>div{flex:1}
.grp{font-size:12px;color:var(--mute);text-transform:uppercase;letter-spacing:.05em;font-weight:600}
h2{margin:2px 0 4px;font-size:21px;line-height:1.3;text-wrap:balance}
h3{margin:22px 0 8px;font-size:16px}
.purpose{margin:0;color:var(--mute);max-width:70ch}
.para{max-width:72ch}
.prog{font-size:12px;font-weight:700;color:var(--good-b);white-space:nowrap}
.rb{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;color:#fff;white-space:nowrap;vertical-align:middle}
.r-owner{background:var(--r-owner)}.r-office{background:var(--r-office)}.r-sales{background:var(--r-sales)}.r-store{background:var(--r-store)}.r-tech{background:var(--r-tech)}.r-accounts{background:var(--r-accounts)}.r-customer{background:var(--r-customer)}.r-system{background:var(--r-system)}
:root[data-theme=dark] .rb{color:#0f141a}
.ph{font-size:12px;font-weight:600;color:var(--mute)}
/* steps */
.steps{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:10px}
.step{display:flex;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
.step .sb{flex:1;min-width:0}
.sh{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}
.step h4{margin:0;font-size:15px;flex-basis:100%}
.step p{margin:4px 0 0;max-width:74ch}
.demo,.why{margin-top:8px;padding:8px 12px;border-radius:10px;font-size:14px;max-width:78ch}
.demo{background:var(--soft)}.why{background:var(--why)}
.demo b,.why b{font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-inline-end:4px}
.why b{color:var(--why-b)}.demo b{color:var(--acc)}
.step.done{opacity:.6}.step.done h4{text-decoration:line-through}
.tick{position:relative;flex:none;margin-top:2px}.tick input{position:absolute;opacity:0;width:22px;height:22px;margin:0;cursor:pointer}
.tick span{display:block;width:22px;height:22px;border:2px solid var(--mute);border-radius:6px}
.tick input:checked+span{background:var(--good-b);border-color:var(--good-b)}
.tick input:checked+span::after{content:"✓";display:block;color:#fff;font-weight:900;text-align:center;line-height:18px;font-size:14px}
.tick input:focus-visible+span{outline:2px solid var(--acc);outline-offset:2px}
.shot{margin:10px 0 0;max-width:560px}.shot img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}.shot figcaption{font-size:12px;color:var(--mute);margin-top:4px}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.go{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--soft);text-decoration:none;white-space:nowrap}
/* timeline */
.timeline .step.tl{position:relative}
.time{flex:none;width:52px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--acc);padding-top:1px}
/* flowcharts */
.flow{margin:16px 0 4px;padding:14px;border:1px dashed var(--line);border-radius:12px;background:var(--bg)}
.flow figcaption{font-weight:700;margin-bottom:10px}
.flow ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;align-items:stretch;gap:8px 0}
.node,.st{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:118px;max-width:170px;padding:9px 11px;border:2px solid var(--line);border-radius:12px;background:var(--card);transition:opacity .15s}
.node strong,.st strong{font-size:14px;line-height:1.3}
.node small,.st small{color:var(--mute);font-size:12px;line-height:1.3}
.node .n{font-size:11px;font-weight:800;color:var(--mute)}
.node[data-role=owner]{border-color:var(--r-owner)}.node[data-role=office]{border-color:var(--r-office)}.node[data-role=sales]{border-color:var(--r-sales)}.node[data-role=store]{border-color:var(--r-store)}.node[data-role=tech]{border-color:var(--r-tech)}.node[data-role=accounts]{border-color:var(--r-accounts)}.node[data-role=customer]{border-color:var(--r-customer)}.node[data-role=system]{border-color:var(--r-system);border-style:dashed}
.arr{display:flex;align-items:center;justify-content:center;width:26px;color:var(--mute);font-weight:700}
.arr::before{content:"→";font-size:18px}
.node.dim{opacity:.3}
.st code{font-size:11px;color:var(--mute)}
.t-new{border-color:var(--warn-b)}.t-work{border-color:var(--tip-b)}.t-wait{border-color:var(--why-b);border-style:dashed}.t-done{border-color:var(--good-b)}.t-end{border-color:var(--mute);background:var(--bg)}
.side{margin-top:12px;font-size:14px}.side ul{margin:6px 0 0;padding-inline-start:20px}.side li{margin:3px 0}
.foot{margin:10px 0 0;font-size:13px;color:var(--mute)}
/* cards, tables, notes */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:14px}
.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}.card h4{margin:0 0 4px;font-size:15px}.card p{margin:0;font-size:14px}
.tbl{overflow-x:auto;margin-top:10px;border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:14px}
th{text-align:start;background:var(--bg);color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px}
td{padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}td.k{font-weight:700}
.note{margin-top:14px;padding:10px 14px;border-radius:10px;border-inline-start:4px solid}
.note.tip{background:var(--tip);border-color:var(--tip-b)}.note.warn{background:var(--warn);border-color:var(--warn-b)}.note.good{background:var(--good);border-color:var(--good-b)}.note.why-n{background:var(--why);border-color:var(--why-b)}
.note.why-n b{color:var(--why-b);margin-inline-end:4px}
mark{background:#ffd54a;color:#000;border-radius:3px}
.empty{color:var(--mute);text-align:center;padding:30px}
footer{color:var(--mute);font-size:13px;padding:10px 0 30px}
@media (max-width:820px){
  .wrap{grid-template-columns:1fr;padding:16px}
  .toc{position:static;max-height:none;display:flex;gap:6px;overflow-x:auto;padding-bottom:6px}
  .toc-group{margin:0;display:contents}.toc-g{display:none}
  .toc a{white-space:nowrap;border:1px solid var(--line);border-radius:999px}
  .top,.bar{padding-inline:16px}#q{width:100%}.ctl{width:100%}
  html{scroll-padding-top:230px}
  .ch{padding:16px}
  .flow ol{flex-direction:column;align-items:stretch}
  .node,.st{max-width:none}
  .arr{width:auto;height:20px}.arr::before{content:"↓"}
  .time{width:44px}
}
@media print{.top,.bar,.toc,.tick{display:none}.wrap{display:block}.ch{break-inside:avoid-page}}
`;

// Plain ES5-ish so it runs in any browser someone opens the file in.
const JS = `
(function(){
  var R=document.documentElement;
  function get(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function set(k,v){try{localStorage.setItem(k,v)}catch(e){}}
  // language: Hinglish (hl) or Hindi (hi)
  function lang(l){R.setAttribute('data-lang',l);R.lang=l==='hl'?'hi-Latn':'hi';document.getElementById('lang').textContent=l==='hl'?'हिंदी':'Hinglish';set('sop.lang',l)}
  lang(get('sop.lang')==='hi'?'hi':'hl');
  document.getElementById('lang').onclick=function(){lang(R.getAttribute('data-lang')==='hl'?'hi':'hl');filter()};
  // theme
  var th=get('sop.theme')||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  function theme(t){R.setAttribute('data-theme',t);set('sop.theme',t)}
  theme(th);
  document.getElementById('theme').onclick=function(){theme(R.getAttribute('data-theme')==='dark'?'light':'dark')};
  // ticks
  function prog(){document.querySelectorAll('[data-prog]').forEach(function(p){var s=document.querySelectorAll('#'+p.getAttribute('data-prog')+' .step:not([hidden])'),d=0;s.forEach(function(x){if(x.classList.contains('done'))d++});p.textContent=d?d+' / '+s.length+' ✓':''})}
  document.querySelectorAll('.step').forEach(function(s){var k='sop.tick.'+s.getAttribute('data-key'),c=s.querySelector('input');if(get(k)==='1'){c.checked=true;s.classList.add('done')}c.onchange=function(){s.classList.toggle('done',c.checked);set(k,c.checked?'1':'0');prog()}});
  // role + search
  var role=get('sop.role')||'',q=document.getElementById('q');
  if(!document.querySelector('[data-role-pick="'+role+'"]'))role='';
  document.querySelectorAll('[data-role-pick]').forEach(function(b){b.onclick=function(){role=b.getAttribute('data-role-pick');set('sop.role',role);filter()}});
  function filter(){
    document.querySelectorAll('[data-role-pick]').forEach(function(x){x.setAttribute('aria-pressed',x.getAttribute('data-role-pick')===role?'true':'false')});
    document.querySelectorAll('.node').forEach(function(n){n.classList.toggle('dim',!!role&&n.getAttribute('data-role')!==role)});
    var term=q.value.trim().toLowerCase(),shown=0,steps=0;
    document.querySelectorAll('.ch').forEach(function(ch){
      var head=ch.querySelector('header').textContent.toLowerCase().indexOf(term)>=0,any=false;
      ch.querySelectorAll('.item').forEach(function(it){
        var r=it.getAttribute('data-role');
        var roleOk=!role||!r||r===role;
        var m=roleOk&&(!term||head||it.textContent.toLowerCase().indexOf(term)>=0);
        it.hidden=!m;if(m){any=true;if(r)steps++}
      });
      var hasItems=ch.querySelectorAll('.item').length>0;
      var hasRoleItems=ch.querySelectorAll('.step').length>0;
      var roleHit=!role||!hasRoleItems||ch.querySelector('.step[data-role="'+role+'"]');
      var show=(!term||head||any)&&(!hasItems||any||head)&&!!roleHit;
      ch.hidden=!show;if(show)shown++;
      var t=document.querySelector('[data-toc="'+ch.id+'"]');if(t)t.hidden=!show;
    });
    document.getElementById('empty').hidden=shown>0;
    var hl=R.getAttribute('data-lang')==='hl';
    document.getElementById('count').textContent=role||term?(steps+(hl?' step':' कदम')):'';
    prog();
  }
  q.oninput=filter;filter();
  // highlight the chapter in view
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){document.querySelectorAll('.toc a').forEach(function(a){a.classList.toggle('on',a.getAttribute('data-toc')===e.target.id)})}})},{rootMargin:'-40% 0px -55% 0px'});document.querySelectorAll('.ch').forEach(function(c){io.observe(c)})}
  // in-page links scroll inside this document even with <base target=_top>
  document.querySelectorAll('a[href^="#"]').forEach(function(a){a.onclick=function(e){e.preventDefault();var el=document.getElementById(a.getAttribute('href').slice(1));if(el)el.scrollIntoView({behavior:'smooth'})}});
  if(location.hash){var el=document.getElementById(location.hash.slice(1));if(el)el.scrollIntoView()}
})();
`;

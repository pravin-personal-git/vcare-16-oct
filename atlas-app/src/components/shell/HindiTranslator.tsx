'use client';

import { useEffect } from 'react';
import { buildTranslator, translatePreservingSpace } from '@/lib/translate-text';

/**
 * Puts the whole screen into Hindi when Hindi is chosen.
 *
 * Mounted once, in the root layout, only for the `hi` locale - English users
 * never download the dictionary. It translates what is RENDERED: every text
 * node, placeholder, tooltip, aria-label and alt text, and keeps doing so as
 * the screen changes - a dialog opening, a server message arriving, a grid
 * paging - through a MutationObserver. See lib/translate-text for the rules
 * and src/i18n/hi-dictionary.json for the words.
 *
 * WHAT IT LEAVES ALONE: form values a person typed (inputs and textareas are
 * values, not text nodes), code and pre blocks, contenteditable areas, and
 * anything inside an element marked `data-no-translate` or `translate="no"` -
 * use that on customer names or product names that happen to be English words.
 *
 * It runs after React has hydrated, so the server-rendered HTML and the first
 * client render agree; the Hindi is applied on top a moment later.
 */
export function HindiTranslator() {
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;

    void import('@/i18n/hi-dictionary.json').then((mod) => {
      if (cancelled) return;
      const t = buildTranslator(mod.default as Record<string, string>);
      const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'NOSCRIPT', 'SVG']);
      const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
      const written = new WeakMap<Node, string>();

      const skipped = (el: Element | null): boolean => {
        for (let e = el; e; e = e.parentElement) {
          if (SKIP.has(e.tagName.toUpperCase()) || e.hasAttribute('data-no-translate') || e.getAttribute('translate') === 'no') return true;
          if ((e as HTMLElement).isContentEditable) return true;
        }
        return false;
      };

      const doText = (n: Text) => {
        const v = n.nodeValue;
        if (!v || written.get(n) === v || skipped(n.parentElement)) return;
        const hi = translatePreservingSpace(t, v);
        if (hi && hi !== v) { written.set(n, hi); n.nodeValue = hi; }
      };

      const doAttrs = (el: Element) => {
        if (skipped(el)) return;
        for (const a of ATTRS) {
          const v = el.getAttribute(a);
          if (!v || el.getAttribute(`data-hi-${a}`) === v) continue;
          const hi = t.translate(v);
          if (hi) { el.setAttribute(`data-hi-${a}`, hi); el.setAttribute(a, hi); }
        }
      };

      const walk = (root: Node) => {
        if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
        if (root.nodeType !== Node.ELEMENT_NODE) return;
        doAttrs(root as Element);
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (n.nodeType === Node.TEXT_NODE) doText(n as Text); else doAttrs(n as Element);
        }
      };

      walk(document.body);
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'characterData') doText(m.target as Text);
          else if (m.type === 'attributes') doAttrs(m.target as Element);
          else m.addedNodes.forEach(walk);
        }
      });
      observer.observe(document.body, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS,
      });
    });

    return () => { cancelled = true; observer?.disconnect(); };
  }, []);

  return null;
}

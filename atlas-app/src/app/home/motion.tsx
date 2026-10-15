'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * THE LANDING PAGE'S MOTION, HAND-BUILT (10 Oct 2026).
 *
 * Pravin on the old page: "so apathetic, just a random AI slop". It was a
 * stack of static boxes. This is the toolkit the new one is built from -
 * reveal on scroll, numbers that count, a loop that drives a diagram, a
 * pointer-follow glow.
 *
 * NO ANIMATION LIBRARY. framer-motion is ~34KB gzipped and would be the
 * heaviest thing on a page whose whole job is to load fast for somebody on
 * mobile data in Bhilai. Everything here is IntersectionObserver,
 * requestAnimationFrame and CSS keyframes, which the browser runs on the
 * compositor anyway.
 *
 * EVERY HOOK HERE ANSWERS TO `prefers-reduced-motion`. Not a nicety: motion
 * sickness and vestibular disorders are real, and a page that ignores the
 * setting is unusable for those people rather than merely busy. When it is
 * set, nothing moves and everything arrives at its final state at once - the
 * page still works, it just does not perform.
 */

export function useReducedMotion(): boolean {
  // Starts false so the server and the first client render agree; the effect
  // corrects it before anything has had time to move.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  return reduced;
}

/**
 * Has this element been scrolled into view yet?
 *
 * Once true it stays true - a section that fades out again when you scroll
 * back up reads as a glitch, not as design. `rootMargin` fires it slightly
 * before the element arrives so the animation is already running by the time
 * it is properly on screen.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/**
 * A block that rises into place when it is reached. `delay` staggers siblings.
 *
 * Always a div, deliberately: a polymorphic `as` would buy one tag name and
 * cost a ref type that nobody can read. Wrap it in whatever element the
 * section needs instead.
 */
export function Reveal({ children, delay = 0, className = '' }: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const [ref, seen] = useReveal<HTMLDivElement>();
  const reduced = useReducedMotion();
  return (
    <div
      ref={ref}
      className={`${className} ${reduced ? '' : 'mos-reveal'} ${seen ? 'mos-in' : ''}`}
      style={reduced ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/**
 * A number that counts up when it is reached.
 *
 * Eased, not linear: a figure that decelerates into place reads as a value
 * settling, while a linear one reads as a loading spinner. Returns the number
 * so the caller can format it however it formats every other number.
 */
export function useCountUp(target: number, run: boolean, ms = 1200): number {
  const [n, setN] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!run) return;
    if (reduced) { setN(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      // easeOutExpo
      const e = p === 1 ? 1 : 1 - 2 ** (-10 * p);
      setN(target * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms, reduced]);
  return n;
}

/**
 * A step counter that advances on its own and loops - what drives the flow
 * diagram and the module showcase.
 *
 * `paused` is for hover: a diagram that keeps moving while somebody is trying
 * to read one node of it is showing off at the reader's expense. With reduced
 * motion it simply never advances and sits on the first step, which is a
 * complete, readable diagram.
 */
export function useLoop(count: number, everyMs: number, paused = false): [number, (i: number) => void] {
  const [i, setI] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (paused || reduced || count < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % count), everyMs);
    return () => clearInterval(id);
  }, [count, everyMs, paused, reduced]);
  return [i, setI];
}

/**
 * Where the pointer is inside an element, as 0-1, for a glow that follows it.
 *
 * Written straight to CSS custom properties rather than through React state:
 * this fires on every mousemove, and re-rendering a section sixty times a
 * second to move a highlight is how a landing page ends up janky on the
 * laptops most of our clients actually own. Ignored on touch, where there is
 * no pointer to follow.
 */
export function usePointerGlow<T extends HTMLElement = HTMLDivElement>(): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(hover: hover)').matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    };
    el.addEventListener('pointermove', move);
    return () => el.removeEventListener('pointermove', move);
  }, []);
  return ref;
}

/** How far down the page we are, 0-1, for the progress bar in the top bar. */
export function useScrollProgress(): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setP(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    // Coalesced into a frame: scroll fires far faster than the screen redraws.
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);
  return p;
}

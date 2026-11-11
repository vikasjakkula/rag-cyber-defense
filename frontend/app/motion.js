"use client";

import { Fragment, useLayoutEffect } from "react";
import gsap from "gsap";

// Shared GSAP animations. Mark elements in JSX and this hook animates them when they come into view:
//   data-reveal          fades and rises in
//   data-count="38461"   counts up from 0 to the number (data-suffix="%" adds a suffix)
//   .hbar-fill / .bar    bars grow from the left, one after another
//   .trend .line         the line chart draws itself
// The browser's IntersectionObserver decides when something is visible, so content always appears,
// even if the page layout changes after the data loads. `ready` is the data the page waits for.
export function useMotion(scope, ready) {
  useLayoutEffect(() => {
    const root = scope.current;
    if (!ready || !root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const play = new Map(); // element -> animation to run when it becomes visible
    const ctx = gsap.context(() => {
      root.querySelectorAll("[data-reveal]").forEach((el) => {
        gsap.set(el, { y: 36, opacity: 0 });
        play.set(el, () => gsap.to(el, { y: 0, opacity: 1, duration: 0.9, ease: "power3.out" }));
      });

      root.querySelectorAll("[data-count]").forEach((el) => {
        const end = Number(el.dataset.count);
        const suffix = el.dataset.suffix || "";
        const decimals = (el.dataset.count.split(".")[1] || "").length;
        const write = (v) => {
          el.textContent = v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
        };
        write(0);
        play.set(el, () => {
          const state = { v: 0 };
          gsap.to(state, { v: end, duration: 1.8, ease: "power2.out", onUpdate: () => write(state.v), onComplete: () => write(end) });
        });
      });

      root.querySelectorAll(".hbars, .vgroups, .bars").forEach((group) => {
        const fills = group.querySelectorAll(".hbar-fill, .bar");
        gsap.set(fills, { scaleX: 0, transformOrigin: "left center" });
        play.set(group, () => gsap.to(fills, { scaleX: 1, duration: 1.1, ease: "expo.out", stagger: 0.06 }));
      });

      root.querySelectorAll(".trend").forEach((chart) => {
        const line = chart.querySelector(".line");
        const area = chart.querySelector(".area");
        if (!line) return;
        const len = line.getTotalLength();
        gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
        gsap.set(area, { opacity: 0 });
        play.set(chart, () => {
          gsap.to(line, { strokeDashoffset: 0, duration: 2, ease: "power2.inOut" });
          gsap.to(area, { opacity: 1, duration: 1.4, delay: 0.8 });
        });
      });
    }, root);

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        play.get(entry.target)?.();
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    play.forEach((_, el) => observer.observe(el));

    return () => {
      observer.disconnect();
      ctx.revert();
    };
  }, [scope, ready]);
}

// Splits a heading into words that rise in one after another
export function useHeadline(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tween = gsap.from(el.querySelectorAll(".word"), {
      yPercent: 110, opacity: 0, duration: 1, ease: "expo.out", stagger: 0.07, delay: 0.2,
    });
    return () => tween.revert();
  }, [ref]);
}

export function Words({ text }) {
  // The space sits between the masks; inside an inline-block it would collapse
  return text.split(" ").map((w, i) => (
    <Fragment key={i}>{i > 0 && " "}<span className="word-mask"><span className="word">{w}</span></span></Fragment>
  ));
}

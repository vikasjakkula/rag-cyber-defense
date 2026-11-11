"use client";

import { Fragment, useLayoutEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Shared GSAP animations. Mark elements in JSX and this hook animates them:
//   data-reveal          fades and rises in when scrolled into view
//   data-count="38461"   counts up from 0 to the number
//   .hbar-fill           bars grow from the left, one after another
//   .trend .line         the line chart draws itself
// `ready` is the data the page waits for; the animations run once it is there.
export function useMotion(scope, ready) {
  useLayoutEffect(() => {
    if (!ready || !scope.current) return;
    gsap.registerPlugin(ScrollTrigger);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.utils.toArray("[data-reveal]").forEach((el) => {
        gsap.from(el, {
          y: 36, opacity: 0, duration: 0.9, ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });

      gsap.utils.toArray("[data-count]").forEach((el) => {
        const end = Number(el.dataset.count);
        const decimals = (el.dataset.count.split(".")[1] || "").length;
        const suffix = el.dataset.suffix || "";
        const state = { v: 0 };
        gsap.to(state, {
          v: end, duration: 1.8, ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 92%" },
          onUpdate: () => { el.textContent = state.v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix; },
        });
      });

      gsap.utils.toArray(".hbars, .vgroups, .bars").forEach((group) => {
        gsap.from(group.querySelectorAll(".hbar-fill, .bar"), {
          scaleX: 0, transformOrigin: "left center", duration: 1.1, ease: "expo.out", stagger: 0.06,
          scrollTrigger: { trigger: group, start: "top 85%" },
        });
      });

      gsap.utils.toArray(".trend .line").forEach((path) => {
        const len = path.getTotalLength();
        gsap.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, {
          strokeDashoffset: 0, duration: 2, ease: "power2.inOut",
          scrollTrigger: { trigger: path, start: "top 85%" },
        });
      });
      gsap.utils.toArray(".trend .area").forEach((area) => {
        gsap.from(area, { opacity: 0, duration: 1.4, delay: 0.8, scrollTrigger: { trigger: area, start: "top 85%" } });
      });
    }, scope);
    return () => ctx.revert();
  }, [scope, ready]);
}

// Splits a heading into words that rise in one after another
export function useHeadline(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const words = el.querySelectorAll(".word");
    const tween = gsap.from(words, { yPercent: 110, opacity: 0, duration: 1, ease: "expo.out", stagger: 0.07, delay: 0.2 });
    return () => tween.revert();
  }, [ref]);
}

export function Words({ text }) {
  // The space sits between the masks; inside an inline-block it would collapse
  return text.split(" ").map((w, i) => (
    <Fragment key={i}>{i > 0 && " "}<span className="word-mask"><span className="word">{w}</span></span></Fragment>
  ));
}

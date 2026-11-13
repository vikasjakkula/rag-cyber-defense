"use client";

import { Fragment, useEffect } from "react";

// Animations without a library. Mark elements in JSX and this hook plays them when they scroll into view:
//   data-reveal         the element fades and rises in (CSS does it when the class "shown" is added)
//   data-count="944"    inside a data-reveal element: the number counts up from 0 (data-suffix="%" adds "%")
// `ready` is the data the page waits for, so we only start once the content is on the page.
export function useReveal(scope, ready) {
  useEffect(() => {
    const root = scope.current;
    if (!ready || !root) return;

    // IntersectionObserver tells us when an element becomes visible on screen
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("shown");
        entry.target.querySelectorAll("[data-count]").forEach(countUp);
        observer.unobserve(entry.target); // play once
      }
    }, { rootMargin: "0px 0px -8% 0px" });

    root.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [scope, ready]);
}

// Counts an element's text from 0 up to its data-count in 1.5 seconds
function countUp(el) {
  const end = Number(el.dataset.count);
  const suffix = el.dataset.suffix || "";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / 1500);
    const eased = 1 - (1 - t) ** 3; // fast at first, slow at the end
    el.textContent = Math.round(end * eased).toLocaleString("en-US") + suffix;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Splits a heading into words; CSS makes each word rise in a little after the one before
export function Words({ text }) {
  return text.split(" ").map((word, i) => (
    <Fragment key={i}>
      {i > 0 && " "}
      <span className="word-mask"><span className="word" style={{ "--i": i }}>{word}</span></span>
    </Fragment>
  ));
}

"use client";

import Link from "next/link";

const PAGES = [
  ["ask", "/", "Ask"], ["history", "/history", "History"],
  ["insights", "/insights", "Insights"], ["research", "/research", "Research"],
];

// A small version of the background: rings and the four layer dots (CVE, CWE, CAPEC, ATT&CK)
function ring(r, seed) {
  let d = "";
  for (let s = 0; s <= 48; s++) {
    const a = (s / 48) * Math.PI * 2;
    const rr = r * (1 + 0.1 * Math.sin(3 * a + seed) + 0.05 * Math.sin(5 * a - seed));
    d += `${s ? "L" : "M"}${(16 + Math.cos(a) * rr).toFixed(2)},${(16 + Math.sin(a) * rr).toFixed(2)}`;
  }
  return d + "Z";
}
const RINGS = [4, 7.5, 11].map((r, i) => ring(r, i * 0.9));
const DOTS = [["#f59e0b", 22, 8], ["#ec4899", 9, 12], ["#8b5cf6", 23, 21], ["#14b8a6", 13, 23]];

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#ffffff" stroke="#e6e1f5" />
      <g className="logo-rings">
        {RINGS.map((d) => <path key={d} d={d} fill="none" stroke="#8b5cf6" strokeWidth="1" opacity="0.7" />)}
      </g>
      {DOTS.map(([c, x, y]) => <circle key={c} cx={x} cy={y} r="1.8" fill={c} />)}
    </svg>
  );
}

export default function Nav({ current }) {
  return (
    <nav className="topnav" aria-label="Pages">
      <Link href="/" className="brand"><Logo />Cyber Defense RAG</Link>
      <div className="links">
        {PAGES.map(([key, href, label]) => (
          <Link key={key} href={href} aria-current={current === key ? "page" : undefined}>{label}</Link>
        ))}
      </div>
    </nav>
  );
}

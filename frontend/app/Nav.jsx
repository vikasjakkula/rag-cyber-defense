"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BACKGROUNDS, savedBackground } from "./Backdrop";

const PAGES = [["ask", "/", "Ask"], ["insights", "/insights", "Insights"], ["research", "/research", "Research"]];

export default function Nav({ current }) {
  const [bg, setBg] = useState(null);
  useEffect(() => setBg(savedBackground()), []);

  // Switches the animated background template; Backdrop listens for this event
  function nextBackground() {
    const next = BACKGROUNDS[(BACKGROUNDS.indexOf(bg) + 1) % BACKGROUNDS.length];
    setBg(next);
    try { localStorage.setItem("bg", next); } catch {}
    window.dispatchEvent(new CustomEvent("bgchange", { detail: next }));
  }

  return (
    <nav className="topnav" aria-label="Pages">
      {PAGES.map(([key, href, label]) => (
        <Link key={key} href={href} aria-current={current === key ? "page" : undefined}>{label}</Link>
      ))}
      {bg && (
        <button type="button" className="bg-switch" onClick={nextBackground}
                title="Change background" aria-label={`Background: ${bg}. Change background`}>
          <i className={`swatch ${bg}`} />
        </button>
      )}
    </nav>
  );
}

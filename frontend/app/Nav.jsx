"use client";

import Link from "next/link";

const PAGES = [["ask", "/", "Ask"], ["insights", "/insights", "Insights"], ["research", "/research", "Research"]];

export default function Nav({ current }) {
  return (
    <nav className="topnav" aria-label="Pages">
      <Link href="/" className="brand"><i />Cyber Defense RAG</Link>
      <div className="links">
        {PAGES.map(([key, href, label]) => (
          <Link key={key} href={href} aria-current={current === key ? "page" : undefined}>{label}</Link>
        ))}
      </div>
    </nav>
  );
}

import Link from "next/link";

export default function Nav({ current }) {
  return (
    <nav className="topnav" aria-label="Pages">
      <Link href="/" aria-current={current === "ask" ? "page" : undefined}>Ask</Link>
      <Link href="/research" aria-current={current === "research" ? "page" : undefined}>Research</Link>
    </nav>
  );
}

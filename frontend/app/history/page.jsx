"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import Backdrop from "../Backdrop";
import Nav from "../Nav";
import { clearHistory, loadHistory, removeEntry } from "../history";
import { useReveal, Words } from "../motion";

const REFUSAL = "I don't have information";

function day(iso) {
  const d = new Date(iso), today = new Date();
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

function status(h) {
  if (!h.answer || h.answer.startsWith(REFUSAL)) return ["muted", "No data found"];
  const g = h.grounding;
  if (!g || g.score == null) return ["muted", "No IDs to check"];
  return g.unsupported.length ? ["warn", `${g.unsupported.length} not in graph`] : ["ok", "Verified"];
}

export default function History() {
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);
  const scope = useRef(null);
  useReveal(scope, items);
  useEffect(() => setItems(loadHistory()), []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items || []).filter((h) => !q || `${h.question} ${h.answer} ${(h.ids || []).join(" ")}`.toLowerCase().includes(q));
  }, [items, query]);

  const groups = useMemo(() => {
    const out = new Map();
    for (const h of shown) {
      const k = day(h.at);
      out.set(k, [...(out.get(k) || []), h]);
    }
    return [...out];
  }, [shown]);

  const stats = useMemo(() => {
    const all = items || [];
    const checked = all.filter((h) => h.grounding?.score != null);
    const verified = checked.filter((h) => !h.grounding.unsupported.length).length;
    const ids = new Set(all.flatMap((h) => h.ids || []));
    return { total: all.length, verified: checked.length ? Math.round((verified / checked.length) * 100) : 0, ids: ids.size };
  }, [items]);

  function clearAll() {
    if (!confirming) return setConfirming(true);
    setItems(clearHistory());
    setConfirming(false);
  }

  return (
    <>
      <Backdrop />
      <Nav current="history" />
      <main className="history" ref={scope}>
        <p className="eyebrow">History · saved in this browser</p>
        <h1><Words text="Every answer, kept with its evidence" /></h1>
        <p className="sub">Each question is saved with the answer, technical explanation, attack paths and grounding check. Reopen any of them instantly, without asking the AI again.</p>

        {items && items.length > 0 && (
          <section className="tiles">
            <div className="tile" data-reveal><span>Questions asked</span><b data-count={stats.total}>{stats.total}</b></div>
            <div className="tile" data-reveal><span>Answers fully verified</span><b data-count={stats.verified} data-suffix="%">{stats.verified}%</b></div>
            <div className="tile" data-reveal><span>Security IDs explored</span><b data-count={stats.ids}>{stats.ids}</b></div>
          </section>
        )}

        {items && items.length === 0 && (
          <div className="card empty-state" data-reveal>
            <p>No saved answers yet.</p>
            <Link href="/" className="cta">Ask your first question</Link>
          </div>
        )}

        {items && items.length > 0 && (
          <section className="card history-list" data-reveal>
            <div className="history-tools">
              <input className="search" value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder="Search questions, answers or IDs" aria-label="Search history" />
              <button type="button" className={confirming ? "ghost danger" : "ghost"} onClick={clearAll}
                      onBlur={() => setConfirming(false)}>
                {confirming ? "Click again to delete all" : "Clear all"}
              </button>
            </div>

            {groups.length === 0 && <p className="note">Nothing matches “{query}”.</p>}

            {groups.map(([label, list]) => (
              <div key={label} className="day">
                <h2>{label}</h2>
                <ul>
                  {list.map((h) => {
                    const [kind, text] = status(h);
                    return (
                      <li key={h.id} className="entry">
                        <Link href={`/?h=${h.id}`} className="entry-main">
                          <span className="entry-q">{h.question}</span>
                          <span className="entry-a">{(h.answer || "").slice(0, 170)}{(h.answer || "").length > 170 ? "…" : ""}</span>
                          <span className="entry-meta">
                            <span className={`pill ${kind}`}>{text}</span>
                            {(h.ids || []).slice(0, 3).map((id) => <span key={id} className="pill id">{id}</span>)}
                            <span className="time">{new Date(h.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                          </span>
                        </Link>
                        <button type="button" className="remove" aria-label={`Delete "${h.question}"`}
                                onClick={() => setItems(removeEntry(h.id))}>×</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        )}
      </main>
    </>
  );
}

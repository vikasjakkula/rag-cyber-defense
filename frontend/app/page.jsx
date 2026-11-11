"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import AttackGraph from "./AttackGraph";
import Backdrop from "./Backdrop";
import Nav from "./Nav";
import { loadHistory, saveEntry } from "./history";
import Link from "next/link";
import { useHeadline, Words } from "./motion";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://rag-cyber-defense.vercel.app";

const EXAMPLES = [
  "Which ATT&CK techniques are reachable from CVE-2024-24919?",
  "What attack patterns are linked to CWE-287?",
  "How do attackers abuse the print spooler?",
];

// Official page for any ID, so users can verify every source themselves
function sourceUrl(id) {
  if (id.startsWith("CVE-")) return `https://nvd.nist.gov/vuln/detail/${id}`;
  if (id.startsWith("CWE-")) return `https://cwe.mitre.org/data/definitions/${id.slice(4)}.html`;
  if (id.startsWith("CAPEC-")) return `https://capec.mitre.org/data/definitions/${id.slice(6)}.html`;
  if (id.startsWith("T")) return `https://attack.mitre.org/techniques/${id.replace(".", "/")}/`;
  return null;
}

// Flatten the retrieved facts into a short list of {id, name} sources
function collectSources(result) {
  const seen = new Map();
  const add = (item) => {
    if (item?.id && !seen.has(item.id)) seen.set(item.id, item.name || "");
  };
  for (const fact of result.facts) {
    if (result.mode === "keyword_search") { add(fact); continue; }
    add(fact.cve || fact.cwe || fact.capec || fact.technique);
    for (const key of ["cwes", "capecs", "techniques"]) {
      for (const item of fact[key] || []) typeof item === "object" && add(item);
    }
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

const REFUSAL = "I only answer cybersecurity questions";

// Types the example questions into the empty box, left to right, then erases and moves to the next
function useTypingHint(active) {
  const [hint, setHint] = useState("");
  useEffect(() => {
    if (!active) return setHint("");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setHint(EXAMPLES[0]);
    let i = 0, n = 0, dir = 1, timer;
    const step = () => {
      const full = EXAMPLES[i];
      n += dir;
      setHint(full.slice(0, n));
      let delay = dir > 0 ? 38 : 14;
      if (dir > 0 && n === full.length) { dir = -1; delay = 1800; }
      else if (dir < 0 && n === 0) { dir = 1; i = (i + 1) % EXAMPLES.length; delay = 350; }
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, 400);
    return () => clearTimeout(timer);
  }, [active]);
  return hint;
}

// Reveals streamed text a few characters per frame, so it types smoothly even when tokens arrive in bursts
function Typed({ text, live }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= text.length) return;
    const id = requestAnimationFrame(() =>
      setShown((n) => Math.min(text.length, n + Math.max(2, Math.ceil((text.length - n) / 14)))));
    return () => cancelAnimationFrame(id);
  }, [shown, text]);
  const typing = live || shown < text.length;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {text.slice(0, shown) + (typing ? " ▍" : "")}
    </ReactMarkdown>
  );
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const hint = useTypingHint(!focused && !question);
  const title = useRef(null);
  useHeadline(title);

  const [recent, setRecent] = useState([]);
  const [drawer, setDrawer] = useState(false);
  // Earlier answers in this chat, shown above the current one and sent back so follow-ups have context
  const [thread, setThread] = useState([]);
  const current = useRef(null);
  useEffect(() => { current.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [result?.id]);

  // Show a saved answer straight from this browser's storage, without asking the AI again
  function open(saved) {
    setThread([]);
    setQuestion("");
    setError("");
    setResult({ ...saved, live: { answer: false, details: false } });
    window.history.replaceState(null, "", `/?h=${saved.id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNew() {
    setThread([]);
    setQuestion("");
    setResult(null);
    setError("");
    window.history.replaceState(null, "", "/");
  }

  // /?h=<id> (links from the History page) opens that saved answer
  useEffect(() => {
    const all = loadHistory();
    setRecent(all);
    const id = new URLSearchParams(window.location.search).get("h");
    const saved = id && all.find((h) => String(h.id) === id);
    if (saved) open(saved);
  }, []);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text) return;
    const earlier = result?.answer && !result.live?.answer ? [...thread, result] : thread;
    setThread(earlier);
    setQuestion("");
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          history: earlier.slice(-6).map((t) => ({ question: t.question, answer: t.answer })),
        }),
      });
      if (!res.ok) {
        let detail = "The backend returned an error.";
        try {
          const payload = await res.json();
          detail = payload.detail || payload.message || JSON.stringify(payload);
        } catch {
          try {
            detail = await res.text();
          } catch {
            detail = "Unknown API error.";
          }
        }
        throw new Error(detail);
      }
      // One JSON event per line: the facts first, then answer and details text as the model writes it.
      // `entry` collects the whole result so it can be saved to history at the end.
      let entry = null;
      const show = () => setResult({ ...entry });
      const apply = (event) => {
        if (event.type === "facts") {
          const { type, ...facts } = event;
          entry = { ...facts, id: Date.now(), at: new Date().toISOString(), answer: "", details: "",
                    live: { answer: true, details: event.facts.length > 0 } };
          show();
          window.dispatchEvent(new Event("graph:pulse")); // the particle graph reacts to the answer
        } else if (event.type === "answer" || event.type === "details") {
          entry[event.type] += event.delta;
          show();
        } else if (event.type === "end") {
          entry.live = { ...entry.live, [event.part]: false };
          show();
        } else if (event.type === "done") {
          entry.llm = event.llm;
          entry.grounding = event.grounding;
          show();
        } else if (event.type === "error" && !event.part) {
          throw new Error(event.detail);
        }
      };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) if (line.trim()) apply(JSON.parse(line));
      }
      if (entry) {
        entry.live = { answer: false, details: false };
        show();
        if (entry.answer) {
          setRecent(saveEntry(entry));
          window.history.replaceState(null, "", `/?h=${entry.id}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong while getting your answer. Please try again in a moment.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const sources = result ? collectSources(result) : [];
  const SHOWN = 12;

  const idle = !result && !loading && !error && thread.length === 0;

  return (
    <>
    <Backdrop hidden={!idle} />
    <Nav current="ask" />
    {recent.length > 0 && <>
      {/* Hovering the left edge opens the drawer; the tab opens it on click or touch */}
      <div className="recent-zone" aria-hidden="true" />
      <aside className={drawer ? "recent open" : "recent"} aria-label="Recent questions"
             onMouseLeave={() => setDrawer(false)}>
        <div className="recent-head">
          <button type="button" className="new-q" onClick={startNew}>+ New question</button>
          <button type="button" className="close" aria-label="Close recent questions"
                  onClick={() => { setDrawer(false); document.activeElement?.blur(); }}>×</button>
        </div>
        <p>Recent</p>
        <ul>
          {recent.slice(0, 25).map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => open(h)} title={h.question}
                      className={result?.id === h.id ? "active" : undefined}>
                {h.question}
              </button>
            </li>
          ))}
        </ul>
        <Link href="/history" className="all">See all history →</Link>
      </aside>
      <button type="button" className="recent-tab" onClick={() => setDrawer(true)}>Recent ({recent.length})</button>
    </>}
    <main className={idle ? "hero" : "chat"}>
      {idle && <>
        <h1 ref={title}><Words text="Cyber Defense RAG" /></h1>
        <p className="sub">Answers grounded in a CVE → CWE → CAPEC → ATT&amp;CK knowledge graph</p>
      </>}

      <form className={idle ? "ask" : "ask docked"} onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <div className="field">
          <input
            aria-label="Ask about a vulnerability, weakness or attack technique"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {!focused && !question && <span className="hint" aria-hidden="true">{hint}<i /></span>}
        </div>
        <button className="send" aria-label="Ask" disabled={loading || !question.trim()}>
          {loading ? <span className="spin" /> : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>

      {idle && (
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => ask(ex)}>{ex}</button>
          ))}
        </div>
      )}

      {thread.map((t) => (
        <div className="turn" key={t.id}>
          <p className="turn-q">{t.question}</p>
          <div className="turn-a"><ReactMarkdown remarkPlugins={[remarkGfm]}>{t.answer}</ReactMarkdown></div>
        </div>
      ))}

      {loading && !result && <div className="reply skeleton"><span /><span /><span /></div>}

      {error && <p className="card error">{error}</p>}

      {result && (
        <section className="reply" key={result.id} ref={current}>
          <p className="q-echo">{result.question}</p>
          {result.answer ? (
            <div className="answer">
              <Typed text={result.answer} live={result.live?.answer} />
            </div>
          ) : result.live?.answer ? (
            <div className="skeleton"><span /><span /></div>
          ) : (
            <div className="answer empty">
              The AI is unavailable right now (it may have reached its daily limit). Any records found are listed below.
            </div>
          )}

          {/* Every ID and score the AI wrote, checked against the records Neo4j returned */}
          {result.grounding?.score != null && !result.answer.startsWith(REFUSAL) && (
            result.grounding.unsupported.length === 0 ? (
              <p className="grounding ok">
                Verified: all {result.grounding.supported.length} IDs and scores in this answer are in the graph.
              </p>
            ) : (
              <p className="grounding warn">
                {result.grounding.supported.length} of {result.grounding.supported.length + result.grounding.unsupported.length} claims
                found in the graph. Not found: {result.grounding.unsupported.join(", ")}
              </p>
            )
          )}

          {result.mode === "id_lookup" && !result.answer.startsWith(REFUSAL) &&
            result.facts.slice(0, 2).map((fact, i) => <AttackGraph key={i} fact={fact} link={sourceUrl} />)}

          {result.details && !result.answer.startsWith(REFUSAL) && (
            <div className="details">
              <h2>Technical explanation</h2>
              <Typed text={result.details} live={result.live?.details} />
            </div>
          )}

          {result.not_found?.length > 0 && (
            <p className="note">Not in the dataset: {result.not_found.join(", ")}</p>
          )}

          {result.mode === "id_lookup" && sources.length > 0 && (
            <div className="sources">
              <h2>Sources <span className="count">{sources.length}</span></h2>
              <ul>
                {sources.slice(0, SHOWN).map((s) => (
                  <li key={s.id}>
                    <a href={sourceUrl(s.id)} target="_blank" rel="noreferrer">{s.id}</a>
                    {s.name && <span>{s.name}</span>}
                  </li>
                ))}
              </ul>
              {sources.length > SHOWN && (
                <details>
                  <summary>Show {sources.length - SHOWN} more</summary>
                  <ul>
                    {sources.slice(SHOWN).map((s) => (
                      <li key={s.id}>
                        <a href={sourceUrl(s.id)} target="_blank" rel="noreferrer">{s.id}</a>
                        {s.name && <span>{s.name}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Developer-only details, collapsed so users never see raw JSON by default */}
          {process.env.NODE_ENV !== "production" && (
            <details className="dev">
              <summary>Developer details</summary>
              <p>mode: {result.mode} · llm: {result.llm}</p>
              <pre>{JSON.stringify(result.facts, null, 2)}</pre>
            </details>
          )}
        </section>
      )}
    </main>
    </>
  );
}

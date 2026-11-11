"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import AttackGraph from "./AttackGraph";
import Backdrop from "./Backdrop";

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

const REFUSAL = "I don't have information";

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

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion(text);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
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
      // One JSON event per line: the facts first, then answer and details text as the model writes it
      const apply = (event) => {
        if (event.type === "facts") {
          setResult({ ...event, answer: "", details: "", live: { answer: true, details: event.facts.length > 0 } });
        } else if (event.type === "answer" || event.type === "details") {
          setResult((r) => ({ ...r, [event.type]: r[event.type] + event.delta }));
        } else if (event.type === "end") {
          setResult((r) => ({ ...r, live: { ...r.live, [event.part]: false } }));
        } else if (event.type === "done") {
          setResult((r) => ({ ...r, llm: event.llm }));
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
      setResult((r) => r && { ...r, live: { answer: false, details: false } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong while getting your answer. Please try again in a moment.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const sources = result ? collectSources(result) : [];
  const SHOWN = 12;

  const idle = !result && !loading && !error;

  return (
    <>
    <Backdrop />
    <main className={idle ? "hero" : undefined}>
      <h1>Cyber Defense RAG</h1>
      <p className="sub">Answers grounded in a CVE → CWE → CAPEC → ATT&amp;CK knowledge graph</p>

      <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
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

      {loading && !result && <div className="card skeleton"><span /><span /><span /></div>}

      {error && <p className="card error">{error}</p>}

      {result && (
        <section className="card" key={result.question}>
          {result.facts.length === 0 ? (
            <div className="answer empty">
              No matching records were found in the knowledge graph. Try a specific ID such as
              CVE-2024-24919 or CWE-287, or different keywords.
            </div>
          ) : result.answer ? (
            <div className="answer">
              <Typed text={result.answer} live={result.live?.answer} />
            </div>
          ) : result.live?.answer ? (
            <div className="skeleton"><span /><span /></div>
          ) : (
            <div className="answer empty">
              The AI summary is unavailable right now, but the records below were found in the graph.
            </div>
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

          {sources.length > 0 && (
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

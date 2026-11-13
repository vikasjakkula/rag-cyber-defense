"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import Answer from "./Answer";
import Backdrop from "./Backdrop";
import Nav from "./Nav";
import { askStream } from "./api";
import { loadHistory, saveEntry } from "./history";
import { Words } from "./motion";

const EXAMPLES = [
  "Which ATT&CK techniques are reachable from CVE-2024-24919?",
  "What attack patterns are linked to CWE-287?",
  "How do attackers abuse the print spooler?",
];

// Types the example questions into the empty box letter by letter, then erases and moves to the next one
function useTypingHint(active) {
  const [hint, setHint] = useState("");
  useEffect(() => {
    if (!active) return setHint("");
    let example = 0, length = 0, direction = 1, timer;
    function step() {
      const full = EXAMPLES[example];
      length += direction;
      setHint(full.slice(0, length));
      let wait = direction > 0 ? 40 : 15;
      if (length === full.length) { direction = -1; wait = 1800; }          // pause on the full question
      if (length === 0) { direction = 1; example = (example + 1) % EXAMPLES.length; wait = 350; }
      timer = setTimeout(step, wait);
    }
    timer = setTimeout(step, 400);
    return () => clearTimeout(timer);
  }, [active]);
  return hint;
}

export default function Home() {
  const [question, setQuestion] = useState("");  // text in the box
  const [current, setCurrent] = useState(null);  // the answer being written now
  const [thread, setThread] = useState([]);      // earlier answers in this chat
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState([]);      // saved answers, for the sidebar
  const [drawer, setDrawer] = useState(false);   // sidebar opened by the tab
  const [focused, setFocused] = useState(false);
  const hint = useTypingHint(!focused && !question);
  const currentRef = useRef(null);

  // On first load: read saved answers, and open one if the link is /?h=<id> (from the History page)
  useEffect(() => {
    const saved = loadHistory();
    setRecent(saved);
    const id = new URLSearchParams(window.location.search).get("h");
    const entry = saved.find((h) => String(h.id) === id);
    if (entry) open(entry);
  }, []);

  // Scroll down to each new answer
  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [current?.id]);

  // Show a saved answer from this browser's storage, without asking the AI again
  function open(entry) {
    setThread([]);
    setError("");
    setCurrent({ ...entry, typing: null });
  }

  function startNew() {
    setThread([]);
    setCurrent(null);
    setError("");
    window.history.replaceState(null, "", "/");
  }

  async function ask(text) {
    text = text.trim();
    if (!text || loading) return;

    // The finished answer moves up into the thread; the last 6 go to the AI so follow-ups make sense
    const earlier = current?.answer ? [...thread, current] : thread;
    setThread(earlier);
    setQuestion("");
    setError("");
    setLoading(true);

    // `entry` is updated as events arrive; every change is shown on screen straight away
    let entry = { id: Date.now(), at: new Date().toISOString(), question: text, answer: "", details: "", typing: "answer" };
    const show = (changes) => { entry = { ...entry, ...changes }; setCurrent(entry); };
    show({});

    try {
      const history = earlier.slice(-6).map((t) => ({ question: t.question, answer: t.answer }));
      await askStream(text, history, (event) => {
        if (event.type === "facts") show({ mode: event.mode, ids: event.ids, facts: event.facts, not_found: event.not_found });
        if (event.type === "answer") show({ answer: entry.answer + event.delta });
        if (event.type === "details") show({ details: entry.details + event.delta, typing: "details" });
        if (event.type === "done") show({ grounding: event.grounding });
        if (event.type === "error") throw new Error(event.detail);
      });
      if (entry.answer) {
        setRecent(saveEntry(entry));
        window.history.replaceState(null, "", `/?h=${entry.id}`);
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      show({ typing: null });
      setLoading(false);
    }
  }

  const idle = !current && thread.length === 0 && !error; // nothing asked yet: show the big centred hero

  return (
    <>
      <Backdrop hidden={!idle} />
      <Nav current="ask" />

      {/* Sidebar of saved answers: hover the left edge or click the tab to open it */}
      {recent.length > 0 && <>
        <div className="recent-zone" aria-hidden="true" />
        <aside className={drawer ? "recent open" : "recent"} onMouseLeave={() => setDrawer(false)}>
          <div className="recent-head">
            <button type="button" className="new-q" onClick={startNew}>+ New question</button>
            <button type="button" className="close" aria-label="Close" onClick={() => setDrawer(false)}>×</button>
          </div>
          <p>Recent</p>
          <ul>
            {recent.slice(0, 25).map((h) => (
              <li key={h.id}>
                <button type="button" title={h.question} onClick={() => open(h)}
                        className={current?.id === h.id ? "active" : undefined}>{h.question}</button>
              </li>
            ))}
          </ul>
          <Link href="/history" className="all">See all history →</Link>
        </aside>
        <button type="button" className="recent-tab" onClick={() => setDrawer(true)}>Recent ({recent.length})</button>
      </>}

      <main className={idle ? "hero" : "chat"}>
        {idle && <>
          <h1><Words text="Cyber Defense RAG" /></h1>
          <p className="sub">Answers grounded in a CVE → CWE → CAPEC → ATT&amp;CK knowledge graph</p>
        </>}

        {thread.map((t) => <Answer key={t.id} result={t} brief />)}
        {current && <div ref={currentRef}><Answer result={current} /></div>}
        {error && <p className="card error">{error}</p>}

        <form className={idle ? "ask" : "ask docked"} onSubmit={(e) => { e.preventDefault(); ask(question); }}>
          <div className="field">
            <input aria-label="Ask a cybersecurity question" value={question}
                   onChange={(e) => setQuestion(e.target.value)}
                   onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
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
            {EXAMPLES.map((ex) => <button key={ex} className="chip" onClick={() => ask(ex)}>{ex}</button>)}
          </div>
        )}
      </main>
    </>
  );
}

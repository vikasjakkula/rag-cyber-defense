"use client";

import { useEffect, useRef, useState } from "react";

import Backdrop from "../Backdrop";
import Nav from "../Nav";
import { useHeadline, useMotion, Words } from "../motion";

// Fixed order and colours: our system first, the baseline second (validated for colour-blind safety)
const SYSTEMS = [
  { key: "graphrag", label: "GraphRAG (ours)", color: "#4f46e5" },
  { key: "plain_llm", label: "Same LLM, no graph", color: "#f59e0b" },
];

const TYPES = {
  severity: "Severity + CVSS score of a CVE",
  cve_to_cwe: "Weakness (CWE) behind a CVE",
  cwe_to_capec: "Attack patterns (CAPEC) for a CWE",
  capec_to_attack: "ATT&CK techniques for a CAPEC",
  cve_count: "Number of CVEs linked to a CWE",
};

const pct = (x) => `${Math.round(x * 100)}%`;

function truthText(row) {
  if (row.type === "severity") return `${row.truth.severity}, ${row.truth.base_score}`;
  return Array.isArray(row.truth) ? row.truth.join(", ") : String(row.truth);
}

function Bars({ summary }) {
  const [tip, setTip] = useState(null);
  return (
    <div className="bars" onMouseLeave={() => setTip(null)}>
      {Object.entries(TYPES).map(([type, label]) => (
        <div className="bar-group" key={type}>
          <p>{label}</p>
          {SYSTEMS.map((s) => {
            const value = summary[s.key].by_type[type] ?? 0;
            return (
              <div className="bar-row" key={s.key}
                   onMouseEnter={() => setTip(`${label} · ${s.label}: ${pct(value)}`)}>
                <span className="bar-track">
                  <span className="bar" style={{ width: `${Math.max(value * 100, 1)}%`, background: s.color }} />
                </span>
                <b>{pct(value)}</b>
              </div>
            );
          })}
        </div>
      ))}
      <p className="bar-tip" aria-live="polite">{tip || "Hover a bar for details."}</p>
    </div>
  );
}

export default function Research() {
  const [report, setReport] = useState(null);
  const [failed, setFailed] = useState(false);
  const scope = useRef(null);
  const title = useRef(null);
  useMotion(scope, report);
  useHeadline(title);

  useEffect(() => {
    fetch("/eval-results.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setReport)
      .catch(() => setFailed(true));
  }, []);

  const rag = report?.summary.graphrag;
  const plain = report?.summary.plain_llm;
  // Examples where the graph changed the outcome, for the side-by-side table
  const examples = report
    ? report.rows.filter((r) => r.graphrag.accuracy > r.plain_llm.accuracy).slice(0, 6)
    : [];

  return (
    <>
      <Backdrop shape="scroll" />
      <Nav current="research" />
      <main className="research" ref={scope}>
        <p className="eyebrow">Research results</p>
        <h1 ref={title}><Words text="Does a knowledge graph make the AI more accurate?" /></h1>
        <p className="sub">
          The base paper (PNNL-36792) showed four examples but no numbers. We measured it:
          the same model answers the same questions, once with our graph and once without.
        </p>

        {failed && <p className="card error">No results yet. Run <code>python -m eval.run_eval</code> in backend/.</p>}
        {!report && !failed && <div className="card skeleton"><span /><span /><span /></div>}

        {report && (
          <>
            <section className="tiles">
              <div className="tile" data-reveal>
                <span>Accuracy</span>
                <b data-count={Math.round(rag.accuracy * 100)} data-suffix="%">{pct(rag.accuracy)}</b>
                <small>vs {pct(plain.accuracy)} without the graph</small>
              </div>
              <div className="tile" data-reveal>
                <span>Hallucinated IDs</span>
                <b data-count={Math.round(rag.hallucination_rate * 100)} data-suffix="%">{pct(rag.hallucination_rate)}</b>
                <small>vs {pct(plain.hallucination_rate)} without the graph</small>
              </div>
              <div className="tile" data-reveal>
                <span>Median answer time</span>
                <b>{rag.median_latency_s}s</b>
                <small>vs {plain.median_latency_s}s without the graph</small>
              </div>
              <div className="tile" data-reveal>
                <span>Questions</span>
                <b data-count={report.questions}>{report.questions}</b>
                <small>{Object.keys(TYPES).length} types · answers from Neo4j</small>
              </div>
            </section>

            <section className="card" data-reveal>
              <div className="chart-head">
                <h2>Accuracy by question type</h2>
                <div className="legend">
                  {SYSTEMS.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
                </div>
              </div>
              <Bars summary={report.summary} />
            </section>

            <section className="card" data-reveal>
              <h2>How we tested it</h2>
              <ol className="steps">
                <li><b>Questions with known answers.</b> We picked random CVEs, CWEs and CAPECs from Neo4j and wrote
                  questions whose correct answer is stored in the graph, so nothing is judged by hand.</li>
                <li><b>Two systems, one model.</b> {report.model} answers each question twice: with the facts our
                  graph retrieves, and alone. Any difference comes from the graph.</li>
                <li><b>Automatic scoring.</b> ID questions use F1 (correct IDs found vs IDs named). Score questions
                  need the right severity and number; count questions need the exact count.</li>
                <li><b>Hallucination rate.</b> The share of IDs an answer named that are not real links for that
                  entity in the official MITRE and NVD data.</li>
              </ol>
            </section>

            {examples.length > 0 && (
              <section className="card" data-reveal>
                <h2>Where the graph made the difference</h2>
                <div className="table-scroll">
                  <table className="compare">
                    <thead>
                      <tr><th>Question</th><th>Correct answer</th><th>Without graph</th><th>GraphRAG</th></tr>
                    </thead>
                    <tbody>
                      {examples.map((r) => (
                        <tr key={r.id}>
                          <td>{r.question}</td>
                          <td className="mono">{truthText(r)}</td>
                          <td>{r.plain_llm.text}</td>
                          <td>{r.graphrag.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="card" data-reveal>
              <h2>Limits, honestly</h2>
              <ul className="steps">
                <li>{report.questions} questions is a pilot; the plan is 150 across more question types.</li>
                <li>Every question names an ID, the case our retrieval handles best. Vague questions with no ID use
                  keyword search and are not scored yet, so 100% here does not mean 100% on every question.</li>
                <li>GraphRAG answer time includes waits for the free Groq rate limit (8,000 tokens a minute),
                  because each answer sends the retrieved facts. A paid tier would be much faster.</li>
                <li>Data covers CVEs published in 2024 only.</li>
              </ul>
              <p className="note">Run on {report.run_at} · {report.model} · reasoning effort {report.reasoning_effort}</p>
            </section>
          </>
        )}
      </main>
    </>
  );
}

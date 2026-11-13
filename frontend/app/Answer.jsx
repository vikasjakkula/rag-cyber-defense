"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import AttackGraph from "./AttackGraph";
import { sourceUrl } from "./api";

const REFUSAL = "I only answer cybersecurity questions";
const SHOWN = 12; // how many sources to list

// Markdown text, with a blinking bar at the end while the AI is still writing it
function Text({ text, typing }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text + (typing ? " ▍" : "")}</ReactMarkdown>;
}

// Every record the answer used, as {id, name}, without duplicates
function collectSources(facts) {
  const found = new Map();
  for (const fact of facts) {
    const main = fact.cve || fact.cwe || fact.capec || fact.technique;
    const linked = [...(fact.cwes || []), ...(fact.capecs || []), ...(fact.techniques || [])];
    for (const item of [main, ...linked]) {
      if (item?.id && !found.has(item.id)) found.set(item.id, item.name || "");
    }
  }
  return [...found].map(([id, name]) => ({ id, name }));
}

// One question and its answer. `brief` shows only the text (used for earlier turns of the chat).
export default function Answer({ result, brief = false }) {
  const refused = result.answer.startsWith(REFUSAL);
  const lookedUp = result.mode === "id_lookup" && !refused; // the question named a real ID
  const sources = lookedUp ? collectSources(result.facts) : [];
  const g = result.grounding;

  return (
    <section className="reply">
      <p className="bubble">{result.question}</p>

      {result.answer ? (
        <div className="answer"><Text text={result.answer} typing={result.typing === "answer"} /></div>
      ) : result.typing ? (
        <div className="skeleton"><span /><span /></div>
      ) : (
        <p className="answer muted">No answer this time.</p>
      )}

      {!brief && <>
        {/* Every ID and score the AI wrote, checked against the records Neo4j returned */}
        {g?.score != null && !refused && (
          g.unsupported.length === 0
            ? <p className="grounding ok">Verified: all {g.supported.length} IDs and scores in this answer are in the graph.</p>
            : <p className="grounding warn">Not found in the graph: {g.unsupported.join(", ")}</p>
        )}

        {lookedUp && result.facts.slice(0, 2).map((fact, i) => <AttackGraph key={i} fact={fact} link={sourceUrl} />)}

        {result.details && (
          <div className="details">
            <h2>Technical explanation</h2>
            <Text text={result.details} typing={result.typing === "details"} />
          </div>
        )}

        {result.not_found?.length > 0 && <p className="note">Not in the dataset: {result.not_found.join(", ")}</p>}

        {sources.length > 0 && (
          <div className="sources">
            <h2>Sources <span className="count">{sources.length}</span></h2>
            <ul>
              {sources.slice(0, SHOWN).map((s) => (
                <li key={s.id}>
                  <a href={sourceUrl(s.id)} target="_blank" rel="noreferrer">{s.id}</a>
                  <span>{s.name}</span>
                </li>
              ))}
            </ul>
            {sources.length > SHOWN && <p className="note">and {sources.length - SHOWN} more</p>}
          </div>
        )}
      </>}
    </section>
  );
}

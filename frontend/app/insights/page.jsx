"use client";

import { useEffect, useRef, useState } from "react";

import Backdrop from "../Backdrop";
import Nav from "../Nav";
import { useHeadline, useMotion, Words } from "../motion";

const INK = "#4f46e5";
// Severity is ordered, so it uses one hue from light to dark
const SEVERITY = [["LOW", "#c7d2fe"], ["MEDIUM", "#818cf8"], ["HIGH", "#4f46e5"], ["CRITICAL", "#312e81"]];
const RANKERS = [
  { key: "fix_first", label: "Our Fix-first score", color: "#4f46e5" },
  { key: "cvss_only", label: "CVSS score alone", color: "#f59e0b" },
  { key: "random", label: "Random order", color: "#9ca3af" },
];
const fmt = (n) => Number(n).toLocaleString("en-US");
const nvd = (id) => `https://nvd.nist.gov/vuln/detail/${id}`;

// Every panel says what it shows and why it matters, so it can be presented in one breath
function Panel({ step, title, what, why, children, wide }) {
  return (
    <section className={wide ? "card panel wide" : "card panel"} data-reveal>
      <div className="panel-head">
        <span className="step">{step}</span>
        <div>
          <h2>{title}</h2>
          <p className="what">{what}</p>
        </div>
      </div>
      {children}
      {why && <p className="why"><b>Why it matters:</b> {why}</p>}
    </section>
  );
}

function HBars({ rows, color = INK, max, suffix = "", tip }) {
  const top = max ?? Math.max(...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.label} title={tip ? tip(r) : `${r.label}: ${fmt(r.value)}${suffix}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${Math.max((r.value / top) * 100, 0.8)}%`, background: r.color || color }} />
          </span>
          <b>{fmt(r.value)}{suffix}</b>
        </div>
      ))}
    </div>
  );
}

function Trend({ months }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 220, P = { l: 44, r: 12, t: 14, b: 28 };
  const max = Math.ceil(Math.max(...months.map((m) => m.n)) / 1000) * 1000;
  const x = (i) => P.l + (i * (W - P.l - P.r)) / (months.length - 1);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const line = months.map((m, i) => `${i ? "L" : "M"}${x(i)},${y(m.n)}`).join(" ");
  const label = (m) => new Date(`${m.month}-01T00:00:00`).toLocaleString("en-US", { month: "short" });
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(months.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (months.length - 1)))));
  };
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={move} onMouseLeave={() => setHover(null)}
           role="img" aria-label="New CVEs per month in 2024">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={P.l - 8} y={y(max * f) + 4} textAnchor="end" className="axis">{fmt(max * f)}</text>
          </g>
        ))}
        <path d={`${line} L${x(months.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`} className="area" />
        <path d={line} className="line" />
        {months.map((m, i) => (
          <text key={m.month} x={x(i)} y={H - 8} textAnchor="middle" className="axis">{label(m)}</text>
        ))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="cross" />
            <circle cx={x(hover)} cy={y(months[hover].n)} r="5" className="dot" />
          </g>
        )}
        <rect x={P.l} y={P.t} width={W - P.l - P.r} height={H - P.t - P.b} fill="transparent" />
      </svg>
      <p className="tip">
        {hover != null ? <><b>{label(months[hover])} 2024:</b> {fmt(months[hover].n)} new CVEs</> : "Hover the chart to read a month."}
      </p>
    </div>
  );
}

function Validation({ v }) {
  const cuts = ["100", "500", "1000"];
  const top = Math.max(...cuts.flatMap((c) => RANKERS.map((r) => v[r.key][c])));
  const lift = (v.fix_first["500"] / v.random["500"]).toFixed(1);
  return (
    <>
      <div className="legend">
        {RANKERS.map((r) => <span key={r.key}><i style={{ background: r.color }} />{r.label}</span>)}
      </div>
      <div className="vgroups">
        {cuts.map((c) => (
          <div key={c} className="vgroup">
            <p>Top {fmt(c)} bugs to fix</p>
            {RANKERS.map((r) => (
              <div className="hbar" key={r.key} title={`${r.label}: ${v[r.key][c]} of the top ${c} are known exploited`}>
                <span className="hbar-track">
                  <span className="hbar-fill" style={{ width: `${Math.max((v[r.key][c] / top) * 100, 0.8)}%`, background: r.color }} />
                </span>
                <b>{v[r.key][c]}</b>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="headline">
        In the top 500, our score finds <b>{v.fix_first["500"]}</b> really exploited bugs: <b>{lift}×</b> random
        and <b>{(v.fix_first["500"] / v.cvss_only["500"]).toFixed(1)}×</b> CVSS alone.
      </p>
    </>
  );
}

export default function Insights() {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const scope = useRef(null);
  const title = useRef(null);
  useMotion(scope, d);
  useHeadline(title);
  useEffect(() => {
    fetch("/analytics.json").then((r) => (r.ok ? r.json() : Promise.reject())).then(setD).catch(() => setFailed(true));
  }, []);

  const f = d?.funnel;
  const sev = d ? Object.fromEntries(d.severity.map((s) => [s.severity, s.n])) : {};

  return (
    <>
      <Backdrop shape="scroll" />
      <Nav current="insights" />
      <main className="insights" ref={scope}>
        <p className="eyebrow">Insights · CVEs published in 2024</p>
        <h1 ref={title}><Words text="What 38,461 vulnerabilities tell us" /></h1>
        <p className="sub">Everything below is computed from our knowledge graph and CISA&apos;s list of bugs attackers really used.</p>

        {failed && <p className="card error">No analytics yet. Run <code>python -m analytics.build</code> in backend/.</p>}
        {!d && !failed && <div className="card skeleton"><span /><span /><span /></div>}

        {d && (
          <>
            <section className="tiles six">
              {[
                ["Vulnerabilities (CVE)", d.nodes.CVE],
                ["Weaknesses (CWE)", d.nodes.CWE],
                ["Attack patterns (CAPEC)", d.nodes.CAPEC],
                ["Attacker techniques", d.nodes.ATTACK],
                ["Links between them", d.links],
                ["Really exploited (KEV)", d.validation.kev_in_data],
              ].map(([label, n]) => (
                <div className="tile" key={label} data-reveal><span>{label}</span><b data-count={n}>{fmt(n)}</b></div>
              ))}
            </section>

            <div className="panels">
              <Panel step="1" wide title="From bug to attacker action"
                what="How many CVEs we can follow through each step of the chain."
                why={`${Math.round((f.attack / f.all) * 100)}% of 2024 bugs (${fmt(f.attack)}) connect all the way to a real attacker technique, so we can explain what an attacker does next, not just that a bug exists.`}>
                <HBars rows={[
                  { label: "All CVEs", value: f.all },
                  { label: "→ linked to a weakness (CWE)", value: f.cwe },
                  { label: "→ to an attack pattern (CAPEC)", value: f.capec },
                  { label: "→ to an ATT&CK technique", value: f.attack },
                ]} tip={(r) => `${r.label}: ${fmt(r.value)} (${Math.round((r.value / f.all) * 100)}%)`} />
              </Panel>

              <Panel step="2" title="New vulnerabilities every month"
                what="CVEs published per month in 2024."
                why="Thousands arrive each month; no team can read them all by hand.">
                <Trend months={d.monthly} />
              </Panel>

              <Panel step="3" title="How severe they are"
                what="CVSS severity of every 2024 CVE."
                why={`${fmt((sev.HIGH || 0) + (sev.CRITICAL || 0))} are High or Critical, so "fix everything severe" is still too many. We need a better order.`}>
                <HBars rows={SEVERITY.map(([s, color]) => ({ label: s[0] + s.slice(1).toLowerCase(), value: sev[s] || 0, color }))} />
              </Panel>

              <Panel step="4" title="The most common mistakes"
                what="Weaknesses behind the most CVEs, with their average CVSS score."
                why="Fixing one weakness type, like cross-site scripting, in your code closes thousands of possible bugs at once.">
                <HBars rows={d.top_cwes.map((w) => ({ label: `${w.id}`, value: w.n, name: w.name, avg: w.avg_score }))}
                       tip={(r) => `${r.label} ${r.name}: ${fmt(r.value)} CVEs, average score ${r.avg}`} />
              </Panel>

              <Panel step="5" title="What attackers can reach"
                what="CVEs whose attack paths lead to each ATT&CK tactic (the attacker's goal)."
                why="Shows defenders which goals, like stealing logins or hiding, most 2024 bugs open the door to.">
                <HBars rows={d.tactics.map((t) => ({ label: t.tactic.replace(/-/g, " "), value: t.n }))} />
              </Panel>

              <Panel step="6" wide title="Fix-first: which bugs to patch first"
                what="Our score ranks all 38,002 scored CVEs. Then we checked it against CISA's list of bugs attackers really used."
                why="It is tested on real attacks, not just a formula: ranking by our score puts more really exploited bugs at the top than CVSS alone.">
                <div className="formula">
                  <span><b>How bad</b>CVSS base score ÷ 10</span><i>×</i>
                  <span><b>How easy</b>exploitability ÷ 3.9</span><i>×</i>
                  <span><b>How far</b>0.5 + 0.5 × reachable techniques ÷ 10</span><i>=</i>
                  <span className="result"><b>Fix-first</b>0 to 100</span>
                </div>
                <Validation v={d.validation} />
              </Panel>

              <Panel step="7" wide title="Real attacks in our graph"
                what={`${d.validation.kev_in_data} of our 2024 CVEs are on CISA's exploited list, ${d.validation.ransomware_in_data} of them used by ransomware. Here are the highest ranked, with their position in our Fix-first order.`}>
                <div className="table-scroll">
                  <table className="compare">
                    <thead><tr><th>Rank</th><th>CVE</th><th>Product</th><th>Fix-first</th><th>Ransomware</th></tr></thead>
                    <tbody>
                      {d.exploited.map((r) => (
                        <tr key={r.id}>
                          <td className="mono">#{fmt(r.rank)}</td>
                          <td><a href={nvd(r.id)} target="_blank" rel="noreferrer" className="mono">{r.id}</a></td>
                          <td>{r.vendor}</td>
                          <td><span className="meter"><i style={{ width: `${r.score}%` }} /></span>{r.score}</td>
                          <td>{r.ransomware ? <span className="tag danger">Used by ransomware</span> : <span className="tag">No known use</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>

            <p className="note">Built {d.built_at} from Neo4j and CISA KEV catalog {d.kev_version}.</p>
          </>
        )}
      </main>
    </>
  );
}

"use client";

import { useMemo, useState } from "react";

const LAYERS = ["CVE", "CWE", "CAPEC", "ATT&CK"];
const COLORS = ["#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6"];
const MAX_PER_LAYER = 6; // more than this per column is unreadable; the rest is counted as "+N more"
const W = 720, ROW = 54, BOX_W = 132, BOX_H = 34;

const layerOf = (id) =>
  id.startsWith("CVE-") ? 0 : id.startsWith("CWE-") ? 1 : id.startsWith("CAPEC-") ? 2 : 3;

// Turn one retrieved fact into chains of IDs, e.g. ["CVE-2024-24919", "CWE-200", "CAPEC-13", "T1574.006"]
function chainsFrom(fact) {
  const root = fact.cve || fact.cwe || fact.capec || fact.technique;
  if (!root?.id) return null;
  const names = new Map([[root.id, root.name || ""]]);
  for (const key of ["cwes", "capecs", "techniques"]) {
    for (const item of fact[key] || []) if (item?.id) names.set(item.id, item.name || "");
  }
  const id = (x) => (typeof x === "string" ? x : x?.id);
  const real = (x) => x && !x.startsWith("...");
  let chains = [];
  if (fact.paths?.length) {
    chains = fact.paths.filter(real).map((p) => [root.id, ...p.split(" -> ").filter(Boolean)]);
  } else if (fact.capec) {
    chains = [
      ...(fact.cwes || []).map(id).filter(real).map((w) => [w, root.id]),
      ...(fact.techniques || []).map(id).filter(real).map((t) => [root.id, t]),
    ];
  } else if (fact.technique) {
    chains = (fact.capecs || []).map(id).filter(real).map((c) => [c, root.id]);
  }
  if (!chains.length) chains = [[root.id]];
  return { root, names, chains };
}

function layout({ chains }) {
  // Keep the IDs that appear in the most chains, per column
  const freq = new Map();
  for (const c of chains) for (const n of c) freq.set(n, (freq.get(n) || 0) + 1);
  const columns = LAYERS.map(() => []);
  for (const n of freq.keys()) columns[layerOf(n)].push(n);
  const hidden = columns.map((c) => Math.max(0, c.length - MAX_PER_LAYER));
  const kept = columns.map((c) => c.sort((a, b) => freq.get(b) - freq.get(a) || a.localeCompare(b)).slice(0, MAX_PER_LAYER));

  const used = kept.map((c, i) => i).filter((i) => kept[i].length);
  const rows = Math.max(...kept.map((c, i) => c.length + (hidden[i] ? 1 : 0)));
  const height = rows * ROW + 24;
  const pos = new Map();
  used.forEach((layer, col) => {
    const x = used.length === 1 ? W / 2 : 80 + (col * (W - 160)) / (used.length - 1);
    const top = (height - kept[layer].length * ROW) / 2 + ROW / 2;
    kept[layer].forEach((n, j) => pos.set(n, { x, y: top + j * ROW, layer }));
  });

  const visibleChains = chains.filter((c) => c.every((n) => pos.has(n)));
  const edges = new Map();
  for (const c of visibleChains) {
    for (let i = 0; i + 1 < c.length; i++) edges.set(`${c[i]}|${c[i + 1]}`, [c[i], c[i + 1]]);
  }
  const more = used
    .filter((layer) => hidden[layer])
    .map((layer) => {
      const last = pos.get(kept[layer][kept[layer].length - 1]);
      return { x: last.x, y: last.y + ROW * 0.85, text: `+${hidden[layer]} more` };
    });
  return { pos, edges: [...edges.values()], chains: visibleChains, height, used, more };
}

function curve(a, b) {
  const x1 = a.x + BOX_W / 2, x2 = b.x - BOX_W / 2, mid = (x1 + x2) / 2;
  return `M${x1},${a.y} C${mid},${a.y} ${mid},${b.y} ${x2},${b.y}`;
}

// CVSS rings: base score, exploitability and impact, as stored on every CVE node
function Rings({ cve }) {
  const C = 2 * Math.PI * 26;
  const items = [
    ["Base score", cve.base_score, 10],
    ["Exploitability", cve.exploitability_score, 3.9],
    ["Impact", cve.impact_score, 6],
  ].filter(([, v]) => typeof v === "number");
  if (!items.length) return null;
  return (
    <div className="rings">
      {items.map(([label, value, max], i) => (
        <div className="ring" key={label}>
          <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
            <circle cx="32" cy="32" r="26" className="ring-track" />
            <circle
              cx="32" cy="32" r="26" className="ring-fill"
              style={{ strokeDasharray: C, strokeDashoffset: C * (1 - Math.min(1, value / max)), animationDelay: `${i * 0.12}s`, stroke: COLORS[i === 0 ? 0 : i === 1 ? 1 : 2] }}
            />
            <text x="32" y="36" textAnchor="middle">{value}</text>
          </svg>
          <span>{label}<small> / {max}</small></span>
        </div>
      ))}
      {cve.severity && <b className={`sev sev-${cve.severity.toLowerCase()}`}>{cve.severity}</b>}
    </div>
  );
}

export default function AttackGraph({ fact, link }) {
  const data = useMemo(() => chainsFrom(fact), [fact]);
  const graph = useMemo(() => (data ? layout(data) : null), [data]);
  const [active, setActive] = useState(null);
  if (!graph) return null;

  // Hovering a node traces every chain that passes through it
  const lit = new Set();
  if (active) for (const c of graph.chains) if (c.includes(active)) c.forEach((n) => lit.add(n));
  const on = (n) => !active || lit.has(n);
  const total = fact.counts?.paths ?? fact.cve?.path_count;

  return (
    <div className="explorer">
      <div className="explorer-head">
        <h2>Attack path explorer</h2>
        <div className="legend">
          {LAYERS.map((l, i) => graph.used.includes(i) && (
            <span key={l}><i style={{ background: COLORS[i] }} />{l}</span>
          ))}
        </div>
      </div>

      {fact.cve && <Rings cve={fact.cve} />}

      <div className="graph-scroll">
        <svg viewBox={`0 0 ${W} ${graph.height}`} className="graph" role="img"
             aria-label={`Attack paths from ${data.root.id}`}>
          {graph.edges.map(([a, b], i) => {
            const d = curve(graph.pos.get(a), graph.pos.get(b));
            const live = on(a) && on(b);
            const color = COLORS[layerOf(b)];
            return (
              <g key={`${a}|${b}`} className={live ? "edge" : "edge dim"}>
                <path d={d} className="edge-base" />
                <path d={d} className="edge-flow" style={{ stroke: color }} />
                {live && (
                  <circle r="3.2" fill={color}>
                    <animateMotion dur="2.2s" begin={`${(i % 7) * 0.3}s`} repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}
          {[...graph.pos].map(([n, p]) => (
            <a key={n} href={link(n)} target="_blank" rel="noreferrer"
               className={on(n) ? "node" : "node dim"} style={{ animationDelay: `${p.layer * 0.12}s` }}
               onMouseEnter={() => setActive(n)} onMouseLeave={() => setActive(null)}
               onFocus={() => setActive(n)} onBlur={() => setActive(null)}>
              <title>{`${n}${data.names.get(n) ? ` · ${data.names.get(n)}` : ""}`}</title>
              <rect x={p.x - BOX_W / 2} y={p.y - BOX_H / 2} width={BOX_W} height={BOX_H} rx="17"
                    className={n === data.root.id ? "box root" : "box"} style={{ stroke: COLORS[p.layer] }} />
              <circle cx={p.x - BOX_W / 2 + 16} cy={p.y} r="4.5" fill={COLORS[p.layer]} />
              <text x={p.x + 7} y={p.y + 4.5} textAnchor="middle">{n}</text>
            </a>
          ))}
          {graph.more.map((m) => (
            <text key={`${m.x}-${m.y}`} x={m.x} y={m.y} textAnchor="middle" className="more">{m.text}</text>
          ))}
        </svg>
      </div>

      <p className="explorer-hint">
        {active
          ? <><b>{active}</b> {data.names.get(active) || ""}</>
          : <>{total ? `${total} real path${total === 1 ? "" : "s"} in the graph. ` : ""}Hover a node to trace its paths, click to open the official record.</>}
      </p>
    </div>
  );
}

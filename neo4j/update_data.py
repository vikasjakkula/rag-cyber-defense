"""Keep the graph up to date with the newest public data.  Docker runs it as the "updater" service.

    python neo4j/update_data.py          update once
    python neo4j/update_data.py --loop   update now, then again every UPDATE_EVERY_HOURS (default 24)

What one update does:
  1. CVEs   from the NVD API 2.0: every CVE published since NVD_START_YEAR (first run), then only the
            ones added or changed since the last update. A free NVD_API_KEY makes it ~10x faster.
  2. CWE, CAPEC, ATT&CK  from MITRE's official download files (the same files the project started from).
  3. Links  CVE -> CWE, CWE -> CAPEC, CAPEC -> ATT&CK are rebuilt for what changed (MERGE: never duplicated).
  4. Metrics and embeddings for the new or changed nodes, then the date is saved on a (:Meta) node,
     which the website shows as "Data updated".
Nothing is deleted, so the graph only grows and the 2024 baseline stays.
"""
import csv
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone

from neo4j import GraphDatabase

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
CWE_URL = "https://cwe.mitre.org/data/csv/1000.csv.zip"
CAPEC_URL = "https://capec.mitre.org/data/csv/1000.csv.zip"
ATTACK_URL = "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json"

API_KEY = os.getenv("NVD_API_KEY", "").strip()
START_YEAR = int(os.getenv("NVD_START_YEAR", "2024"))
PAGE = 1000                                  # CVEs per request (NVD allows 2000, but big pages time out)
WINDOW = timedelta(days=119)                 # the NVD API allows at most 120 days per date range
PAUSE = 1.0 if API_KEY else 6.5              # NVD limit: 50 requests / 30 s with a key, 5 without

driver = GraphDatabase.driver(os.getenv("NEO4J_URI", "bolt://localhost:7687"),
                              auth=(os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "password123")),
                              notifications_min_severity="OFF")  # hide "label does not exist yet" notes


def query(cypher, **params):
    records, _, _ = driver.execute_query(cypher, params)
    return [r.data() for r in records]


def download(url, headers=None, tries=5):
    """GET a URL, retrying politely when the server is busy."""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "cyber-defense-rag-updater", **(headers or {})})
            with urllib.request.urlopen(req, timeout=300) as response:
                return response.read()
        except Exception as exc:
            if attempt == tries - 1:
                raise
            print(f"  retry {attempt + 1} after error: {exc}")
            time.sleep(10 * (attempt + 1))


def clean(text):
    return " ".join(str(text or "").split())


# ---------------------------------------------------------------- 1. CVEs from NVD
def parse_cve(item):
    """One NVD API record -> the same fields the CSV loader writes (None for a rejected CVE)."""
    c = item["cve"]
    if c.get("vulnStatus") == "Rejected":
        return None
    desc = next((d["value"] for d in c.get("descriptions", []) if d["lang"] == "en"), "")
    score = severity = expl = impact = None
    for key in ("cvssMetricV31", "cvssMetricV40", "cvssMetricV30", "cvssMetricV2"):
        metrics = c.get("metrics", {}).get(key) or []
        if metrics:
            m = next((x for x in metrics if x.get("type") == "Primary"), metrics[0])
            score = m["cvssData"].get("baseScore")
            severity = m["cvssData"].get("baseSeverity") or m.get("baseSeverity")
            expl, impact = m.get("exploitabilityScore"), m.get("impactScore")
            break
    cwes = sorted({d["value"] for w in c.get("weaknesses", []) for d in w.get("description", [])
                   if d["value"].startswith("CWE-")})
    return {"id": c["id"], "name": clean(c.get("cisaVulnerabilityName")) or None, "description": clean(desc),
            "base_score": score, "exploitability_score": expl, "impact_score": impact, "severity": severity,
            "published": c["published"][:10], "cwes": cwes}


SAVE_CVES = """
UNWIND $rows AS row
MERGE (c:CVE {id: row.id})
SET c.name = row.name, c.description = row.description, c.base_score = row.base_score,
    c.exploitability_score = row.exploitability_score, c.impact_score = row.impact_score,
    c.severity = row.severity, c.published = date(row.published), c.embedding = null
WITH c, row
OPTIONAL MATCH (c)-[old:CVE_CWE]->() DELETE old
WITH DISTINCT c, row
UNWIND row.cwes AS cwe_id
MATCH (w:CWE {id: cwe_id})
MERGE (c)-[r:CVE_CWE]->(w)
SET r.evidence_source = 'nvd_api:weaknesses', r.mapping_method = 'direct_reference'
"""


def update_cves(since):
    """Fetch CVEs from NVD in 119-day windows. First run: by publish date; later: by last-modified date."""
    now = datetime.now(timezone.utc)
    field = "pub" if since is None else "lastMod"
    start = since or datetime(START_YEAR, 1, 1, tzinfo=timezone.utc)
    headers = {"apiKey": API_KEY} if API_KEY else {}
    saved = 0
    while start < now:
        end = min(start + WINDOW, now)
        index = 0
        while True:
            params = {f"{field}StartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                      f"{field}EndDate": end.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                      "resultsPerPage": PAGE, "startIndex": index}
            data = json.loads(download(f"{NVD_URL}?{urllib.parse.urlencode(params)}", headers))
            rows = [r for r in map(parse_cve, data.get("vulnerabilities", []))
                    if r and int(r["published"][:4]) >= START_YEAR]
            if rows:
                query(SAVE_CVES, rows=rows)
                saved += len(rows)
            index += PAGE
            print(f"  CVEs {start:%Y-%m-%d} to {end:%Y-%m-%d}: {min(index, data['totalResults'])}/{data['totalResults']}")
            time.sleep(PAUSE)
            if index >= data["totalResults"]:
                break
        start = end
    return saved


# ---------------------------------------------------------------- 2. CWE, CAPEC, ATT&CK from MITRE
def read_zip_csv(url):
    with zipfile.ZipFile(io.BytesIO(download(url))) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        return list(csv.DictReader(io.StringIO(z.read(name).decode("utf-8"))))


def update_mitre():
    cwes = [{"id": f"CWE-{r['CWE-ID']}", "name": clean(r["Name"]), "category": r["Weakness Abstraction"],
             "description": clean(r["Description"]),
             "capecs": [f"CAPEC-{x}" for x in r["Related Attack Patterns"].split("::") if x.strip().isdigit()],
             "parents": list(dict.fromkeys(f"CWE-{p}" for p in re.findall(
                 r"NATURE:ChildOf:CWE ID:(\d+):VIEW ID:1000", r["Related Weaknesses"])))}
            for r in read_zip_csv(CWE_URL)]
    capecs = [{"id": f"CAPEC-{r[chr(39) + 'ID']}", "name": clean(r["Name"]), "category": r["Abstraction"],
               "description": clean(r["Description"]), "likelihood": r["Likelihood Of Attack"] or None,
               "severity": r["Typical Severity"] or None,
               "cwes": [f"CWE-{x}" for x in r["Related Weaknesses"].split("::") if x.strip().isdigit()],
               "attacks": [f"T{x}" for x in re.findall(r"TAXONOMY NAME:ATTACK:ENTRY ID:([\d.]+)", r["Taxonomy Mappings"])]}
              for r in read_zip_csv(CAPEC_URL) if r["Status"] != "Deprecated"]
    objects = json.loads(download(ATTACK_URL))["objects"]
    attacks = []
    for o in objects:
        if o["type"] != "attack-pattern" or o.get("revoked") or o.get("x_mitre_deprecated"):
            continue
        ref = next((e for e in o.get("external_references", []) if e.get("source_name") == "mitre-attack"), None)
        if ref:
            attacks.append({"id": ref["external_id"], "name": clean(o["name"]), "description": clean(o.get("description")),
                            "type": "sub-technique" if o.get("x_mitre_is_subtechnique") else "technique",
                            "tactics": [p["phase_name"] for p in o.get("kill_chain_phases", [])], "url": ref.get("url")})

    # Nodes first (a changed description clears the embedding so it is rebuilt), then the links
    query("""UNWIND $rows AS row MERGE (n:ATTACK {id: row.id})
             SET n.embedding = CASE WHEN n.description = row.description THEN n.embedding END,
                 n.name = row.name, n.description = row.description, n.type = row.type,
                 n.category = row.tactics, n.url = row.url""", rows=attacks)
    query("""UNWIND $rows AS row MERGE (n:CWE {id: row.id})
             SET n.embedding = CASE WHEN n.description = row.description THEN n.embedding END,
                 n.name = row.name, n.category = row.category, n.description = row.description""", rows=cwes)
    query("""UNWIND $rows AS row MERGE (n:CAPEC {id: row.id})
             SET n.embedding = CASE WHEN n.description = row.description THEN n.embedding END,
                 n.name = row.name, n.category = row.category, n.description = row.description,
                 n.likelihood = row.likelihood, n.severity = row.severity""", rows=capecs)
    query("""UNWIND $rows AS row MATCH (a:CWE {id: row.id})
             UNWIND row.capecs AS target MATCH (b:CAPEC {id: target}) MERGE (a)-[:CWE_CAPEC]->(b)""", rows=cwes)
    query("""UNWIND $rows AS row MATCH (a:CWE {id: row.id})
             UNWIND row.parents AS target MATCH (b:CWE {id: target}) MERGE (a)-[:CWE_CHILD]->(b)""", rows=cwes)
    query("""UNWIND $rows AS row MATCH (b:CAPEC {id: row.id})
             UNWIND row.cwes AS source MATCH (a:CWE {id: source}) MERGE (a)-[:CWE_CAPEC]->(b)""", rows=capecs)
    query("""UNWIND $rows AS row MATCH (a:CAPEC {id: row.id})
             UNWIND row.attacks AS target MATCH (b:ATTACK {id: target}) MERGE (a)-[:CAPEC_ATTACK]->(b)""", rows=capecs)
    return len(cwes), len(capecs), len(attacks)


# ---------------------------------------------------------------- 3. metrics, embeddings, date
METRICS = """
MATCH (c:CVE) WHERE c.max_path_depth IS NULL OR c.embedding IS NULL
CALL (c) {
  OPTIONAL MATCH (c)-[:CVE_CWE]->(w:CWE)
  OPTIONAL MATCH (w)-[:CWE_CAPEC]->(p:CAPEC)
  OPTIONAL MATCH (p)-[:CAPEC_ATTACK]->(t:ATTACK)
  WITH c, count(DISTINCT w) AS cwes, count(DISTINCT p) AS capecs, count(DISTINCT t) AS attacks, count(w) AS paths,
       max(CASE WHEN t IS NOT NULL THEN 3 WHEN p IS NOT NULL THEN 2 WHEN w IS NOT NULL THEN 1 ELSE 0 END) AS depth
  SET c.cwe_count = cwes, c.capec_count = capecs, c.attack_count = attacks, c.path_count = paths,
      c.max_path_depth = depth, c.mapping_completeness = round(depth / 3.0, 3)
} IN TRANSACTIONS OF 2000 ROWS
"""


def update_once():
    began = datetime.now(timezone.utc)
    meta = query("MATCH (m:Meta {id: 'dataset'}) RETURN m.last_update AS last")
    since = meta[0]["last"].to_native() if meta and meta[0]["last"] else None
    print(f"Update started. Last update: {since or 'never (first run, from ' + str(START_YEAR) + ')'}")

    cwe_n, capec_n, attack_n = update_mitre()
    print(f"MITRE: {cwe_n} CWE, {capec_n} CAPEC, {attack_n} ATT&CK techniques refreshed")
    cve_n = update_cves(since)
    print(f"NVD: {cve_n} CVEs added or updated")

    with driver.session() as session:  # IN TRANSACTIONS needs an auto-commit session
        session.run(METRICS).consume()
    subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "embed_nodes.py")], check=True)

    totals = query("MATCH (c:CVE) RETURN count(c) AS cves")[0]
    query("""MERGE (m:Meta {id: 'dataset'})
             SET m.last_update = datetime($began), m.cve_count = $cves, m.last_changed = $changed""",
          began=began.isoformat(), cves=totals["cves"], changed=cve_n)
    print(f"Update finished: {totals['cves']} CVEs in the graph.")


if __name__ == "__main__":
    every = float(os.getenv("UPDATE_EVERY_HOURS", "24"))
    while True:
        try:
            update_once()
        except Exception as exc:  # a failed run is retried on the next cycle; the graph keeps its old data
            print(f"Update failed: {exc}")
        if "--loop" not in sys.argv:
            break
        print(f"Next update in {every:g} hours.")
        time.sleep(every * 3600)
    driver.close()

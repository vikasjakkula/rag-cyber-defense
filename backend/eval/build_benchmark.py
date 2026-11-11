"""Build the benchmark: questions whose correct answers come straight from Neo4j.

Run from backend/:  python -m eval.build_benchmark [questions_per_type]
Writes data/eval/benchmark.json. The file is committed, so every run scores the same questions.
"""
import json
import sys
from pathlib import Path

from eval import tls  # noqa: F401  (lets Windows verify Aura's certificate)
from graph.connection import run

OUT = Path(__file__).resolve().parents[2] / "data" / "eval" / "benchmark.json"

# Each type: a question template, a Cypher query returning (id, truth), and how the answer is scored.
# Small answer sets (1 to 3 IDs) keep the test fair: a short answer can name all of them.
TYPES = {
    "severity": {
        "question": "What is the severity and CVSS base score of {id}?",
        "cypher": """MATCH (c:CVE) WHERE c.base_score IS NOT NULL AND c.severity IS NOT NULL
                     RETURN c.id AS id, {severity: c.severity, base_score: c.base_score} AS truth
                     ORDER BY rand() LIMIT $n""",
    },
    "cve_to_cwe": {
        "question": "Which weakness (CWE) is behind {id}?",
        "cypher": """MATCH (c:CVE)-[:CVE_CWE]->(w:CWE) WITH c, collect(DISTINCT w.id) AS truth
                     WHERE size(truth) <= 3 RETURN c.id AS id, truth ORDER BY rand() LIMIT $n""",
    },
    "cwe_to_capec": {
        "question": "Which attack patterns (CAPEC) exploit {id}?",
        "cypher": """MATCH (w:CWE)-[:CWE_CAPEC]->(p:CAPEC) WITH w, collect(DISTINCT p.id) AS truth
                     WHERE size(truth) <= 3 RETURN w.id AS id, truth ORDER BY rand() LIMIT $n""",
    },
    "capec_to_attack": {
        "question": "Which MITRE ATT&CK techniques does {id} map to?",
        "cypher": """MATCH (p:CAPEC)-[:CAPEC_ATTACK]->(t:ATTACK) WITH p, collect(DISTINCT t.id) AS truth
                     WHERE size(truth) <= 3 RETURN p.id AS id, truth ORDER BY rand() LIMIT $n""",
    },
    "cve_count": {
        "question": "How many CVEs in the dataset are linked to {id}?",
        "cypher": """MATCH (w:CWE)<-[:CVE_CWE]-(c:CVE) WITH w, count(c) AS truth WHERE truth >= 2
                     RETURN w.id AS id, truth ORDER BY rand() LIMIT $n""",
    },
}


def build(per_type):
    items = []
    for kind, spec in TYPES.items():
        for row in run(spec["cypher"], n=per_type):
            items.append({"id": f"{kind}-{len(items) + 1:03d}", "type": kind, "entity": row["id"],
                          "question": spec["question"].format(id=row["id"]), "truth": row["truth"]})
    return items


if __name__ == "__main__":
    per_type = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    items = build(per_type)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"{len(items)} questions -> {OUT}")

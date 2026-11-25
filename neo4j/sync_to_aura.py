"""Copy the local Docker graph to Neo4j Aura (the database behind the Vercel site).

    python neo4j/sync_to_aura.py

Reads the local graph at bolt://localhost:7687 and the Aura login from .env (NEO4J_URI, NEO4J_USERNAME,
NEO4J_PASSWORD). Clears Aura, then copies every node and link, without the embeddings: Vercel answers
by ID and keyword, and leaving the vectors out keeps Aura's free tier small. Aura Free allows
200,000 nodes and 400,000 relationships, so the script stops before copying if the graph is bigger.
"""
import os
from pathlib import Path

try:  # Windows sometimes lacks the root certificate Aura uses
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

from neo4j import GraphDatabase

ENV = dict(line.split("=", 1) for line in Path(__file__).resolve().parents[1].joinpath(".env").read_text().splitlines()
           if "=" in line and not line.lstrip().startswith("#"))
LOCAL = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", os.getenv("LOCAL_NEO4J_PASSWORD", "password123")),
                             notifications_min_severity="OFF")
AURA = GraphDatabase.driver(ENV["NEO4J_URI"].strip(), auth=(ENV.get("NEO4J_USERNAME", "neo4j").strip(), ENV["NEO4J_PASSWORD"].strip()),
                            notifications_min_severity="OFF")
LABELS = ["CVE", "CWE", "CAPEC", "ATTACK", "Meta"]
BATCH = 5000
MAX_NODES, MAX_RELS = 200_000, 400_000


def local(cypher, **params):
    return [r.data() for r in LOCAL.execute_query(cypher, params)[0]]


def aura(cypher, **params):
    AURA.execute_query(cypher, params)


def main():
    nodes = local("MATCH (n) RETURN count(n) AS n")[0]["n"]
    rels = local("MATCH ()-[r]->() RETURN count(r) AS n")[0]["n"]
    print(f"Local graph: {nodes:,} nodes, {rels:,} relationships")
    if nodes > MAX_NODES or rels > MAX_RELS:
        raise SystemExit("Too big for Aura Free (200k nodes / 400k relationships). Raise NVD_START_YEAR or upgrade Aura.")

    print("Clearing Aura...")
    with AURA.session() as s:
        s.run("MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 10000 ROWS").consume()
    for label in LABELS:
        aura(f"CREATE CONSTRAINT {label.lower()}_id IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE")
    aura("""CREATE FULLTEXT INDEX cyber_text IF NOT EXISTS FOR (n:CVE|CWE|CAPEC|ATTACK) ON EACH [n.id, n.name, n.description]""")

    for label in LABELS:
        rows = local(f"MATCH (n:{label}) RETURN n {{.*, embedding: null}} AS props")
        for i in range(0, len(rows), BATCH):
            aura(f"UNWIND $rows AS row CREATE (n:{label}) SET n = row.props", rows=rows[i:i + BATCH])
        print(f"  {label}: {len(rows):,} nodes")

    pairs = local("MATCH (a)-[r]->(b) RETURN DISTINCT labels(a)[0] AS a, type(r) AS t, labels(b)[0] AS b")
    for p in pairs:
        rows = local(f"MATCH (a:{p['a']})-[r:{p['t']}]->(b:{p['b']}) RETURN a.id AS a, b.id AS b, properties(r) AS props")
        for i in range(0, len(rows), BATCH):
            aura(f"""UNWIND $rows AS row MATCH (a:{p['a']} {{id: row.a}}), (b:{p['b']} {{id: row.b}})
                     CREATE (a)-[r:{p['t']}]->(b) SET r = row.props""", rows=rows[i:i + BATCH])
        print(f"  {p['a']}-[{p['t']}]->{p['b']}: {len(rows):,}")
    print("Aura is now a copy of the local graph.")


if __name__ == "__main__":
    main()
    LOCAL.close()
    AURA.close()

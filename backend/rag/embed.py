"""Build the embeddings once:  python -m rag.embed

For every CVE, CWE, CAPEC and ATT&CK node: "name. description" -> 384 numbers, stored on the node
as `embedding`. Then create the vector indexes that make them searchable. Safe to run again:
nodes that already have an embedding are skipped.
"""
from graph.connection import run, write
from rag.semantic import embed

INDEX_FOR = {"CVE": "cve_embedding", "CWE": "cwe_embedding", "CAPEC": "capec_embedding", "ATTACK": "attack_embedding"}
BATCH = 500


def main():
    for label, index in INDEX_FOR.items():
        # 384 numbers per node, compared by cosine similarity (how close two meanings are)
        write(f"""CREATE VECTOR INDEX {index} IF NOT EXISTS FOR (n:{label}) ON (n.embedding)
                  OPTIONS {{ indexConfig: {{ `vector.dimensions`: 384, `vector.similarity_function`: 'cosine' }} }}""")
        rows = run(f"""MATCH (n:{label}) WHERE n.embedding IS NULL
                       RETURN n.id AS id, coalesce(n.name, '') + '. ' + left(coalesce(n.description, ''), 500) AS text""")
        for start in range(0, len(rows), BATCH):
            batch = rows[start:start + BATCH]
            vectors = embed([row["text"] for row in batch])
            write(f"UNWIND $rows AS row MATCH (n:{label} {{id: row.id}}) SET n.embedding = row.vector",
                  rows=[{"id": row["id"], "vector": vector} for row, vector in zip(batch, vectors)])
            print(f"{label}: {start + len(batch)} / {len(rows)}", flush=True)
    print("Embeddings ready.")


if __name__ == "__main__":
    main()

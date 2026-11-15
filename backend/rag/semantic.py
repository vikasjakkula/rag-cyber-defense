"""Search by meaning, for questions that name no CVE, CWE, CAPEC or ATT&CK ID.

The model all-MiniLM-L6-v2 turns any text into 384 numbers (an "embedding"). Texts that mean
similar things get similar numbers, even with different words: "steal passwords" lands close to
"credential access". Every node in Neo4j stores its own embedding (made once by rag/embed.py),
and Neo4j's vector index finds the nodes whose numbers are closest to the question's.
"""
from graph.connection import run

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
INDEXES = ["cve_embedding", "cwe_embedding", "capec_embedding", "attack_embedding"]

# The k nodes closest in meaning, from one vector index
SEARCH = """
CALL db.index.vector.queryNodes($index, $k, $vector) YIELD node, score
RETURN labels(node)[0] AS type, node.id AS id, node.name AS name,
       left(node.description, 300) AS description, round(score, 3) AS score
"""

_model = None


def available():
    """True when the model library is installed (in Docker yes; on Vercel no, so we use keyword search)."""
    try:
        import sentence_transformers  # noqa: F401
        return True
    except ImportError:
        return False


def embed(texts):
    """Texts -> lists of 384 numbers. The model loads once, the first time it is needed."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL_NAME)
    return _model.encode(texts, normalize_embeddings=True, batch_size=64).tolist()


def search(question, k=8):
    """The k records closest in meaning to the question, from all four kinds of node."""
    vector = embed([question])[0]
    hits = []
    for index in INDEXES:
        hits += run(SEARCH, index=index, k=k, vector=vector)
    hits.sort(key=lambda hit: hit["score"], reverse=True)
    return hits[:k]

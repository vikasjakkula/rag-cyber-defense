import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from graph import queries
from graph.connection import driver, run
from rag.pipeline import answer, answer_stream

router = APIRouter()


class Question(BaseModel):
    question: str
    # Earlier turns of this chat, [{"question": ..., "answer": ...}], so follow-ups have context
    history: list[dict] = []


@router.get("/health")
def health():
    try:
        driver.verify_connectivity()
        nodes = run("MATCH (n) RETURN count(n) AS n")[0]["n"]
        return {"status": "ok", "neo4j": "connected", "nodes": nodes}
    except Exception as exc:
        raise HTTPException(503, f"Neo4j unavailable: {exc}")


@router.get("/cve/{cve_id}")
def cve(cve_id: str):
    rows = run(queries.CVE_CHAIN, id=cve_id.upper())
    if not rows or rows[0]["cve"] is None:
        raise HTTPException(404, f"{cve_id} not found")
    return rows[0]


@router.post("/ask")
def ask(body: Question):
    if not body.question.strip():
        raise HTTPException(400, "question is empty")
    try:
        return answer(body.question.strip(), body.history)
    except Exception as exc:
        raise HTTPException(500, f"API error: {exc}") from exc


@router.post("/ask/stream")
def ask_stream(body: Question):
    """Same answer as /ask, sent as one JSON event per line while the model is still writing."""
    if not body.question.strip():
        raise HTTPException(400, "question is empty")

    def lines():
        try:
            for event in answer_stream(body.question.strip(), body.history):
                yield json.dumps(event, default=str) + "\n"
        except Exception as exc:
            yield json.dumps({"type": "error", "detail": f"API error: {exc}"}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

"""How a question becomes an answer, in four steps:

1. find_ids       pull IDs like "CVE-2024-24919" out of the question
2. retrieve       fetch the matching records from Neo4j (keyword search when there is no ID)
3. stream_llm     send the question and records to the LLM and get its answer back piece by piece
4. answer_stream  wrap it all as events the website shows as they arrive
"""
import json
import re

from groq import Groq

import config
from graph import queries
from graph.connection import run
from rag.grounding import check as grounding_check
from rag.prompts import DETAILS_PROMPT, REFUSAL, SYSTEM_PROMPT

# Matches CVE-2024-24919, CWE-79, CAPEC-66 and ATT&CK IDs like T1036 or T1574.008
ID_PATTERN = re.compile(r"\b(CVE-\d{4}-\d{4,}|CWE-\d+|CAPEC-\d+|T\d{4}(?:\.\d{3})?)\b", re.IGNORECASE)

# Which tested Cypher query to run for each kind of ID
QUERY_FOR = {"CVE": queries.CVE_CHAIN, "CWE": queries.CWE_CHAIN, "CAPEC": queries.CAPEC_CHAIN, "T": queries.ATTACK_NODE}

MAX_ITEMS = 40   # longest list of linked records we send to the LLM
MAX_PATHS = 150  # paths are short strings, so we keep more of them
MAX_TURNS = 6    # earlier questions and answers we send back, so follow-ups make sense

client = Groq(api_key=config.GROQ_API_KEY) if config.GROQ_API_KEY else None


def find_ids(text):
    """'Is CVE-2024-24919 bad?' -> ['CVE-2024-24919'] (each ID once, in upper case)."""
    return list(dict.fromkeys(match.upper() for match in ID_PATTERN.findall(text)))


def shorten(items, limit):
    """Cut a long list so the prompt stays small, and say how many were left out."""
    if isinstance(items, list) and len(items) > limit:
        return items[:limit] + [f"... {len(items) - limit} more"]
    return items


def lookup(entity_id):
    """Run the Cypher query for one ID. Returns its record, or None if it is not in the graph."""
    kind = "T" if entity_id.startswith("T") else entity_id.split("-")[0]
    rows = run(QUERY_FOR[kind], id=entity_id)
    if not rows or list(rows[0].values())[0] is None:
        return None
    record = rows[0]
    fact = {key: shorten(value, MAX_PATHS if key == "paths" else MAX_ITEMS) for key, value in record.items()}
    fact["counts"] = {key: len(value) for key, value in record.items() if isinstance(value, list)}
    return fact


def retrieve(question, history=()):
    """Find the graph records the question is about."""
    ids = find_ids(question)
    # A follow-up like "how do I fix it?" names no ID, so reuse the IDs from the last turns
    for turn in reversed(history[-2:]):
        if ids:
            break
        ids = find_ids(turn.get("question", "") + " " + turn.get("answer", ""))[:3]

    if ids:
        facts = [lookup(entity_id) for entity_id in ids]
        return {"mode": "id_lookup", "ids": ids,
                "facts": [fact for fact in facts if fact],
                "not_found": [entity_id for entity_id, fact in zip(ids, facts) if not fact]}

    # No ID: search names and descriptions. The search index treats symbols as syntax, so keep words only.
    words = " ".join(re.findall(r"\w+", question))
    facts = run(queries.KEYWORD_SEARCH, text=words) if words else []
    return {"mode": "keyword_search", "ids": [], "facts": facts, "not_found": []}


def build_messages(prompt, question, retrieved, history=()):
    """The chat we send to the LLM: instructions, earlier turns, then the question with its facts."""
    messages = [{"role": "system", "content": prompt}]
    for turn in history[-MAX_TURNS:]:
        messages.append({"role": "user", "content": turn.get("question", "")})
        messages.append({"role": "assistant", "content": turn.get("answer", "")})
    facts = json.dumps(retrieved, default=str)
    messages.append({"role": "user", "content": f"Question: {question}\n\nFacts:\n{facts}"})
    return messages


def stream_llm(messages):
    """Yield the LLM's answer in small pieces while it is still writing."""
    # gpt-oss "thinks" before answering; low effort is faster, and we don't need the thinking text back
    thinking = ({"reasoning_effort": config.GROQ_REASONING_EFFORT, "include_reasoning": False}
                if config.GROQ_REASONING_EFFORT else {})
    for attempt in range(2):  # now and then the model sends nothing, so try once more
        stream = client.chat.completions.create(
            model=config.GROQ_MODEL, messages=messages, temperature=0.1, stream=True, **thinking)
        sent_something = False
        for chunk in stream:
            piece = chunk.choices[0].delta.content if chunk.choices else None
            if piece:
                sent_something = True
                yield piece
        if sent_something:
            return


def answer_stream(question, history=(), explain=True):
    """Events for the website, in order: facts, answer pieces, details pieces, done."""
    retrieved = retrieve(question, history)
    yield {"type": "facts", **retrieved}
    if client is None:
        yield {"type": "error", "detail": "The AI is not set up yet (GROQ_API_KEY is missing)."}
        return

    answer = ""
    for piece in stream_llm(build_messages(SYSTEM_PROMPT, question, retrieved, history)):
        answer += piece
        yield {"type": "answer", "delta": piece}

    # The technical explanation only makes sense when specific records were looked up
    details = ""
    if explain and retrieved["mode"] == "id_lookup" and retrieved["facts"] and not answer.startswith(REFUSAL):
        for piece in stream_llm(build_messages(DETAILS_PROMPT, question, retrieved)):
            details += piece
            yield {"type": "details", "delta": piece}

    yield {"type": "done", "grounding": grounding_check(answer + " " + details, retrieved)}


def answer(question, history=(), explain=True):
    """The same answer as one dictionary, for code that doesn't need streaming (the /ask route, the tests)."""
    result = {"question": question, "answer": "", "details": ""}
    for event in answer_stream(question, history, explain):
        if event["type"] in ("answer", "details"):
            result[event["type"]] += event["delta"]
        elif event["type"] == "error":
            raise RuntimeError(event["detail"])
        else:
            result.update({key: value for key, value in event.items() if key != "type"})
    return result

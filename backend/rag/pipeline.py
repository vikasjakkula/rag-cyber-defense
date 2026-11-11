"""Question -> IDs -> Neo4j facts -> Groq answer.

The LLM only sees facts returned by Neo4j and is told to say when something is missing.
"""
import json
import queue
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from groq import Groq

import config
from graph import queries
from graph.connection import run
from rag.grounding import check as grounding_check

ID_PATTERN = re.compile(r"\b(CVE-\d{4}-\d{4,}|CWE-\d+|CAPEC-\d+|T\d{4}(?:\.\d{3})?)\b", re.IGNORECASE)
LOOKUPS = {"CVE": queries.CVE_CHAIN, "CWE": queries.CWE_CHAIN,
           "CAPEC": queries.CAPEC_CHAIN, "T": queries.ATTACK_NODE}
MAX_LIST = 40  # cap long neighbour lists so the prompt stays small
MAX_PATHS = 150  # paths are short strings, so keep more of them
NO_ANSWER = "I only answer cybersecurity questions"  # how SYSTEM_PROMPT starts its refusal
MAX_TURNS = 6  # earlier question/answer pairs sent back to the model, so follow-ups make sense

SYSTEM_PROMPT = """You are a friendly cybersecurity assistant, like ChatGPT but only for security, for people
who are not security experts. You answer about specific bugs and also about cybersecurity in general:
trends, common attacks, how to stay safe, careers, tools and concepts.

Each message may include JSON facts from our knowledge graph that links CVE (a specific bug in real
software), CWE (the type of mistake behind it), CAPEC (how attackers exploit it) and ATT&CK (what
attackers do once they get in).

How to answer:
- At most 5 short lines, in simple everyday English. Answer exactly what was asked, first.
- When the facts relate to the question, use them: they are the truth for IDs, scores, counts and links.
  "paths" lists the real links; describe connections only from these. Take totals from "counts".
- When the facts are empty or unrelated but the question is about cybersecurity, answer from your
  general knowledge. Never invent CVE, CWE, CAPEC or ATT&CK IDs, scores or counts that are not in the facts.
- This is a conversation. Use the earlier messages to understand follow-ups such as "how do I fix it?",
  "explain simpler" or "what about the second one?".
- Say what things mean in practice ("lets an attacker read passwords"), not official titles. Mention an
  ID only in brackets after the plain description, e.g. "leaking private information (CWE-200)".
- Short bullet points are fine for lists. No headings or tables.
- When there are many results, give the total and name the 2 or 3 most damaging.
- When it helps, end with what to do about it.
- If the question is not about cybersecurity, reply exactly: "I only answer cybersecurity questions."

Examples of the style:
Q: How severe is CVE-2024-24919?
A: High, 8.6 out of 10. Attackers can read private information from the affected Check Point gateways over the internet.
Q: What is ransomware?
A: Malware that locks or steals your files and demands payment to give them back. It usually gets in
through phishing emails or unpatched servers. Keep offline backups and patch quickly."""

# Shown under the short answer, for readers who want the technical picture.
DETAILS_PROMPT = """You write the technical explanation shown under a short cybersecurity answer.
Use ONLY the JSON facts given. They come from a knowledge graph that links CVE (a specific bug
in real software), CWE (the type of mistake behind it), CAPEC (how attackers exploit it) and
ATT&CK (what attackers do once they get in).

Write in simple English: short sentences and everyday words. Keep the correct technical names and
IDs, and explain each technical name in a few plain words. Do not use tables.

Use exactly these three markdown headings, in this order:

## Retrieved facts
Bullet points of what the graph returned: the record's ID, name and plain meaning, any scores and
severity, then the linked CWE, CAPEC and ATT&CK entries. Put the ID in brackets after each item,
e.g. "DLL side-loading: tricking a program into loading a fake library [CAPEC-641]".
If a list has more than 6 items, give the total from "counts" and show the 6 most damaging.

## Attack-path analysis
3 to 5 bullet points that walk through how an attack moves from the weakness to the attacker's
actions, step by step. Describe connections only from "paths". Say what the number of linked
records means in practice.

## Not available
Bullet points of what the facts do not include, such as empty or null fields. Only list things a
reader would expect for this record. If nothing important is missing, write "Nothing important is missing."

Never invent IDs, scores, counts, fixes or links. Lists may be cut short, so take totals from "counts".
Do not add any introduction or closing text."""


def extract_ids(question):
    return list(dict.fromkeys(m.upper() for m in ID_PATTERN.findall(question)))


def trim(value, limit=MAX_LIST):
    if isinstance(value, list) and len(value) > limit:
        return value[:limit] + [f"... {len(value) - limit} more"]
    return value


def retrieve(question, history=()):
    ids = extract_ids(question)
    # A follow-up like "how do I fix it?" names no ID: reuse the IDs of the latest turn that had some
    for turn in reversed(list(history)[-2:]):
        if ids:
            break
        ids = extract_ids(f"{turn.get('question', '')} {turn.get('answer', '')}")[:3]
    if ids:
        facts, missing = [], []
        for entity_id in ids:
            prefix = "T" if entity_id.startswith("T") else entity_id.split("-")[0]
            rows = run(LOOKUPS[prefix], id=entity_id)
            first = rows[0] if rows else {}
            if first and list(first.values())[0] is not None:
                fact = {k: trim(v, MAX_PATHS if k == "paths" else MAX_LIST) for k, v in first.items()}
                fact["counts"] = {k: len(v) for k, v in first.items() if isinstance(v, list)}
                facts.append(fact)
            else:
                missing.append(entity_id)
        return {"mode": "id_lookup", "ids": ids, "facts": facts, "not_found": missing}

    # No ID in the question: full-text search. Lucene treats symbols as syntax, so keep words only.
    text = " ".join(re.findall(r"\w+", question))
    facts = run(queries.KEYWORD_SEARCH, text=text) if text else []
    return {"mode": "keyword_search", "ids": [], "facts": facts, "not_found": []}


def chat(question, retrieved, system_prompt, stream=False, history=()):
    """One Groq call with the facts as context."""
    client = Groq(api_key=config.GROQ_API_KEY)
    # Configurable thinking, and don't send the reasoning text back: smaller, faster response.
    reasoning = ({"reasoning_effort": config.GROQ_REASONING_EFFORT, "include_reasoning": False}
                 if config.GROQ_REASONING_EFFORT else {})
    messages = [{"role": "system", "content": system_prompt}]
    for turn in list(history)[-MAX_TURNS:]:  # earlier turns, so follow-up questions have context
        messages += [{"role": "user", "content": turn.get("question", "")},
                     {"role": "assistant", "content": turn.get("answer", "")}]
    messages += [
        {"role": "user", "content": f"Question: {question}\n\nFacts:\n{json.dumps(retrieved, default=str)}"},
    ]
    return client.chat.completions.create(
        model=config.GROQ_MODEL, temperature=0.1, messages=messages, stream=stream, **reasoning)


def generate(question, retrieved, system_prompt=SYSTEM_PROMPT, history=()):
    """Returns (answer, llm_status). An LLM failure never hides the retrieved facts."""
    if not config.GROQ_API_KEY:
        return None, "not configured (set GROQ_API_KEY)"
    try:
        for _ in range(2):  # the model occasionally returns an empty message; retry once
            response = chat(question, retrieved, system_prompt, history=history)
            text = (response.choices[0].message.content or "").strip()
            if text:
                return text, config.GROQ_MODEL
        return None, f"{config.GROQ_MODEL} returned an empty answer"
    except Exception as exc:
        return None, f"{config.GROQ_MODEL} failed: {exc}"


def answer(question, history=()):
    retrieved = retrieve(question, history)
    # Both calls run at once so the explanation doesn't double the wait.
    with ThreadPoolExecutor(max_workers=2) as pool:
        short = pool.submit(generate, question, retrieved, SYSTEM_PROMPT, history)
        explain = retrieved["mode"] == "id_lookup" and retrieved["facts"]
        long = pool.submit(generate, question, retrieved, DETAILS_PROMPT, history) if explain else None
    text, llm = short.result()
    details = long.result()[0] if long else None
    if text and text.startswith(NO_ANSWER):  # the facts were unrelated, so there is nothing to explain
        details = None
    grounding = grounding_check(" ".join(filter(None, [text, details])), retrieved)
    return {"question": question, "answer": text, "details": details, "llm": llm,
            "grounding": grounding, **retrieved}


def stream_text(question, retrieved, system_prompt, history=()):
    """Yields the answer piece by piece as Groq writes it."""
    for _ in range(2):  # retry once if the model sends nothing
        sent = False
        for chunk in chat(question, retrieved, system_prompt, stream=True, history=history):
            piece = chunk.choices[0].delta.content if chunk.choices else None
            if piece:
                sent = True
                yield piece
        if sent:
            return


def answer_stream(question, history=()):
    """Events for the typing effect: the facts first, then answer and details text as it arrives."""
    retrieved = retrieve(question, history)
    yield {"type": "facts", "question": question, **retrieved}
    if not config.GROQ_API_KEY:
        yield {"type": "done", "llm": "not configured (set GROQ_API_KEY)"}
        return

    # Both texts stream at once; a queue merges their pieces into one ordered event stream.
    events = queue.Queue()

    def pump(part, prompt):
        try:
            for piece in stream_text(question, retrieved, prompt, history):
                events.put({"type": part, "delta": piece})
        except Exception as exc:
            events.put({"type": "error", "part": part, "detail": f"{config.GROQ_MODEL} failed: {exc}"})
        finally:
            events.put({"type": "end", "part": part})
            events.put(None)

    # The technical explanation only makes sense when specific records were looked up
    explain = retrieved["mode"] == "id_lookup" and retrieved["facts"]
    jobs = [("answer", SYSTEM_PROMPT)] + ([("details", DETAILS_PROMPT)] if explain else [])
    for part, prompt in jobs:
        threading.Thread(target=pump, args=(part, prompt), daemon=True).start()
    running = len(jobs)
    written = {"answer": "", "details": ""}
    while running:
        event = events.get()
        if event is None:
            running -= 1
            continue
        if event["type"] in written:
            written[event["type"]] += event["delta"]
        yield event
    yield {"type": "done", "llm": config.GROQ_MODEL,
           "grounding": grounding_check(" ".join(written.values()), retrieved)}

"""Question -> IDs -> Neo4j facts -> Groq answer.

The LLM only sees facts returned by Neo4j and is told to say when something is missing.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor

from groq import Groq

import config
from graph import queries
from graph.connection import run

ID_PATTERN = re.compile(r"\b(CVE-\d{4}-\d{4,}|CWE-\d+|CAPEC-\d+|T\d{4}(?:\.\d{3})?)\b", re.IGNORECASE)
LOOKUPS = {"CVE": queries.CVE_CHAIN, "CWE": queries.CWE_CHAIN,
           "CAPEC": queries.CAPEC_CHAIN, "T": queries.ATTACK_NODE}
MAX_LIST = 40  # cap long neighbour lists so the prompt stays small
MAX_PATHS = 150  # paths are short strings, so keep more of them
NO_ANSWER = "I don't have information"  # how SYSTEM_PROMPT starts its refusal

SYSTEM_PROMPT = """You answer cybersecurity questions for people who are not security experts.
Use ONLY the JSON facts given. They come from a knowledge graph that links CVE (a specific bug
in real software), CWE (the type of mistake behind it), CAPEC (how attackers exploit it) and
ATT&CK (what attackers do once they get in).

How to answer:
- Answer exactly what was asked, first. Match the length to the question: if a word or number
  answers it, reply with just that plus a few words of meaning. Otherwise 1 to 3 short sentences, never more.
- Write for someone with no security background. Use everyday words and say what things mean in
  practice ("lets an attacker read passwords from the device"), not official titles. Mention an ID
  only in brackets after the plain description, e.g. "leaking private information (CWE-200)".
- No headings, bullet points, tables or bold text.
- When there are many results, give the total from "counts" and name the 2 or 3 that matter most
  to a defender: the most damaging (stealing logins, taking control, spreading), not just the first listed.
- When it helps, end with what to do about it, using the "mitigations" or the description in the facts.
- "paths" lists the real links (e.g. "CWE-200 -> CAPEC-169 -> T1592"). Describe connections only from these.
- Never invent IDs, scores, counts, fixes or links. Lists may be cut short, so take totals from "counts".
- If the facts do not answer the question or are unrelated to it, reply exactly:
  "I don't have information about that in the security data." Never answer from your own knowledge.

Examples of the style:
Q: How severe is CVE-2024-24919?
A: High, 8.6 out of 10. Attackers can read private information from the affected Check Point gateways over the internet.
Q: What is CWE-89?
A: A coding mistake where user input is mixed straight into database commands, so an attacker can read or change the data (SQL injection). Fix it by using parameterised queries."""

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


def retrieve(question):
    ids = extract_ids(question)
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


def generate(question, retrieved, system_prompt=SYSTEM_PROMPT):
    """Returns (answer, llm_status). An LLM failure never hides the retrieved facts."""
    if not config.GROQ_API_KEY:
        return None, "not configured (set GROQ_API_KEY)"
    try:
        client = Groq(api_key=config.GROQ_API_KEY)
        # Configurable thinking, and don't send the reasoning text back: smaller, faster response.
        reasoning = ({"reasoning_effort": config.GROQ_REASONING_EFFORT, "include_reasoning": False}
                     if config.GROQ_REASONING_EFFORT else {})
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Question: {question}\n\nFacts:\n{json.dumps(retrieved, default=str)}"},
        ]
        for _ in range(2):  # the model occasionally returns an empty message; retry once
            response = client.chat.completions.create(
                model=config.GROQ_MODEL, temperature=0.1, messages=messages, **reasoning)
            text = (response.choices[0].message.content or "").strip()
            if text:
                return text, config.GROQ_MODEL
        return None, f"{config.GROQ_MODEL} returned an empty answer"
    except Exception as exc:
        return None, f"{config.GROQ_MODEL} failed: {exc}"


def answer(question):
    retrieved = retrieve(question)
    # Both calls run at once so the explanation doesn't double the wait.
    with ThreadPoolExecutor(max_workers=2) as pool:
        short = pool.submit(generate, question, retrieved)
        long = pool.submit(generate, question, retrieved, DETAILS_PROMPT) if retrieved["facts"] else None
    text, llm = short.result()
    details = long.result()[0] if long else None
    if text and text.startswith(NO_ANSWER):  # the facts were unrelated, so there is nothing to explain
        details = None
    return {"question": question, "answer": text, "details": details, "llm": llm, **retrieved}

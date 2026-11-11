"""Grounding check: is every ID and score in the answer really in the retrieved records?

A claim here is any security ID (CVE-..., CWE-..., CAPEC-..., T1234) or decimal score (8.6) in
the answer text. It is "supported" if the same ID or number appears in the facts Neo4j returned,
so the reader can see at a glance whether the AI added anything the graph does not contain.
"""
import json
import re

ID = re.compile(r"\b(CVE-\d{4}-\d{4,}|CWE-\d+|CAPEC-\d+|T\d{4}(?:\.\d{3})?)\b", re.IGNORECASE)
SCORE = re.compile(r"(?<![\w.])(\d{1,2}\.\d)(?![\d.])")  # CVSS-style numbers such as 8.6 or 3.9
IGNORED_SCORES = {"3.9", "6.0", "10.0"}  # scale maxima the answer may quote ("out of 10.0")
# The model often writes IDs with typographic dashes (CWE‑863 uses U+2011), which would not match
DASHES = str.maketrans({c: "-" for c in "‐‑‒–—−"})


def normalize(text):
    return (text or "").translate(DASHES)


def claims(text):
    text = normalize(text)
    ids = {m.upper() for m in ID.findall(text)}
    scores = set(SCORE.findall(text)) - IGNORED_SCORES
    return ids, scores


def check(text, retrieved):
    """Returns {"score", "supported", "unsupported"}; score is None when the text makes no claims."""
    facts = json.dumps(retrieved.get("facts", []), default=str)
    known_ids, _ = claims(facts)
    known_ids |= {i.upper() for i in retrieved.get("ids", [])}
    known_scores = set(re.findall(r"\d+\.\d+", facts))
    known_scores |= {s.rstrip("0").rstrip(".") if "." in s else s for s in known_scores}

    ids, scores = claims(text)
    supported = sorted(i for i in ids if i in known_ids) + sorted(s for s in scores if s in known_scores)
    unsupported = sorted(i for i in ids if i not in known_ids) + sorted(s for s in scores if s not in known_scores)
    total = len(supported) + len(unsupported)
    return {"score": round(len(supported) / total, 3) if total else None,
            "supported": supported, "unsupported": unsupported}

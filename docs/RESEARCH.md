# Research: measuring what the graph adds

The base paper (Rahman et al., PNNL-36792, 2024) showed four example answers but reported no
accuracy, hallucination or speed numbers. This branch adds the missing measurement, plus a check
on every live answer.

## 1. Grounding check (every answer)

`backend/rag/grounding.py`

After the AI answers, we collect every security ID (CVE, CWE, CAPEC, ATT&CK) and every score
(like 8.6) in the text and look for each one in the records Neo4j returned.

- All found: the app shows a green "Verified" line.
- Something not found: the app shows an amber line listing what the graph does not contain.

So a reader can see, for each answer, whether the AI added anything that is not in the data.

## 2. Benchmark (questions with known answers)

`backend/eval/build_benchmark.py` writes `data/eval/benchmark.json`.

It picks random entities from Neo4j and writes questions whose correct answer is stored in the graph,
so nothing is judged by hand. Five types, 10 questions each:

| Type | Example question | Correct answer comes from |
|---|---|---|
| severity | What is the severity and CVSS base score of CVE-2024-38446? | `CVE.severity`, `CVE.base_score` |
| cve_to_cwe | Which weakness (CWE) is behind CVE-2024-33996? | `(:CVE)-[:CVE_CWE]->(:CWE)` |
| cwe_to_capec | Which attack patterns (CAPEC) exploit CWE-798? | `(:CWE)-[:CWE_CAPEC]->(:CAPEC)` |
| capec_to_attack | Which MITRE ATT&CK techniques does CAPEC-13 map to? | `(:CAPEC)-[:CAPEC_ATTACK]->(:ATTACK)` |
| cve_count | How many CVEs in the dataset are linked to CWE-706? | count of `CVE_CWE` links |

Only entities with 1 to 3 correct IDs are used, so a short answer can name all of them.

## 3. Evaluation (GraphRAG vs the same model alone)

`backend/eval/run_eval.py` writes `data/eval/results.json` and `frontend/public/eval-results.json`.

The same model (openai/gpt-oss-120b) answers every question twice:

- **GraphRAG**: our pipeline, with the facts Neo4j retrieves.
- **Plain LLM**: the model alone.

Scoring is automatic:

- ID questions: F1 of the IDs named against the correct IDs.
- Severity: half a point each for the right severity word and the right score.
- Count: the exact number must appear.
- Hallucination rate: the share of IDs an answer named that are not real links for that entity.

## Results (pilot, 50 questions)

| | GraphRAG | Plain LLM |
|---|---|---|
| Accuracy | 100% | 7% |
| Hallucinated IDs | 0% | 66% |

The Research page in the app (`/research`) shows these numbers, a chart by question type and
side-by-side example answers.

**Limits:** every question names an ID, which is the case our retrieval handles best; vague questions
are not scored yet. GraphRAG answer time includes waits for the free Groq rate limit. Data covers
2024 CVEs only.

## Run it yourself

```bash
cd backend
python -m eval.build_benchmark 10      # 10 questions per type (skip to reuse the saved file)
python -m eval.run_eval                # asks both systems, about 10 minutes on the free Groq tier
python -m eval.run_eval --rescore      # re-mark saved answers after changing the scoring
```

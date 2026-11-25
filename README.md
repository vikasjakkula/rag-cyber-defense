# Cyber Defense RAG

Ask a cybersecurity question in plain English and get a short answer **built only from real security data**,
with proof. Based on the paper *Retrieval Augmented Generation for Robust Cyber Defense*
(Rahman et al., PNNL-36792, 2024). A 5-member Project School team.

--- 

## 1. The idea in one minute

- **Problem:** a normal AI chatbot guesses. It invents bug IDs and scores and gives no proof.
- **Fix (RAG):** first *find* the real records, then let the AI answer *only* from them.
- **Our data** is a graph of four official MITRE/NVD catalogues, linked in a chain:

```
CVE (a real bug) ──► CWE (the coding mistake) ──► CAPEC (how attackers exploit it) ──► ATT&CK (what they do next)
```

| Word | Simple meaning | Example |
|---|---|---|
| CVE | one specific bug in one product | CVE-2024-24919 (Check Point gateway) |
| CWE | the type of mistake behind bugs | CWE-200 leaking private information |
| CAPEC | a known way to attack a mistake | CAPEC-66 SQL injection |
| ATT&CK | what attackers do after getting in | T1539 steal web session cookie |
| CVSS / severity | danger score 0–10: Low, Medium, High (7–8.9), Critical (9–10) | 8.6 = High |
| CISA KEV | list of bugs attackers really used | 165 of our 2024 CVEs |

---

## 2. How one question is answered

```
Your question
     │
     ▼
Does it name an ID? (CVE-…, CWE-89 or "CWE 89", CAPEC-…, T1234)
     │
     ├── yes ─► ID lookup ─────────► tested Cypher query fetches that record and its chain
     │
     └── no ──► Semantic search ───► the question becomes 384 numbers (all-MiniLM-L6-v2);
                    │                  Neo4j's vector index finds the 5 closest records by meaning,
                    │                  then we follow each one's chain in the graph
                    │
                    └── nothing close enough (score < 0.65) ─► Keyword fallback (full-text search)
     │
     ▼
The records + your question go to the AI (Google Gemini, gemini-2.5-flash) with strict rules:
answer in ≤ 5 short lines, use only these facts, never invent IDs.
     │
     ▼
The answer streams back word by word, then a "Verified" check confirms every ID and score
in it really exists in the graph. Off-topic questions get:
"I don't have information about that in the security data."
```

The page shows which way was used as a badge: **ID lookup**, **Semantic search** or **Keyword fallback**.

---

## 3. Where the code is (read in this order)

| File | What it does |
|---|---|
| `frontend/index.html` + `frontend/js/chat.js` | the Ask page: question box, chat, answer, badge |
| `frontend/js/api.js` | sends the question to the backend and reads the streamed answer |
| `backend/api/routes.py` | the API: `/health`, `/cve/{id}`, `/ask`, `/ask/stream` |
| `backend/rag/pipeline.py` | **the brain**: find IDs → pick records → ask the AI → stream events |
| `backend/retrieval/lookup.py` | ID lookup: one ID → its record and chain |
| `backend/retrieval/hybrid.py` | semantic search: closest records by meaning → their chains |
| `backend/rag/embeddings.py` | turns text into 384 numbers with all-MiniLM-L6-v2 |
| `backend/graph/queries.py` | the tested Cypher queries (the AI never writes queries) |
| `backend/rag/prompts.py` | the rules we give the AI |
| `backend/rag/grounding.py` | the "Verified" check |
| `neo4j/*.cypher`, `neo4j/embed_nodes.py` | build the graph, then write an embedding on every node |
| `frontend/js/graph.js` | the attack path map under an answer |
| `frontend/insights.html`, `research.html`, `history.html` | charts, our test results, saved answers |
| `tests/test_pipeline.py` | checks the routing, semantic search and off-topic refusal |

Everything else is looks (`style.css`, `backdrop.js` = the 3D dots) or one-time data scripts.

---

## 4. Run it (Docker)

```bash
cp .env.example .env            # then put your Gemini key in GEMINI_API_KEY
docker compose up --build -d    # first run ~15 min: loads the graph, then writes embeddings
docker compose ps               # all running; neo4j-init and embed-init show "Exited (0)" = done
```

| Open | What |
|---|---|
| http://localhost:3000 | the website (plain HTML/CSS/JS served by nginx) |
| http://localhost:8000/docs | the API |
| http://localhost:7474 | Neo4j Browser (user `neo4j`, password `password123`) |

Start order: `neo4j` healthy → `neo4j-init` loads the graph → `backend` → `frontend`. At the same time
`embed-init` writes embeddings in the background (first run: several minutes; later runs skip nodes already
done). Until it exits, questions without an ID use keyword search. Each answer has a small "Cypher" toggle
showing the queries that were run. The AI model is cached in a Docker volume.

```bash
docker compose exec backend python -m pytest tests -q     # run the tests
curl -X POST localhost:8000/ask -H "Content-Type: application/json" \
     -d '{"question":"how do attackers steal login sessions?"}'
```

Settings in `.env`: `GEMINI_API_KEY`, `GEMINI_MODEL`, `EMBEDDING_MODEL`, `VECTOR_TOP_K` (5), `VECTOR_MIN_SCORE` (0.65),
`NVD_API_KEY`, `NVD_START_YEAR` (2024), `UPDATE_EVERY_HOURS` (24).

Online: the same frontend and backend run on Vercel with Neo4j Aura. Vercel is too small for the
embedding model, so online questions without an ID use keyword search.

---

## 5. Auto-update: the data stays current (branch `auto-update`)

The graph no longer stops at 2024. A small script pulls the newest public data by itself.

**What happens, simply:** every 24 hours the Docker service `updater` asks NVD for every CVE added or
changed since its last run, downloads the latest CWE, CAPEC and ATT&CK files from MITRE, and adds them to
our own Neo4j graph. New nodes get embeddings and attack-path numbers, and the website shows
"N CVEs · data updated <date>" under the title. Nothing is deleted, so the 2024 baseline stays.

| File | What changed |
|---|---|
| `neo4j/update_data.py` | **new**: the updater. 1) MITRE CWE/CAPEC/ATT&CK files → upsert nodes and links, 2) NVD API 2.0 → upsert CVEs and CVE→CWE links (first run: everything published since `NVD_START_YEAR`; later: only what changed), 3) attack-path metrics + embeddings for new nodes, 4) saves the date on a `(:Meta)` node |
| `docker-compose.yml` | **new `updater` service**: starts after the graph is loaded, runs the update, then repeats every `UPDATE_EVERY_HOURS` |
| `backend/api/routes.py` | **new `/meta`** endpoint: last update date and CVE count |
| `backend/graph/queries.py`, `backend/rag/pipeline.py` | "how many" answers now say when the data was last updated, and ignore the `Meta` node in counts |
| `frontend/index.html`, `frontend/js/chat.js`, `frontend/style.css` | the green "data updated" line under the title |
| `.env.example` | `NVD_API_KEY` (optional, free, ~10× faster), `NVD_START_YEAR` (2024), `UPDATE_EVERY_HOURS` (24) |
| `tests/test_update.py` | **new** test: an NVD record is read into the right scores and CWE links |

```bash
docker compose up --build -d          # everything, including the updater
docker compose logs -f updater        # watch it download and add data
docker compose run --rm updater python /scripts/update_data.py   # one update right now
```

Why local only: Neo4j Aura's free tier is limited to 200k nodes, and two+ years of CVEs pass that. A local
Neo4j in Docker has no limit and no cost. The Vercel site (branch `main`) keeps the 2024 data.

**In one line for a review:** "Our system checks NVD and MITRE every day and adds new vulnerabilities to our
own knowledge graph automatically, so answers stay current with no manual downloads and no paid cloud."

---

## 6. The data

- 38,461 CVEs (2024) · 944 CWEs · 559 CAPECs · 697 ATT&CK techniques = **40,661 nodes**, **44,045 links**
- 7 link types: `CVE_CWE`, `CWE_CAPEC`, `CAPEC_ATTACK`, `CWE_CHILD`, `CAPEC_CHILD`, `CAN_PRECEDE`, `SUBTECHNIQUE_OF`
- 10,349 CVEs (27%) connect all the way to an ATT&CK technique; 1,745 have no CWE yet
- Sources: NVD (CVEs, CVSS scores) and MITRE (CWE, CAPEC, ATT&CK); cleaned by `build_datasets.py` into `data/raw/`

---

## 7. What we added to the paper (our results)

The paper showed 4 examples and **no numbers**. We measured it (`backend/eval/`, shown on the Research page):

| 70 questions (20 with no ID), answers from the graph, Gemini | GraphRAG (ours) | Same AI, no graph |
|---|---|---|
| Accuracy | 97% | 3% |
| Invented (hallucinated) IDs | 0% | 74% |

**Fix-first score** (`backend/analytics/`, Insights page) ranks which bugs to patch first:
`100 × (CVSS ÷ 10) × (exploitability ÷ 3.9) × (0.5 + 0.5 × reachable ATT&CK techniques ÷ 10)`.
Tested on CISA's list of really exploited bugs: in its top 500 it finds **11**, vs 6 for CVSS alone and about 2 by chance.

Also new: search by meaning, the "Verified" check on every answer, streaming chat with follow-ups
("how do I fix it?" reuses the last IDs), saved history, and a live web app.

---

## 8. Tech stack

| Part | Tool | Why |
|---|---|---|
| Website | plain HTML, CSS, JavaScript, served by nginx | no framework, no build step, easy to read |
| 3D background | three.js (from a CDN) | draws the graph as 9,000 dots in 4 layer colours on a cream background (no dark mode) |
| API | FastAPI (Python) | fast, simple, auto docs at `/docs` |
| Graph database | Neo4j + Cypher | follows CVE → CWE → CAPEC → ATT&CK links in one query |
| Search by meaning | sentence-transformers all-MiniLM-L6-v2 + Neo4j vector indexes | finds records even with different words |
| AI | Google Gemini, `gemini-2.5-flash` | fast, called through its OpenAI-compatible API |
| Run / host | Docker Compose locally; Vercel + Neo4j Aura online | |

---

## 9. Known limitations

- The Vercel site (branch `main`) has 2024 CVEs only; the local auto-update branch keeps 2024 onwards current.
- The 20 no-ID questions reuse a CAPEC description sentence, so they are easier than real user wording (90% found).
- The Gemini API has rate limits per key; the eval numbers were measured earlier with Groq gpt-oss-120b.
- Online (Vercel) questions without an ID use keyword search, not semantic search.

## 10. Roadmap

- [x] Knowledge graph of CVE, CWE, CAPEC and ATT&CK in Neo4j
- [x] ID lookup with tested Cypher queries
- [x] Embeddings on every node (all-MiniLM-L6-v2)
- [x] Hybrid retrieval: vector search + graph expansion
- [x] Measured accuracy and hallucination; KEV-tested Fix-first score
- [ ] 150-question benchmark with real user wording
- [ ] EPSS scores and MITRE D3FEND defences in the graph
- [x] Daily automatic update from the NVD API and MITRE (local Docker)
- [ ] All CVE years (set `NVD_START_YEAR=1999`; needs more disk and a longer first run)

---

Never commit keys or passwords: keep them in `.env` (git-ignored). For defensive, educational and
research use. MIT licence, see [LICENSE](LICENSE).

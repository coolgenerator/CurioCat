[**中文**](./README.zh-CN.md) | English

<p align="center">
  <img src="frontend/public/CurioCat-Logo.png" alt="CurioCat" width="120" />
</p>

<h1 align="center">CurioCat</h1>

<p align="center">
  <em>"Curiosity killed the cat, but satisfaction brought it back."</em>
</p>

<p align="center"><strong>Causal Reasoning Engine for Evidence-Based Decisions</strong></p>

---

CurioCat is an AI-powered decision intelligence tool that makes causal reasoning visible and actionable. Feed it any unstructured text — a policy brief, startup pitch, news event, or strategic hypothesis — and it decomposes the information into atomic claims, traces the hidden cause-and-effect chains between them, grounds each causal link with real-world evidence, and presents the result as an interactive, explorable causal graph.

Instead of trusting black-box predictions, you see *why* one thing leads to another, *how strong* the evidence is, and *what happens if* your assumptions change. Every link in the reasoning chain is transparent, adjustable, and backed by sources — turning information overload into structured insight for better decisions.

## How It Works

CurioCat processes input through a multi-layer pipeline:

**Initial Analysis** — extract claims from user text and build the seed graph:

1. **Claim Decomposition** — LLM extracts atomic claims (FACT / ASSUMPTION / PREDICTION / OPINION) with confidence scores and source sentence provenance for audit trails
2. **Causal Link Inference** — Embedding similarity filters candidate pairs, then LLM judges causal direction, mechanism, and strength. Post-LLM validation gates reject edges with empty mechanisms, restated claims, or extreme strength values
3. **Bias Audit** — Detects 8 cognitive bias types and penalizes causal strength accordingly
4. **Evidence Grounding** — Adversarial dual search (supporting + contradicting) via Brave Search, scored for relevance, source credibility, and cross-domain diversity

**Discovery Layers** — iteratively expand the graph with facts the original text didn't mention:

5. **Fact Discovery** — LLM reads the evidence snippets collected above and extracts new claims not in the original text. New claims are deduplicated (0.95 cosine similarity) against existing ones and web-verified before admission
6. **Incremental Inference + Audit + Grounding** — Only claim pairs involving at least one new claim are checked (no re-checking old↔old pairs). New edges go through the same bias audit and evidence search as the seed layer

Discovery repeats (up to 3 layers by default) until convergence: fewer than 2 new claims and fewer than 1 new edge, or the layer budget is exhausted.

**Finalization:**

7. **DAG Construction** — Builds a directed acyclic graph with cycle detection/breaking and weak-edge pruning
8. **Belief Propagation** — Noisy-OR algorithm propagates beliefs along topological order, modulated by evidence quality. Computes uncertainty intervals via perturbation analysis

## Anti-Hallucination Pipeline

CurioCat is hardened against common LLM hallucination pathways with multiple validation layers:

| Layer | What It Does |
|-------|-------------|
| **Output Validation Gates** | Rejects causal links with empty/restated mechanisms or extreme strength values — prevents false causality from LLM confabulation |
| **Evidence Modulation** | Zero-evidence edges contribute zero belief (not 50%) — ungrounded claims can't propagate through the graph |
| **Bias Severity Penalties** | 8 cognitive bias types detected (correlation≠causation, survivorship, narrative fallacy, anchoring, reverse causality, selection bias, ecological fallacy, confirmation bias) with automatic strength reduction: low→5%, medium→20%, high→40% penalty |
| **Source Diversity Scoring** | Evidence from a single domain scores up to 30% lower — prevents over-reliance on one source |
| **Discovery Verification** | New claims discovered from evidence snippets are web-verified before entering the graph — blocks circular inference |
| **Claim Provenance** | Every claim stores the verbatim source sentence it was extracted from — full audit trail back to original text |
| **Belief Intervals** | Perturbation-based uncertainty bands on every node — see how sensitive each belief is to input variations |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React + D3.js + Tailwind)                │
│  ┌─────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  Input   │→│Processing│→│  Radial Tree View   │  │
│  │  Screen  │  │  (SSE)   │  │  (D3 imperative)   │  │
│  └─────────┘  └──────────┘  └────────────────────┘  │
│                               ┌──────┐ ┌──────────┐ │
│                               │Scenar│ │  Export   │ │
│                               │Forge │ │  Panel    │ │
│                               └──────┘ └──────────┘ │
└───────────────────┬─────────────────────────────────┘
                    │ REST / SSE / WebSocket
┌───────────────────┴─────────────────────────────────┐
│  Backend (FastAPI + SQLAlchemy)                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  5-Stage Pipeline Orchestrator               │   │
│  │  ClaimExtractor → CausalInferrer →           │   │
│  │  EvidenceGrounder → DAGBuilder →             │   │
│  │  BeliefPropagation                           │   │
│  └──────────────────────────────────────────────┘   │
│  ┌─────────┐  ┌───────────┐  ┌─────────────────┐   │
│  │ LLM     │  │  Graph    │  │  Evidence        │   │
│  │ Client  │  │  Algos    │  │  Search/Score    │   │
│  └─────────┘  └───────────┘  └─────────────────┘   │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │  PostgreSQL + pgvector │
        └───────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, D3.js v7, Tailwind CSS 4, Framer Motion |
| Backend | FastAPI, SQLAlchemy 2.0 (async), Pydantic v2 |
| Database | PostgreSQL 16 + pgvector |
| LLM | OpenAI / Anthropic (switchable) |
| Search | Brave Search API |
| Graph | NetworkX, Noisy-OR belief propagation |
| Infra | Docker Compose, Alembic migrations |
| Real-time | Server-Sent Events, WebSocket |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- Python 3.12+ ([uv](https://docs.astral.sh/uv/) recommended, pip also works)

### 1. Clone and configure environment

```bash
cd CurioCat
cp .env.example .env
```

Edit `.env` and fill in the required values:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Default works with the bundled Docker container: `postgresql+asyncpg://curiocat:curiocat@localhost:5432/curiocat` |
| `OPENAI_API_KEY` | Yes* | Your OpenAI API key (`sk-...`). Required when `LLM_PROVIDER=openai` (default) |
| `ANTHROPIC_API_KEY` | Yes* | Your Anthropic API key (`sk-ant-...`). Required when `LLM_PROVIDER=anthropic` |
| `BRAVE_SEARCH_API_KEY` | Yes | Brave Search API key for evidence grounding. Get one free at [brave.com/search/api](https://brave.com/search/api/) |
| `LLM_PROVIDER` | No | `openai` (default) or `anthropic` |
| `LLM_MODEL` | No | Model name. Default: `gpt-4o` |
| `EMBEDDING_MODEL` | No | Embedding model. Default: `text-embedding-3-small` |
| `SERVER_HOST` | No | Default: `0.0.0.0` |
| `SERVER_PORT` | No | Default: `8000` |
| `CORS_ORIGINS` | No | JSON array of allowed origins. Default: `["http://localhost:5173"]` |

> \* You need at least one of `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, depending on which provider you choose.

### 2. Start the database

CurioCat uses PostgreSQL 16 with the [pgvector](https://github.com/pgvector/pgvector) extension. The easiest way is via Docker:

```bash
docker compose up -d postgres
```

This starts a `pgvector/pgvector:pg16` container on port 5432 with automatic health checks. Data is persisted in a Docker volume (`pgdata`).

> **Already have PostgreSQL?** Install the `pgvector` extension, create a database named `curiocat`, and update `DATABASE_URL` in your `.env` accordingly.

### 3. Set up and start the backend

```bash
# Create a virtual environment and install dependencies
# Option A — uv (recommended, faster):
uv sync

# Option B — pip:
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Run database migrations
alembic upgrade head

# Start the backend server (http://localhost:8000)
uvicorn curiocat.main:app --reload
```

### 4. Start the frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The Vite dev server proxies `/api/*` and `/ws/*` requests to the backend automatically — no additional frontend configuration needed.

### 5. Load demo data (optional)

A pre-built example project ("Will AI Replace Programmers? — Causal Chain Analysis") is included so you can explore the graph immediately without spending API tokens:

```bash
psql postgresql://curiocat:curiocat@localhost:5432/curiocat -f seed_ai_replace_programmers.sql
```

This loads 77 claims, 1,717 causal edges, and 1,485 evidence records. After loading, visit [http://localhost:5173/history](http://localhost:5173/history) and click the project to explore.

> A Chinese version of the same dataset is also available: `seed_ai_replace_programmers_zh.sql`

### Alternative: Docker Compose (full stack)

To run the database and backend together in Docker:

```bash
docker compose up --build
```

This starts PostgreSQL + the backend API. You still need to run the frontend separately with `npm run dev` (see step 4).

## Usage

1. **Enter text** — Paste a scenario, article, or hypothesis (or pick a demo scenario)
2. **Watch the pipeline** — Claims stream in live as the engine decomposes and traces causal chains
3. **Explore the graph** — Interactive radial tree with zoom, click to expand/collapse nodes
4. **Inspect evidence** — Click edges to see supporting/contradicting evidence with source links
5. **Stress-test assumptions** — Right-click edges to modify causal strength; beliefs re-propagate in real-time
6. **Fork scenarios** — Create what-if branches, compare side-by-side or as overlay
7. **Export** — Download as JSON, Markdown report, or interactive HTML

## Project Structure

```
curiocat/
├── api/
│   ├── models/          # Request/response schemas (analysis, graph, scenarios)
│   └── routes/          # analysis, graph, scenarios, export, operations
├── db/                  # SQLAlchemy models and session
├── evidence/            # Brave Search client, source credibility scoring
├── graph/               # Belief propagation, sensitivity, critical path, scenario diff, focus, path finder
├── llm/
│   ├── prompts/         # Structured prompts (claim extraction, causal inference, evidence, bias, discovery, strategic advisor)
│   ├── client.py        # LLM client abstraction (OpenAI/Anthropic)
│   └── embeddings.py    # Embedding generation
├── pipeline/            # Orchestrator + stages: extract → infer → ground → build → propagate, bias audit, discovery
├── config.py            # Pydantic Settings
├── exceptions.py        # Custom error classes
└── main.py              # FastAPI app entry point

frontend/src/
├── components/
│   ├── input/           # InputScreen, DemoScenarios
│   ├── processing/      # ProcessingScreen, PipelineStream, ClaimStream, EdgeStream, EvidenceStream, StageTimeline
│   ├── tree/            # ForceGraph, GraphScreen, GraphListScreen, EvidencePanel, NodeDetailPanel, EdgeBundlePanel,
│   │                    # ClaimsBrowser, MiniMap, GraphTooltip, StrategicAdvisorPanel, TimelineView, TimeScrubber
│   ├── scenario/        # ScenarioForge, ComparisonView, MergeOverlay
│   ├── export/          # ExportPanel
│   ├── layout/          # AppLayout
│   └── ui/              # Button, Card, Badge, Slider, Progress, Textarea, Tooltip, LoadingSpinner, ResizablePanel, ErrorBoundary
├── context/             # AnalysisContext (useReducer state management)
├── hooks/               # useForceLayout, useSSEStream, useGraphWebSocket, useGraphOperations,
│                        # useKeyboardNavigation, useResizablePanel, useScenario, useTemporalBeliefs, useTheme
├── i18n/                # Internationalization (en, zh)
├── lib/
│   ├── api/             # HTTP client, SSE helper, WebSocket helper
│   ├── graphUtils.ts    # Graph layout utilities
│   └── visualConstants.ts
└── types/               # TypeScript interfaces (api, graph)
```

## License

MIT

# FirstTouch

### Beyond Highlights, Into Insights.

A highlight reel shows you the goal. FirstTouch shows you the **decision**. It rebuilds a
FIFA World Cup 2022 moment as an interactive 3D scene, all 22 players in their real
positions, and answers three questions the replay never does:

> **What did the player see? What were his options? Was his decision right?**

**IBM Granite** on **watsonx.ai** then scores the call and explains it like a broadcast
analyst, grounded in the real tracking data so it cannot invent what did not happen.

Built for the **IBM SkillsBuild AI Builders Challenge**.

- **Live App:** https://first-touch-phi.vercel.app/
- **Source:** https://github.com/tanishkuvar11/FirstTouch

---

## IBM Tech Stack

| Technology | What It Does Here |
| --- | --- |
| **IBM Granite** | Scores the decision (strict JSON), writes the streamed analyst prose, reads the manager's setup, and gives the What-If verdict. |
| **IBM watsonx.ai** | Serves Granite in production (`ibm/granite-4-h-small`, chat API). |
| **IBM Context Forge (MCP Gateway)** | Exposes the expected-threat option engine as MCP tools; What-If calls them through the gateway. |
| **LangChain (LCEL)** | Runs the What-If chain (`prompt \| Granite \| parse`) and renders every Granite prompt. |

## Features

**3D Scene**
- Rotatable 3D pitch (Three.js): drag to rotate, scroll to zoom, double-click to recentre.
- All 22 players with real kit colours, shirt numbers, the ball, and an action arrow.
- Player identity **(exact / inferred / unknown)** rebuilt from shot frames, line-ups and jersey data.
- Passing lanes drawn green (open) or red (blocked), computed from the freeze frame.

**Decision Panel (Four Tabs)**
- **Decision:** Action Quality score 0 to 100, split into Decision, Execution, Difficulty, with reasoning and pros/cons.
- **Profile:** Stakes gauge (how much it mattered) plus the Decision DNA radar (difficulty, vision, risk, leverage, execution).
- **Consequence Chain:** The real possession touch by touch, ending in the true outcome; click to jump.
- **What If:** Every alternative re-valued on expected threat, a Granite verdict, and a ghost arrow on the pitch.

**Match and Analyst**
- Streamed analyst prose with the portrait reacting (pleased / neutral / gutted).
- Momentum timeline with goal and card markers; click to jump.
- Line-ups and Tactics view: Formations, Substitutions, Managers, plus a Granite manager read.
- Four multilingual analysts (see below).

## Analysts and Languages

| Analyst | Language | Role |
| --- | --- | --- |
| **Nathan** | 🇬🇧 English | Tactical Analyst |
| **Valeria** | 🇪🇸 Español | Analista Táctica |
| **Claire** | 🇫🇷 Français | Analyste Tactique |
| **Lukas** | 🇩🇪 Deutsch | Taktikanalyst |

- One picker switches both the analyst and the entire UI (EN / ES / FR / DE).
- Prose is always written by Granite, never hardcoded, so it reads naturally per language.
- Each analyst's national allegiance colours the emotion, never the facts.
- Each persona has three mood portraits that track the moment.

## Three Independent Judgements

Kept separate instead of collapsed into one number:

- **Action Quality (Stage-Blind):** Decision, execution and difficulty of the action itself. Judged the same in a dead rubber and a final.
- **Stakes:** How much the moment mattered (stage, minute, scoreline), kept apart so it never inflates the skill score.
- **Decision DNA:** The player's signature, shown as a radar (vision, risk).

Difficulty is computed geometrically from the real frame, and a Python "Truth Anchor"
vetoes any judgement the geometry contradicts.

## How a Moment Flows

1. **Pick** a match and moment; backend serves the events and 360 frame.
2. **Reconstruct:** Enrich the frame (realign reflected frames, resolve identities, compute lanes and distances).
3. **Render** the 22 players, ball and lanes in 3D.
4. **Assess** (`/assess`): Granite returns a JSON verdict from a coordinate Field Map.
5. **Explain** (`/explain/stream`): A streamed, grounded read.
6. **Explore** (`/whatif`): Options valued via Context Forge, plus a Granite verdict.

Every Granite result is cached per moment, so a moment seen once replays instantly.

## Architecture

One container in production, localhost in development:

```
              Browser (React + Vite + Three.js)
                          | HTTPS
                          v
                FastAPI backend (main.py)
     _____________________|____________________
    |             |               |            |
data_layer   granite_client   whatif_chain   tactical_analysis
 360 enrich   Granite via      LangChain      lanes / geometry
 + cache      watsonx.ai       verdict chain
                                   | MCP over HTTP
                                   v
                  IBM Context Forge gateway (:4444)
                                   | federates
                                   v
                  FirstTouch MCP server (:9000)
                  xT option engine as MCP tools (whatif.py)
```

- Granite chain: **watsonx.ai -> local Ollama (dev) -> deterministic local fallback.**
- **Endpoints:** `/health` · `/matches` · `/matches/{id}/events` · `/matches/{id}/frames/{event_id}` · `/matches/{id}/teamsheet` · `POST /assess` · `POST /explain/stream` · `POST /whatif` · `POST /manager-tactics`

## Reliability

The app never breaks, even when Granite is unreachable (rate limit, quota, network).

- **Cached first:** Every Granite verdict and analyst read is cached per moment. A moment seen once replays instantly and never calls the model again, so cached moments keep showing real Granite output regardless of quota.
- **Pre-baked cache:** Verdicts can be generated ahead of time (`backend/precompute_cache.py`) and shipped in the image, so a fresh deploy serves real Granite from the first click.
- **Graceful fallback:** If a moment is uncached and Granite is down, a full deterministic tactical engine produces the score and prose instead. It is clearly marked with a **local estimate** tag in the UI, so a fallback result is never mistaken for a live Granite verdict.
- **Honest health:** `/health` reports the active Granite backend.

## Run Locally

```bash
cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000
cd frontend && npm install && npm run dev      # second terminal
```

- Open http://localhost:5173. First load of a match caches its 360 data to `backend/.firsttouch_cache/`.
- Windows: `start_services.ps1` starts Ollama, the MCP server and the Context Forge gateway.
- No Granite backend = scores and prose come from the local engine, clearly labelled.
- For real Granite locally, run Ollama with a Granite model, or set watsonx in `backend/.env`:

```
WATSONX_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_URL=https://eu-de.ml.cloud.ibm.com     # match your project's region
WATSONX_MODEL_ID=ibm/granite-4-h-small
```

## Deploy

- **Backend:** Hugging Face Space (Docker). One container runs the API, MCP server and Context Forge gateway, so What-If runs through the gateway in production. See `backend/Dockerfile`, `backend/start_deploy.sh`, `backend/README.md`.
- **Frontend:** Vercel. Set `VITE_API_URL` to the Space URL.
- **Live Granite:** Set the `WATSONX_*` Space secrets; `/health` confirms it.
- Granite output can be pre-baked (`backend/precompute_cache.py`) and shipped for instant cold starts.

## Project Layout

```
backend/   main.py (API) · data_layer (360 enrich+cache) · tactical_analysis (geometry)
           granite_client (Granite + backend chain) · whatif.py (xT engine)
           whatif_chain.py (LangChain via Context Forge) · mcp_server.py · cf_bootstrap.py
           analyst_personas.py · precompute_cache.py
frontend/  src/components (3D pitch, decision panel, timeline, line-ups, language)
           src (scoring, DNA, stakes, metrics, i18n, kit colours)
```

## Tech Stack

- **Frontend:** React 18, Vite, Three.js, Framer Motion, Axios
- **Backend:** Python 3.11, FastAPI, Uvicorn
- **AI:** IBM Granite via IBM watsonx.ai; Ollama (local dev)
- **Agentic Layer:** IBM Context Forge (MCP gateway), MCP, LangChain (LCEL) + langchain-mcp-adapters
- **Data:** StatsBomb Open Data, statsbombpy, pandas
- **Deploy:** Docker, Hugging Face Spaces (backend), Vercel (frontend)

## Principles

- **Grounded:** Granite gets real facts only; the Truth Anchor blocks anything invented.
- **Citable Models:** Option values use expected threat (xT), not hand-tuned guesses.
- **Honest:** Identity confidence flags; fallback output is labelled.
- **Never Broken:** Every cloud dependency has an in-process fallback.

---

An IBM Granite and watsonx.ai showcase for the IBM SkillsBuild AI Builders Challenge.
Data by [StatsBomb Open Data](https://github.com/statsbomb/open-data) (World Cup 2022,
competition 43, season 106; all 64 matches with full 360 coverage).

## License

Released under the [MIT License](LICENSE).

Third-party assets are not covered by this license and remain governed by their own terms: StatsBomb Open Data, the Qatar 2022 display font, images sourced from Wikipedia, and any tournament names or marks.

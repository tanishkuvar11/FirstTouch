# ⟡ FirstTouch

### Beyond highlights, into insights.

A highlight reel shows you the goal. FirstTouch shows you the **decision**: it rebuilds
a FIFA World Cup 2022 moment as an interactive 3D scene, all 22 players in their real
positions, and answers the three questions the replay never does.

> **What did the player actually see? What were his options? Was his decision right?**

Then it hands the moment to **IBM Granite** on **watsonx.ai**, which scores the call and
explains it like a broadcast analyst, grounded entirely in the real tracking data so it
can never invent what did not happen.

Built for the **IBM SkillsBuild AI Builders Challenge**.

- **Live app:** _add your Vercel URL here_
- **Live API:** https://tanishkuvar11-firsttouch.hf.space (`/health` shows the active backend)
- **Source:** https://github.com/tanishkuvar11/FirstTouch

---

## What it does

- **3D interactive pitch (Three.js).** Drag to rotate, scroll to zoom. See the moment from
  behind the player, from the keeper's eyeline, or anywhere around the stadium, with real
  kit colours and shirt numbers. Best on a laptop or desktop.
- **Player identity enrichment.** StatsBomb 360 dots carry no names; FirstTouch
  reconstructs each from shot frames, line-ups and jersey data, and flags every disc
  **exact / inferred / unknown** rather than guessing silently.
- **Passing lanes.** Open green, blocked red, computed geometrically from the freeze frame.
- **Decision scoring + analyst prose.** A transparent 0 to 100 score with a pros and cons
  list, plus a short, human, streamed read of the moment, both written by Granite from the
  real numbers.
- **What-If.** Re-value every alternative the player had on the expected-threat surface,
  with a Granite verdict, routed through the IBM Context Forge gateway.
- **Momentum timeline.** Whole-match flow with goal and card markers; click to jump.
- **Four multilingual analysts.** Distinct voices with full UI translation in English,
  Spanish, French and German.

## The IBM stack (doing real work, not bolted on)

| Technology | Role |
| --- | --- |
| **IBM Granite** | The analyst brain: computes the decision assessment as strict JSON, writes the streamed prose, judges the manager's setup, and delivers the What-If verdict, all reasoned from the tracking data. |
| **IBM watsonx.ai** | Serves Granite in production (`ibm/granite-4-h-small`, chat API). One set of credentials flips the app from local fallback to live cloud Granite. |
| **IBM Context Forge (MCP Gateway)** | Federates the expected-threat option engine as MCP tools. What-If genuinely calls those tools *through* the gateway, so the agentic path is real. |
| **LangChain (LCEL)** | Orchestrates What-If: pulls option values from the MCP tools and runs the Granite verdict as a composed `prompt \| model \| parse` chain. Also renders every Granite prompt. |

## Three independent judgements

Most "ratings" mislead by blending things that should be separate. FirstTouch keeps three apart:

- **Action Quality (stage-blind).** How good was the action itself? Decision quality (was
  this the best option), execution (how well it was struck, from the real outcome, so an
  on-target shot that is saved is good execution), and difficulty. Judged identically in a
  dead rubber and a final.
- **Stakes.** How much the moment mattered (stage, minute, scoreline), kept entirely
  separate so context never inflates the skill score.
- **Decision DNA.** The player's signature on the moment as a radar: vision and risk.

Difficulty is computed geometrically from the real frame where possible, so Granite cannot
excuse a poor outcome by overrating how hard it was. A Python "Truth Anchor" vetoes any
judgement the geometry contradicts.

## How a moment flows

1. **Pick** a match and a moment; the backend serves the events and the 360 frame.
2. **Reconstruct:** enrich the freeze frame (realign reflected frames, resolve identities,
   compute lanes, distances, defenders bypassed, how close a shot finished).
3. **Render** all 22 players, the ball and the lanes on a rotatable 3D pitch.
4. **Assess** (`/assess`): Granite returns a JSON verdict from a coordinate Field Map.
5. **Explain** (`/explain/stream`): a streamed, grounded analyst read.
6. **Explore** (`/whatif`): options valued on expected threat via Context Forge, plus a
   Granite verdict; the best alternative is drawn as a ghost arrow.

Every Granite result is cached per moment on disk, so a moment seen once replays instantly
thereafter, on any backend and across restarts.

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

Granite preference chain: **watsonx.ai -> local Ollama (dev) -> deterministic local
fallback.** The fallback is a full tactical engine, so the app is never broken; it simply
labels its output a local estimate when no Granite backend is reachable.

**Key endpoints:** `GET /health` (active backend) · `GET /matches` · `GET /matches/{id}/events`
· `GET /matches/{id}/frames/{event_id}` · `GET /matches/{id}/teamsheet` · `POST /assess`
· `POST /explain/stream` · `POST /whatif` · `POST /manager-tactics`

## Run it locally

```bash
cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000
cd frontend && npm install && npm run dev      # in a second terminal
```

Open http://localhost:5173. The first load of a match downloads its 360 data and caches it
to `backend/.firsttouch_cache/`. On Windows, `start_services.ps1` brings up the supporting
services (local Ollama, the MCP server and the Context Forge gateway) in one step.

Without any Granite backend, scores and prose come from the local engine and are clearly
labelled, never a broken state. For real Granite locally, run Ollama with a Granite model,
or point at watsonx.ai via `backend/.env`:

```
WATSONX_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_URL=https://eu-de.ml.cloud.ibm.com     # must match your project's region
WATSONX_MODEL_ID=ibm/granite-4-h-small
```

## Deploy

- **Backend: Hugging Face Space (Docker).** One container runs the API, the MCP server and
  the Context Forge gateway over localhost, so What-If is served through the real gateway in
  production. See `backend/Dockerfile`, `backend/start_deploy.sh`, `backend/README.md`.
- **Frontend: Vercel.** Set `VITE_API_URL` to the Space URL (`frontend/vercel.json`).
- **Live Granite:** set `WATSONX_*` as Space secrets; `GET /health` confirms it.

Granite output can also be pre-baked with `backend/precompute_cache.py` and shipped in the
image, so the deployed app replays real Granite instantly even on a cold start.

## Project layout

```
backend/   main.py (API) · data_layer (360 enrich+cache) · tactical_analysis (geometry)
           granite_client (Granite: assess/prose/verdict + backend chain)
           whatif.py (xT engine) · whatif_chain.py (LangChain via Context Forge)
           mcp_server.py · cf_bootstrap.py · analyst_personas.py · precompute_cache.py
frontend/  src/components (3D pitch, decision panel, timeline, line-ups, language)
           src (scoring, DNA, stakes, metrics, i18n, kit colours)
```

## Principles

- **Grounded, never invented.** Granite gets the real facts and is forbidden to invent
  players, numbers or events; the Truth Anchor enforces it.
- **Real models, not heuristics.** Option values use expected threat (xT), a citable model.
- **Honest about uncertainty.** Identity confidence flags; output labelled when it comes
  from the local fallback.
- **Never a broken state.** Every cloud dependency has an in-process fallback.

---

An IBM Granite and watsonx.ai showcase for the IBM SkillsBuild AI Builders Challenge.
Data by [StatsBomb Open Data](https://github.com/statsbomb/open-data) (World Cup 2022,
competition 43, season 106; all 64 matches with full 360 coverage).

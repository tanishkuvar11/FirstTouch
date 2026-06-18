# FirstTouch

### Beyond highlights, into insights.

A highlight reel shows you the goal. FirstTouch shows you the **decision**: it rebuilds
a FIFA World Cup 2022 moment as an interactive 3D scene, all 22 players in their real
positions, and answers the three questions the replay never does.

> **What did the player actually see? What were his options? Was his decision right?**

It then hands the moment to **IBM Granite** on **watsonx.ai**, which scores the call and
explains it like a broadcast analyst, grounded entirely in the real tracking data so it
can never invent what did not happen.

Built for the **IBM SkillsBuild AI Builders Challenge**.

- **Live App:** https://first-touch-phi.vercel.app/
- **Source:** https://github.com/tanishkuvar11/FirstTouch

---

## Features

**The 3D Scene**

- **Interactive Pitch (Three.js).** Drag to rotate, scroll to zoom, double-click to recentre.
  See the moment from behind the player, from the keeper's eyeline, or anywhere around the
  stadium, with real kit colours, shirt numbers, the ball, and an arrow marking the action
  the player actually took. Best on a laptop or desktop.
- **Player Identity Enrichment.** StatsBomb 360 dots carry no names. FirstTouch reconstructs
  each player's identity from shot freeze frames, tactical line-ups and jersey data, and
  flags every disc **exact/inferred/unknown** rather than guessing silently. Each
  player shows their name, position and a photo pulled from Wikipedia.
- **Passing Lanes.** Open lanes are drawn green and blocked lanes red, computed geometrically
  from the freeze frame, so the options the player had are visible at a glance.
- **Live Scorebug and HUD.** A broadcast-style clock and scoreline, plus on-pitch readouts
  for pressure, expected goals and distances.

**The decision panel (four lenses, one moment)**

- **Decision.** The headline Action Quality score (0 to 100) broken into its three auditable
  parts, Decision (Right Call?), Execution (Struck Well?) and Difficulty (How Hard?), with a
  Granite-written reasoning line and a pros and cons list, plus a s	ituation readout (pressure,
  xG, outcome). Nothing is a black box; the score is shown built from its pieces.
- **Profile.** A Stakes gauge for how much the moment mattered, and the Decision DNA radar
  (vision and risk). See [Three independent judgements](#three-independent-judgements) below.
- **Consequence Chain.** The real StatsBomb possession the decision belonged to, touch by
  touch, with the selected event marked and the true terminal outcome (goal, saved shot, lost
  ball). Click any touch to jump to it. No modelling, just what the move became.
- **What If.** Every realistic alternative the player had, re-valued on the expected-threat
  surface, with a Granite verdict on whether the actual choice was best. The best alternative
  is drawn as a ghost arrow on the 3D pitch. The values are fetched through the IBM Context
  Forge gateway.

**The analyst and the match**

- **Streamed analyst prose.** A short, human, grounded read of the moment, written by Granite
  and typed out live, with the analyst's portrait reacting (pleased, neutral, gutted) to what
  happened.
- **Momentum timeline.** The whole-match flow with goal and card markers; click any spike to
  jump to that passage of play.
- **Line-ups and Tactics.** A dedicated view with each team's starting formation,
  substitutions and manager, plus a Granite read on the manager's tactical approach grounded
  in the real formation and contributors.
- **Four multilingual analysts.** See [Analysts and languages](#analysts-and-languages) below.

## Analysts and languages

FirstTouch ships four analyst personas, each with their own portrait, voice and national
allegiance:

| Analyst | Language | Role |
| --- | --- | --- |
| **Nathan** | English | Tactical Analyst |
| **Valeria** | Español (Spanish) | Analista Táctica |
| **Claire** | Français (French) | Analyste Tactique |
| **Lukas** | Deutsch (German) | Taktikanalyst |

A single language picker switches **both** the analyst and the **entire UI** across English,
Spanish, French and German. Each analyst's prose is always written by Granite and grounded by
injected facts, never hardcoded, so it reads naturally in its own language; their national
allegiance colours the emotion of the read (delighted when their country benefits, gutted when
it suffers) without ever changing what actually happened. Each persona has three mood portraits
that track the moment.

## The IBM stack

| Technology | Role |
| --- | --- |
| **IBM Granite** | The analyst brain: computes the decision assessment as strict JSON, writes the streamed prose, judges the manager's setup, and delivers the What-If verdict, all reasoned from the tracking data. |
| **IBM watsonx.ai** | Serves Granite in production (`ibm/granite-4-h-small`, chat API). One set of credentials flips the app from local fallback to live cloud Granite. |
| **IBM Context Forge (MCP Gateway)** | Federates the expected-threat option engine as MCP tools. What-If calls those tools through the gateway to value the player's options. |
| **LangChain (LCEL)** | Orchestrates What-If: pulls option values from the MCP tools and runs the Granite verdict as a composed `prompt \| model \| parse` chain. Also renders every Granite prompt. |

## Three independent judgements

FirstTouch keeps three judgements apart instead of collapsing them into a single number:

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
  the Context Forge gateway over localhost, so What-If is served through the gateway in
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
- **Citable models.** Option values use expected threat (xT), a published model, not
  hand-tuned guesses.
- **Honest about uncertainty.** Identity confidence flags; output labelled when it comes
  from the local fallback.
- **Never a broken state.** Every cloud dependency has an in-process fallback.

---

An IBM Granite and watsonx.ai showcase for the IBM SkillsBuild AI Builders Challenge.
Data by [StatsBomb Open Data](https://github.com/statsbomb/open-data) (World Cup 2022,
competition 43, season 106; all 64 matches with full 360 coverage).

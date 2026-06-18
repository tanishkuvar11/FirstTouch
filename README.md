# ⟡ FirstTouch — World Cup Decision Intelligence

**What did the player actually see? What were his options? Was his decision right?**

FirstTouch reconstructs famous World Cup 2022 moments from StatsBomb 360 freeze-frame
data as an interactive 3D scene — all 22 players, real jersey numbers, real kit colors —
scores every decision 0–100, and asks **IBM Granite** (watsonx.ai) to explain it like
a broadcast analyst.

Built for the IBM SkillsBuild AI Builders Challenge.

## Features

- **3D interactive pitch** (Three.js) — drag to rotate, scroll to zoom; see the moment
  from behind the actor, from the goalkeeper's view, from anywhere
- **Player identity enrichment** — StatsBomb 360 dots carry no names; FirstTouch
  reconstructs identity from shot freeze frames, tactics lineups and jersey data,
  with an honest exact / inferred / unknown confidence flag on every disc
- **Passing lanes** — green = open, red = blocked, computed geometrically
- **Decision score** — transparent 0–100 scoring with a pros/cons checklist
- **IBM Granite explanations** — what he saw, what his options were, was it right
  (with a fully local tactical-engine fallback so the app never breaks)
- **Momentum timeline** — full match flow with goal & card markers, click to jump

## Running locally

```bash
# Backend (Python 3.11)
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The first load of a match downloads its 360 data
(~30–50 MB) and disk-caches it to `backend/.firsttouch_cache/` — repeat loads are instant.

### IBM Granite (optional but recommended)

Put your watsonx.ai credentials in `backend/.env`:

```
WATSONX_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_URL=https://us-south.ml.cloud.ibm.com
```

Without credentials, explanations come from the local tactical engine and are
labeled accordingly — never a broken state.

## Deployment

- Backend → Render.com (`backend/render.yaml`)
- Frontend → Vercel (`frontend/vercel.json`, set `VITE_API_URL` to the Render URL)

## Data

StatsBomb Open Data — FIFA World Cup 2022 (competition 43, season 106).
All 64 matches have full 360 freeze-frame coverage.

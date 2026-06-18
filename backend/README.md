---
title: FirstTouch API
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: World Cup 2022 decision intelligence (IBM Granite + Context Forge)
---

# FirstTouch API (Hugging Face Space)

All-in-one backend for FirstTouch: the FastAPI API, the MCP server (xT engine as
a tool) and the IBM Context Forge gateway run together in one container and talk
over localhost, so the What-If path is genuinely served through Context Forge
(`served_by: contextforge+langchain`), exactly like local.

The Space free CPU tier (2 vCPU / 16 GB) is large enough to run the full live
stack. The frontend is hosted separately (Vercel) and points at this Space URL.

## Required secret

Set in **Settings -> Variables and secrets**:

- `HF_TOKEN` - a Hugging Face access token (Read scope). This is the live Granite
  inference backend.

## Recommended secrets (override the weak dev defaults)

- `JWT_SECRET_KEY`
- `AUTH_ENCRYPTION_SECRET`
- `BASIC_AUTH_PASSWORD`

## Health check

`GET /health` reports which Granite backend is active.

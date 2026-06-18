---
title: FirstTouch API
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: WC2022 3D decision intelligence (Granite + Context Forge)
---

# FirstTouch API (Hugging Face Space)

All-in-one backend for FirstTouch: the FastAPI API, the MCP server (xT engine as
a tool) and the IBM Context Forge gateway run together in one container and talk
over localhost, so the What-If path is genuinely served through Context Forge
(`served_by: contextforge+langchain`), exactly like local.

The Space free CPU tier (2 vCPU / 16 GB) is large enough to run the full live
stack. The frontend is hosted separately (Vercel) and points at this Space URL.

## Required secrets

Set in **Settings -> Variables and secrets**. The live Granite backend is IBM
watsonx.ai:

- `WATSONX_API_KEY` - an IBM Cloud API key.
- `WATSONX_PROJECT_ID` - a watsonx.ai project with a Runtime service associated.
- `WATSONX_URL` - the region endpoint, e.g. `https://eu-de.ml.cloud.ibm.com`
  (Frankfurt) or `https://us-south.ml.cloud.ibm.com` (Dallas). Must match the
  region of the project and its Runtime.

## Recommended secrets (override the weak dev defaults)

- `JWT_SECRET_KEY`
- `AUTH_ENCRYPTION_SECRET`
- `BASIC_AUTH_PASSWORD`

## Health check

`GET /health` reports which Granite backend is active.

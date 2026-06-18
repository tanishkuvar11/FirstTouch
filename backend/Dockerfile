# All-in-one FirstTouch backend image: the API, the MCP server (xT engine as a
# tool) and the IBM Context Forge gateway run together in ONE container and talk
# over localhost, so the deployed What-If path is genuinely served through Context
# Forge (served_by: contextforge+langchain), exactly like local.
#
# Context Forge is kept in its OWN virtualenv (/opt/cf-venv), separate from the
# backend's (/opt/venv), because their dependencies clash - the same isolation we
# use locally with .cf-venv. Needs ~1GB RAM (Railway / Fly.io / a small VPS), not
# Render's 512MB free tier. Build context is this backend/ directory.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONUTF8=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash curl \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces (and good practice elsewhere) run the container as UID 1000,
# not root, so runtime writes to /app (.cf_token, the cache dir) must be owned by
# that user. Create it now and chown the app dir when we copy code in below.
RUN useradd -m -u 1000 user
# HF Spaces serves on 7860 by default (matched by app_port in README.md). The
# launcher reads $PORT for the public API; the gateway/MCP ports stay internal.
ENV HOME=/home/user PORT=7860

# --- backend virtualenv ---
RUN python -m venv /opt/venv
COPY requirements.txt .
RUN /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install -r requirements.txt

# --- Context Forge gateway virtualenv (isolated to avoid dependency clashes) ---
RUN python -m venv /opt/cf-venv \
    && /opt/cf-venv/bin/pip install --upgrade pip \
    && /opt/cf-venv/bin/pip install mcp-contextforge-gateway==1.0.3

# app code + baked caches (big frames_*.json are excluded via .dockerignore).
# chown to the runtime user so the cache dir and .cf_token are writable on HF.
COPY --chown=user:user . .
# chown the /app dir node itself (WORKDIR created it root-owned) so UID 1000 can
# create .firsttouch_cache/ and write .cf_token at runtime.
RUN chmod +x start_deploy.sh && chown -R user:user /app

USER user

# only the backend port is published; :9000 and :4444 stay internal to the container
CMD ["bash", "start_deploy.sh"]

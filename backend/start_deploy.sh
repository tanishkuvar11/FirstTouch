#!/usr/bin/env bash
# Boot the full FirstTouch stack inside one container: MCP server (xT engine) +
# Context Forge gateway + the API. The gateway and MCP server stay on localhost;
# only the API binds the public $PORT. If the gateway is slow or fails, the API
# still starts and What-If falls back to the in-process engine, so it never breaks.
set -uo pipefail
export PYTHONUNBUFFERED=1 PYTHONUTF8=1 PYTHONIOENCODING=utf-8

VENV=/opt/venv/bin
CFV=/opt/cf-venv/bin
APP_PORT="${PORT:-8000}"   # platform-provided public port for the API

# Gateway secrets: these dev defaults are weak and are overridden via platform env in prod.
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-firsttouch_dev_jwt_secret_key_0123456789abcdef}"
export AUTH_ENCRYPTION_SECRET="${AUTH_ENCRYPTION_SECRET:-firsttouch_dev_encryption_secret_0123456789abc}"

echo "[start] MCP server on :9000 (xT engine as MCP tools)"
"$VENV/python" mcp_server.py &

echo "[start] Context Forge gateway on :4444"
(
  export HOST=127.0.0.1 PORT=4444 \
    BASIC_AUTH_USER="${BASIC_AUTH_USER:-admin}" \
    BASIC_AUTH_PASSWORD="${BASIC_AUTH_PASSWORD:-Firsttouch!2022dev}" \
    AUTH_REQUIRED=false MCP_REQUIRE_AUTH=false \
    CACHE_TYPE=memory REDIS_ENABLED=false RATE_LIMIT_ENABLED=false \
    DATABASE_URL="sqlite:////tmp/cf_gateway.db" \
    FEDERATION_ENABLED=true SSRF_ALLOW_LOCALHOST=true
  exec "$CFV/mcpgateway-server"
) &

echo "[start] bootstrapping Context Forge (mint token + federate MCP server)"
(
  export CF_GATEWAY="http://127.0.0.1:4444" FT_MCP_URL="http://127.0.0.1:9000/mcp"
  "$CFV/python" cf_bootstrap.py \
    || echo "[start] bootstrap failed; What-If will use the in-process fallback"
) &

# The API talks to the gateway at http://127.0.0.1:4444/mcp (whatif_chain default),
# so CF_GATEWAY_DISABLED must stay UNSET here. Granite comes from watsonx creds on deploy.
echo "[start] API (uvicorn) on :$APP_PORT"
exec "$VENV/python" -m uvicorn main:app --host 0.0.0.0 --port "$APP_PORT"

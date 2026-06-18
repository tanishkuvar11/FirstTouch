"""Bootstrap IBM Context Forge for FirstTouch (run by the gateway's venv).

Idempotent: waits for the gateway, mints a bearer token, federates the
FirstTouch MCP server (so its tools enter the catalog and the gateway's /mcp
endpoint), and writes the token to backend/.cf_token for the backend to use.

Env (set by the launcher): JWT_SECRET_KEY, and optionally CF_GATEWAY (default
http://127.0.0.1:4444), FT_MCP_URL (default http://127.0.0.1:9000/mcp)."""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

GATEWAY = os.getenv("CF_GATEWAY", "http://127.0.0.1:4444")
MCP_URL = os.getenv("FT_MCP_URL", "http://127.0.0.1:9000/mcp")
SECRET = os.getenv("JWT_SECRET_KEY", "firsttouch_dev_jwt_secret_key_0123456789abcdef")
NAME = "firsttouch"
TOKEN_FILE = os.path.join(os.path.dirname(__file__), ".cf_token")


def _req(method, path, token=None, body=None):
    url = GATEWAY + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read().decode()
        return resp.status, (json.loads(raw) if raw else None)


def _wait_for_gateway(timeout=60):
    for _ in range(timeout * 2):
        try:
            with urllib.request.urlopen(GATEWAY + "/health", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def _mint_token() -> str:
    out = subprocess.run(
        [sys.executable, "-m", "mcpgateway.utils.create_jwt_token",
         "--username", "admin@example.com", "--exp", "43200", "--secret", SECRET],
        capture_output=True, text=True)
    return (out.stdout or "").strip().splitlines()[-1] if out.stdout.strip() else ""


def main():
    if not _wait_for_gateway():
        print("[cf_bootstrap] gateway did not come up in time")
        return 1
    token = _mint_token()
    if not token:
        print("[cf_bootstrap] could not mint token")
        return 1
    with open(TOKEN_FILE, "w", encoding="utf-8") as fh:
        fh.write(token)

    # federate the MCP server if not already registered
    try:
        _status, gws = _req("GET", "/gateways", token=token)
        names = {g.get("name") for g in (gws or [])}
        if NAME in names:
            print(f"[cf_bootstrap] '{NAME}' already federated")
        else:
            _req("POST", "/gateways", token=token,
                 body={"name": NAME, "url": MCP_URL, "transport": "STREAMABLEHTTP"})
            print(f"[cf_bootstrap] federated MCP server '{NAME}' -> {MCP_URL}")
    except urllib.error.HTTPError as e:
        print(f"[cf_bootstrap] federation call returned {e.code}: {e.read().decode()[:200]}")
    except Exception as e:
        print(f"[cf_bootstrap] federation error: {e}")
    print("[cf_bootstrap] token written to .cf_token; Context Forge ready")
    return 0


if __name__ == "__main__":
    sys.exit(main())

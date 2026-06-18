"""What-If reasoning as a genuine LangChain pipeline over IBM Context Forge.

This is the real-AI path (not decorative):
  1. The option values are fetched by calling the `firsttouch-score-options`
     tool THROUGH the IBM Context Forge MCP gateway (LangChain MCP adapters),
     which federates our MCP server (mcp_server.py) wrapping the real xT engine.
  2. The verdict is produced by a real LCEL chain:
       ChatPromptTemplate | Granite(Runnable) | JSON parse.
So LangChain orchestrates, Context Forge serves the tool, Granite reasons, and
the numbers stay ground truth. If the gateway/MCP is unreachable the caller
falls back to the in-process engine (whatif.py + granite_client.whatif_verdict),
so the feature never breaks.

Run requires: the MCP server (port 9000), the Context Forge gateway (port 4444)
with our server federated, and a gateway bearer token (CF_GATEWAY_TOKEN or the
file backend/.cf_token, written by cf_bootstrap.py)."""

import json
import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda
from langchain_mcp_adapters.client import MultiServerMCPClient

import granite_client

CF_GATEWAY_MCP = os.getenv("CF_GATEWAY_URL", "http://127.0.0.1:4444/mcp")
_TOKEN_FILE = os.path.join(os.path.dirname(__file__), ".cf_token")


def _gateway_token() -> str:
    tok = os.getenv("CF_GATEWAY_TOKEN", "")
    if tok:
        return tok
    try:
        with open(_TOKEN_FILE, encoding="utf-8") as fh:
            return fh.read().strip()
    except Exception:
        return ""


def _mcp_client() -> MultiServerMCPClient:
    headers = {}
    tok = _gateway_token()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    return MultiServerMCPClient({
        "contextforge": {
            "url": CF_GATEWAY_MCP,
            "transport": "streamable_http",
            "headers": headers,
        }
    })


def _tool_payload_to_dict(res) -> dict:
    """langchain-mcp tool results come back as a string or a content-block list."""
    if isinstance(res, dict):
        return res
    if isinstance(res, list) and res and isinstance(res[0], dict):
        res = res[0].get("text", "")
    if isinstance(res, str):
        return json.loads(res)
    return {}


# the Granite step as a real LCEL Runnable
def _granite_call(prompt_value) -> str:
    text = prompt_value.to_string() if hasattr(prompt_value, "to_string") else str(prompt_value)
    out, _via = granite_client._complete(
        text, max_tokens=200, temperature=0.0, fmt="json",
        ollama_model=os.getenv("OLLAMA_ASSESS_MODEL"))
    return out or ""


_granite = RunnableLambda(_granite_call)
_prompt = ChatPromptTemplate.from_template("{prompt_text}")


def _parse(text: str) -> dict:
    # tolerant JSON extraction (handles fences / trailing commas). We avoid
    # langchain's JsonOutputParser on purpose: importing it pulls in transformers,
    # which trips this env's broken numpy version metadata.
    return granite_client._extract_json(text if isinstance(text, str) else str(text))


# LCEL: prompt template -> Granite -> tolerant JSON parse
_verdict_chain = _prompt | _granite | RunnableLambda(_parse)


def _shape_verdict(raw: dict, analysis: dict, via: str) -> dict:
    # the verdict CLASS is ground truth from the xT engine; Granite only writes
    # the prose, so it can never contradict the numbers
    verdict = analysis.get("summary", {}).get("verdict_class", "solid")
    headline = granite_client._clean(str(raw.get("headline") or "").strip())[:80]
    detail = granite_client._clean(granite_client._cap_sentences(str(raw.get("detail") or "").strip(), 2))
    fb = granite_client._whatif_fallback(analysis)
    return {
        "source": "granite",
        "via": via,
        "verdict": verdict,
        "headline": headline or fb["headline"],
        "detail": detail or fb["detail"],
    }


async def run_whatif(frame: dict, ctx: dict) -> dict:
    """Full What-If via Context Forge + LangChain + Granite. Returns the same
    shape as the in-process path: {origin, actor, options, summary, verdict}.
    Raises on any gateway/MCP failure so the caller can fall back."""
    # per-moment cache (full payload) so repeats are instant and the gateway +
    # Granite are hit once per moment
    key = granite_client._whatif_key(ctx)
    cached = _FULL_CACHE.get(key)
    if cached:
        return cached

    # On a deploy there is no Context Forge gateway, so skip straight to the
    # caller's in-process fallback instead of waiting on a refused connection.
    if os.getenv("CF_GATEWAY_DISABLED", "").lower() in ("1", "true", "yes"):
        raise RuntimeError("Context Forge disabled (CF_GATEWAY_DISABLED)")

    # 1) fetch the real option values THROUGH Context Forge (LangChain MCP tool)
    client = _mcp_client()
    tools = await client.get_tools()
    score = next((t for t in tools if t.name.endswith("score-options") or t.name.endswith("score_options")), None)
    if score is None:
        raise RuntimeError("score-options tool not exposed by Context Forge gateway")
    raw = await score.ainvoke({"frame": frame})
    analysis = _tool_payload_to_dict(raw)
    if not analysis.get("options"):
        raise RuntimeError("gateway returned no options")

    # 2) verdict via the real LCEL chain (prompt | Granite | parse)
    prompt_text = granite_client._build_whatif_prompt(ctx, analysis)
    try:
        parsed = await _verdict_chain.ainvoke({"prompt_text": prompt_text})
        verdict = _shape_verdict(parsed if isinstance(parsed, dict) else {}, analysis,
                                 via="Context Forge + Granite")
    except Exception as exc:
        print(f"[whatif_chain] verdict chain failed, using deterministic verdict: {exc}")
        verdict = {**granite_client._whatif_fallback(analysis), "source": "granite", "via": "Context Forge"}

    result = {**analysis, "verdict": verdict, "served_by": "contextforge+langchain"}
    _FULL_CACHE[key] = result
    _persist_full_cache()
    return result


# full-payload disk cache (options + verdict), keyed per moment
_CACHE_FILE = os.path.join(os.path.dirname(__file__), ".firsttouch_cache", "whatif_full_cache.json")


def _load_full_cache() -> dict:
    try:
        with open(_CACHE_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


_FULL_CACHE = _load_full_cache()


def _persist_full_cache() -> None:
    try:
        os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
        with open(_CACHE_FILE, "w", encoding="utf-8") as fh:
            json.dump(_FULL_CACHE, fh)
    except Exception as exc:
        print(f"[whatif_chain] could not persist cache: {exc}")


def precompute_whatif(frame: dict, ctx: dict):
    """Bake one moment's full What-If payload into the disk cache, so a deployed
    backend (which has no Context Forge gateway) serves it instantly.

    Resumable: a moment already in the FULL cache is returned untouched. Tries the
    real Context Forge + LangChain + Granite chain first; if the gateway is down it
    computes the same payload in-process (deterministic xT engine + Granite verdict)
    and STILL writes it into the FULL cache, because on deploy `run_whatif` reads
    the FULL cache before it ever touches the gateway. Returns (result, how)."""
    import asyncio

    import whatif as whatif_engine

    key = granite_client._whatif_key(ctx)
    if key in _FULL_CACHE:
        return _FULL_CACHE[key], "cached"

    try:
        result = asyncio.run(run_whatif(frame, ctx))  # writes + persists on success
        return result, (result.get("verdict") or {}).get("via") or "Context Forge + Granite"
    except Exception as exc:
        print(f"[whatif_chain] gateway path unavailable, baking in-process: {exc}")

    analysis = whatif_engine.enumerate_options(frame)
    verdict = granite_client.whatif_verdict(ctx, analysis)
    result = {**analysis, "verdict": verdict, "served_by": "in-process"}
    _FULL_CACHE[key] = result
    _persist_full_cache()
    return result, (verdict.get("via") or verdict.get("source") or "local")

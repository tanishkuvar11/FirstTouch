"""FirstTouch API — World Cup 2022 decision intelligence."""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import data_layer
import granite_client
import tactical_analysis
import whatif as whatif_engine
import whatif_chain

app = FastAPI(
    title="FirstTouch API",
    description="Beyond highlights, into insights. StatsBomb 360 + IBM Granite.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    # so the browser can read which Granite backend served the stream
    expose_headers=["X-Granite-Source", "X-Granite-Via"],
)


@app.on_event("startup")
def _startup_banner():
    backend = granite_client.active_backend()
    n_assess = len(granite_client._ASSESS_CACHE)
    n_prose = len(granite_client._EXPLAIN_CACHE)
    print("=" * 64)
    print(f"FirstTouch API ready. Granite backend: {backend}")
    print(f"Baked cache: {n_assess} assessments, {n_prose} prose reads on disk.")
    if backend.startswith("local"):
        print("NOTE: serving LOCAL estimates. Set watsonx creds, or")
        print("      ship a precomputed cache, to serve real Granite on deploy.")
    print("=" * 64)


@app.get("/")
def root():
    return {"app": "FirstTouch", "competition": "FIFA World Cup 2022", "docs": "/docs"}


@app.get("/health")
def health():
    """Lets you confirm, after deploy, whether real Granite is reachable and how
    much of the cache is baked."""
    return {
        "granite_backend": granite_client.active_backend(),
        "assessments_cached": len(granite_client._ASSESS_CACHE),
        "prose_cached": len(granite_client._EXPLAIN_CACHE),
    }


@app.get("/matches")
def matches():
    return data_layer.list_matches()


@app.get("/matches/{match_id}/events")
def events(match_id: int):
    try:
        return data_layer.list_events(match_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"events unavailable: {exc}")


@app.get("/matches/{match_id}/lineups")
def lineups(match_id: int):
    try:
        return data_layer.get_lineups(match_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"lineups unavailable: {exc}")


@app.get("/matches/{match_id}/teamsheet")
def teamsheet(match_id: int):
    """Starting formation, substitutions and managers for the Line-ups view."""
    try:
        return data_layer.team_sheet(match_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"team sheet unavailable: {exc}")


class ManagerTacticsRequest(BaseModel):
    match_id: int
    team: str
    lang: str | None = None


@app.post("/manager-tactics")
def manager_tactics(req: ManagerTacticsRequest):
    """A short IBM Granite read on the manager's tactical approach for one team in
    one match, grounded by the real formation, substitutions and contributors."""
    try:
        sheet = data_layer.team_sheet(req.match_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"team sheet unavailable: {exc}")
    return granite_client.manager_tactics(req.match_id, req.team, sheet, req.lang)


@app.get("/matches/{match_id}/frames/{event_id}")
def frame(match_id: int, event_id: str):
    try:
        enriched = data_layer.enrich_frame(match_id, event_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    ev = enriched["event"]
    enriched["tactical"] = tactical_analysis.analyze_frame(
        enriched["players"],
        ev.get("location"),
        ev.get("type"),
        ev.get("end_location"),
    )
    # A penalty is not a free-play decision — shooting is the only option.
    if ev.get("shot_type") == "Penalty":
        enriched["tactical"]["best_option"] = "shot"
        enriched["tactical"]["decision_quality"] = "optimal"
    return enriched


@app.get("/matches/{match_id}/possession/{possession_id}")
def possession(match_id: int, possession_id: int,
               up_to_index: int | None = Query(default=None)):
    try:
        return data_layer.possession_chain(match_id, possession_id, up_to_index)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"possession unavailable: {exc}")


class ExplainRequest(BaseModel):
    frame: dict


def _attach_truth_geometry(ctx: dict) -> None:
    """Enrich a client-sent frame with geometry computed from the AUTHORITATIVE
    freeze-frame (never trust client-sent coordinates): pass/carry/shot distances,
    defenders bypassed, forward progress and how close a shot finished to the goal.
    Shared by /assess (Field Map + difficulty) and /explain (prose grounding) so a
    near-miss strike or a long carry is judged and narrated from the real numbers.
    No-op when the ids are missing or the frame already carries the geometry."""
    mid, eid = ctx.get("match_id"), ctx.get("event_id")
    if mid is None or not eid or "players" in ctx:
        return
    try:
        import moment_context as mc
        fr = data_layer.enrich_frame(mid, eid)
        ev = fr.get("event") or {}
        ctx["players"] = fr.get("players")
        ctx.setdefault("event_location", ev.get("location"))
        ctx["pass_length"] = mc._pass_length(ev)
        ctx["shot_distance"] = mc._shot_distance(ev)
        ctx["shot_off_target_margin"] = mc._shot_off_target_margin(ev)
        ctx["shot_placement_quality"] = mc._shot_placement_quality(ev)
        ctx["shot_end_location"] = ev.get("end_location")
        ctx.setdefault("shot_type", ev.get("shot_type"))
        ctx["defenders_bypassed"] = mc._defenders_bypassed(fr.get("players", []), ev)
        if ev.get("type") == "Carry":
            ctx["carry_distance"] = mc._pass_length(ev)
        if mc._forward(ev) is not None:
            ctx["forward_progress"] = mc._forward(ev)
    except Exception as exc:
        print(f"[enrich] could not attach truth geometry: {exc}")


@app.post("/explain")
def explain(req: ExplainRequest):
    _attach_truth_geometry(req.frame)
    return granite_client.get_explanation(req.frame)


@app.post("/explain/stream")
def explain_stream(req: ExplainRequest):
    """Streams the explanation as it is generated. Ollama tokens are streamed
    live; cloud backends and the fallback are word-chunked so the UI still
    types them out. Backend identity travels in the X-Granite-* headers."""
    _attach_truth_geometry(req.frame)
    meta, chunks = granite_client.open_stream(req.frame)
    return StreamingResponse(
        chunks,
        media_type="text/plain; charset=utf-8",
        headers={
            "X-Granite-Source": meta["source"],
            "X-Granite-Via": meta.get("via", ""),
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/whatif")
def whatif(req: ExplainRequest):
    """What-If: value every option the player had with the real xT surface, then
    have Granite judge the choice. Returns {origin, options, summary, verdict}.

    Primary path is genuinely agentic: the option values are fetched through the
    IBM Context Forge MCP gateway and the verdict runs as a LangChain (LCEL)
    chain over Granite (see whatif_chain). If the gateway/MCP is down it falls
    back to the in-process engine so the feature never breaks.
    The frame payload carries match_id/event_id so the verdict caches per moment."""
    import asyncio
    frame = req.frame
    ctx = frame.get("context") or {}
    ev = frame.get("event") or {}
    verdict_ctx = {
        "match_id": frame.get("match_id"),
        "event_id": frame.get("event_id"),
        "player_name": ev.get("player"),
        "team": ev.get("team"),
        "action_type": ev.get("type"),
        "zone": ctx.get("zone"),
        "pressure": ctx.get("pressure"),
        "nearest_defender_dist": ctx.get("nearest_defender_dist"),
        "outcome": ctx.get("outcome"),
        "lang": frame.get("lang"),   # analyst language for the localized verdict
    }
    # 1) Context Forge + LangChain + Granite (the real-AI path)
    try:
        return asyncio.run(whatif_chain.run_whatif(frame, verdict_ctx))
    except Exception as exc:
        print(f"[whatif] Context Forge path unavailable, using in-process engine: {exc}")
    # 2) in-process fallback
    analysis = whatif_engine.enumerate_options(frame)
    verdict = granite_client.whatif_verdict(verdict_ctx, analysis)
    return {**analysis, "verdict": verdict}


@app.post("/assess")
def assess(req: ExplainRequest):
    """Granite-computed assessment of a moment: stakes, decision score and the
    DNA axes, reasoned from the real tracking numbers instead of hand-weighted
    formulas. Returns {source:'granite', via, stakes, decision, dna} on success,
    or {source:'local'} so the UI falls back to its deterministic engine."""
    ctx = dict(req.frame)
    # attach the raw freeze-frame coordinates from the backend's own enriched frame
    # (never trust client-sent geometry) so Granite gets the Field Map and the
    # Truth Anchor can veto against the real lane geometry
    _attach_truth_geometry(ctx)
    return granite_client.assess_moment(ctx)

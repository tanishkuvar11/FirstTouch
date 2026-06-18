"""Precompute (bake) the Granite assessment + Victor's prose for moments, so a
deployed FirstTouch serves REAL Granite output instantly to every visitor with no
live model needed at request time.

Run once on any machine that can reach a Granite backend (local Ollama, or
HF_TOKEN / watsonx creds for cloud Granite). It writes to the on-disk cache
(backend/.firsttouch_cache/assess_cache.json + explain_cache.json), which can be
shipped with the backend so the deployed app replays it.

It is RESUMABLE: a moment already in the cache is skipped, so a run can be stopped
and re-run, or topped up after adding matches. Each moment costs two Granite calls
(scores + prose), so a full run is long on a local 8B; use the flags to scope it.

Usage (from backend/):
  python precompute_cache.py                 # everything (long!)
  python precompute_cache.py --matches 3     # first 3 matches only
  python precompute_cache.py --per-match 40  # at most 40 moments per match
  python precompute_cache.py --match-id 3869685   # one specific match
"""

import argparse
import time

import data_layer
import granite_client
import moment_context
import whatif_chain


def _consume(chunks):
    for _ in chunks:
        pass


def _whatif_ctx(mid, ev, frame):
    """Mirror the verdict context main.py builds for /whatif, so the baked cache
    key (match_id + event_id) and prompt fields match the live request exactly."""
    fctx = frame.get("context") or {}
    fev = frame.get("event") or {}
    return {
        "match_id": mid,
        "event_id": ev["id"],
        "player_name": fev.get("player"),
        "team": fev.get("team"),
        "action_type": fev.get("type"),
        "zone": fctx.get("zone"),
        "pressure": fctx.get("pressure"),
        "nearest_defender_dist": fctx.get("nearest_defender_dist"),
        "outcome": fctx.get("outcome"),
    }


def precompute(match_limit=None, per_match=None, only_match=None):
    matches = data_layer.list_matches()
    if only_match:
        matches = [m for m in matches if m["match_id"] == only_match]
    elif match_limit:
        matches = matches[:match_limit]

    if not granite_client.active_backend().startswith("granite"):
        print("WARNING: no live Granite backend reachable (watsonx / HF / Ollama).")
        print("         The cache would be filled with LOCAL estimates, not Granite.")
        print("         Start Ollama, or set HF_TOKEN / watsonx creds, then re-run.")
        return

    total_done = total_skipped = total_failed = 0
    # Moments baked via the FALLBACK rather than the real path, so we can fail loudly
    # at the end instead of silently shipping a half-real cache.
    assess_local = []     # assessment came from local estimates, not Granite
    whatif_fallback = []  # What-If came from the in-process engine, not Context Forge
    t0 = time.time()
    for match in matches:
        mid = match["match_id"]
        label = f'{match["home_team"]} v {match["away_team"]} ({match.get("stage")})'
        try:
            events = data_layer.list_events(mid)
        except Exception as exc:
            print(f"[skip match {mid}] {label}: {exc}")
            continue
        print(f"\n=== {label} [{mid}] : {len(events)} on-ball events ===")

        n = 0
        for ev in events:
            if per_match and n >= per_match:
                break
            try:
                frame = data_layer.enrich_frame(mid, ev["id"])
            except KeyError:
                continue          # no freeze frame -> not assessable in the app either
            except Exception as exc:
                print(f"  [frame fail] {ev.get('player')} {ev.get('minute')}': {exc}")
                total_failed += 1
                continue

            ctx = moment_context.assemble_context(match, ev, frame, events)

            a_key = granite_client._assess_key(ctx)
            e_key = granite_client._explain_key(ctx)
            w_ctx = _whatif_ctx(mid, ev, frame)
            w_key = granite_client._whatif_key(w_ctx)
            already = (a_key in granite_client._ASSESS_CACHE
                       and e_key in granite_client._EXPLAIN_CACHE
                       and w_key in whatif_chain._FULL_CACHE)
            if already:
                total_skipped += 1
                n += 1
                continue

            t = time.time()
            assessment = granite_client.assess_moment(ctx)
            # feed Granite's own verdict into the prose so Victor narrates the
            # real assessment (these are narration hints, not cache-key fields)
            ctx_prose = dict(ctx)
            if assessment.get("source") == "granite":
                dec = assessment["decision"]
                ctx_prose.update(decision_score=dec["score"], decision_label=dec["label"],
                                 decision_pros=dec["pros"], decision_cons=dec["cons"])
            _meta, chunks = granite_client.open_stream(ctx_prose)
            _consume(chunks)

            # What-If: value every option (real xT) and bake Granite's verdict into
            # the FULL cache so a gateway-less deploy serves it instantly.
            w_frame = dict(frame, match_id=mid, event_id=ev["id"])
            _wres, w_how = None, None
            try:
                _wres, w_how = whatif_chain.precompute_whatif(w_frame, w_ctx)
            except Exception as exc:
                w_how = f"FAIL ({exc})"
            dt = time.time() - t

            moment = f"{label}: {ev.get('player')} {ev.get('minute')}' {ev.get('type')}"
            src = assessment.get("source")
            tag = "OK " if src == "granite" else "LOCAL"
            if src != "granite":
                assess_local.append(moment)
            # ground truth from the baked payload: the gateway path stamps
            # served_by='contextforge+langchain'; the fallback stamps 'in-process'.
            served_by = (_wres or {}).get("served_by", "")
            if "contextforge" not in served_by:
                whatif_fallback.append(f"{moment} [{served_by or w_how}]")
            print(f"  [{tag}] {ev.get('player')} {ev.get('minute')}' {ev.get('type')} "
                  f"-> AQ {assessment.get('decision', {}).get('score', '?')} | what-if: {w_how} ({dt:.0f}s)")
            total_done += 1
            n += 1

    mins = (time.time() - t0) / 60
    print(f"\nDone in {mins:.1f} min. computed={total_done} skipped(cached)={total_skipped} "
          f"failed={total_failed}")
    print(f"Cache: {len(granite_client._ASSESS_CACHE)} assessments, "
          f"{len(granite_client._EXPLAIN_CACHE)} prose, "
          f"{len(whatif_chain._FULL_CACHE)} what-if. Ship backend/.firsttouch_cache/ with deploy.")

    # guard: refuse to bless a half-real cache
    # Anything baked via the fallback (local estimates / in-process engine) is NOT
    # the real Granite + Context Forge output, so the run exits non-zero and names
    # the offenders. Fix the cause (start Ollama / the gateway terminals) and re-run.
    # Note: this validates moments computed in THIS run; for a full guarantee delete
    # backend/.firsttouch_cache/ first so nothing is skipped.
    if assess_local or whatif_fallback:
        print("\n*** WARNING: the cache is NOT fully real - do NOT ship it ***")
        if assess_local:
            print(f"  {len(assess_local)} assessment(s) used LOCAL estimates, not Granite "
                  f"(is Ollama up?). First few:")
            for m in assess_local[:5]:
                print(f"    - {m}")
        if whatif_fallback:
            print(f"  {len(whatif_fallback)} What-If(s) used the IN-PROCESS fallback, not "
                  f"Context Forge (are the gateway terminals up?). First few:")
            for m in whatif_fallback[:5]:
                print(f"    - {m}")
        print("  Fix the cause and re-run. (skipped moments above were not re-checked.)")
        raise SystemExit(1)

    if total_done:
        print("\nAll baked moments are real Granite + Context Forge output. Safe to ship.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Bake Granite assessments + prose into the disk cache.")
    ap.add_argument("--matches", type=int, default=None, help="only the first N matches")
    ap.add_argument("--per-match", type=int, default=None, help="at most N moments per match")
    ap.add_argument("--match-id", type=int, default=None, help="only this match_id")
    args = ap.parse_args()
    precompute(match_limit=args.matches, per_match=args.per_match, only_match=args.match_id)

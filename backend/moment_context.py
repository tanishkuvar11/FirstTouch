"""Assemble a moment's full context on the BACKEND, identically for the live app
and the offline precompute, so a moment scored once (by any engine) is keyed and
served consistently everywhere.

This mirrors what the frontend assembles for /assess and /explain: the enriched
freeze-frame facts plus the derived running score, game state, goal effect,
forward progress, defenders bypassed, and a stakes read (a faithful port of
frontend/src/stakes.js, kept here so the deployed prose matches the panel)."""

import data_layer

# stakes (port of frontend/src/stakes.js)

_STAGE = {
    "Group Stage":     {"w": 0.55, "label": "group stage",          "knockout": False},
    "Round of 16":     {"w": 0.74, "label": "round of 16",          "knockout": True},
    "Quarter-finals":  {"w": 0.84, "label": "quarter-final",        "knockout": True},
    "Semi-finals":     {"w": 0.93, "label": "semi-final",           "knockout": True},
    "3rd Place Final": {"w": 0.60, "label": "third-place play-off", "knockout": True},
    "Final":           {"w": 1.00, "label": "final",                "knockout": True},
}


def _clamp01(v):
    return max(0.0, min(1.0, v))


def _occasion(st, minute, period, margin, knockout_or_late, drivers):
    if period == 5:
        time_mult = 1.1; drivers.append("Penalty shootout")
    elif period in (3, 4):
        time_mult = 1.08; drivers.append("Extra time")
    elif minute >= 80:
        time_mult = 1.05; drivers.append(f"Late on ({minute + 1}')")
    elif minute >= 70:
        time_mult = 1.0
    elif minute >= 60:
        time_mult = 0.92
    elif period == 2:
        time_mult = 0.85
    elif minute >= 23:
        time_mult = 0.78
    else:
        time_mult = 0.72

    if knockout_or_late:
        if margin == 0:
            state_mult = 1.06; drivers.append("Scores level")
        elif margin == -1:
            state_mult = 1.1; drivers.append("Trailing by one")
        elif margin <= -2:
            state_mult = 0.95; drivers.append(f"Trailing by {-margin}")
        elif margin == 1:
            state_mult = 1.02; drivers.append("Protecting a one-goal lead")
        elif margin >= 3:
            state_mult = 0.65; drivers.append("Game already decided")
        else:
            state_mult = 0.85
    elif abs(margin) <= 1:
        state_mult = 0.98
    elif abs(margin) >= 3:
        state_mult = 0.7; drivers.append("Game already decided")
    else:
        state_mult = 0.88

    return _clamp01(st["w"] * time_mult * state_mult)


def _swing(ev, is_penalty, forward):
    t = ev.get("type")
    xg = ev.get("xg")
    if is_penalty:
        return 0.45
    if t == "Shot":
        q = xg if isinstance(xg, (int, float)) else 0.1
        return max(0.38, min(0.5, 0.38 + q * 0.3))
    if ev.get("goal_assist"):
        return 0.45
    if ev.get("shot_assist"):
        return 0.35
    if t == "Dribble":
        loc = ev.get("location")
        return 0.3 if (isinstance(loc, list) and loc[0] > 80) else 0.22
    if t in ("Interception", "Block", "Clearance", "Goal Keeper"):
        loc = ev.get("location")
        return 0.42 if (isinstance(loc, list) and loc[0] < 40) else 0.3
    if t in ("Foul Committed", "Bad Behaviour"):
        return 0.3
    if t in ("Pass", "Carry"):
        if isinstance(forward, (int, float)):
            if forward > 20:
                return 0.3
            if forward > 8:
                return 0.24
            if forward < -3:
                return 0.1
        return 0.16
    return 0.2


def compute_stakes(match, ev, home_goals, away_goals, forward):
    stage = match.get("stage")
    st = _STAGE.get(stage, {"w": 0.6, "label": stage or "match", "knockout": False})
    drivers = ["Knockout " + st["label"] if st["knockout"] else "Group stage"]

    home = ev.get("team") == match["home_team"]
    me = home_goals if home else away_goals
    them = away_goals if home else home_goals
    margin = me - them
    state = (f"{ev.get('team')} lead {me}-{them}" if margin > 0
             else f"{ev.get('team')} trail {me}-{them}" if margin < 0
             else f"level at {me}-{them}")

    minute = ev.get("minute") or 0
    period = ev.get("period") or 1
    knockout_or_late = st["knockout"] or minute >= 70 or period >= 3
    occasion = _occasion(st, minute, period, margin, knockout_or_late, drivers)

    is_penalty = ev.get("shot_type") == "Penalty"
    swing = _swing(ev, is_penalty, forward)
    score = _clamp01(swing + 0.5 * occasion)

    if ev.get("type") == "Shot" or is_penalty:
        drivers.insert(0, "Goal" if ev.get("outcome") == "Goal" else "Goalscoring chance")
    elif ev.get("goal_assist"):
        drivers.insert(0, "Goal assist")
    elif swing <= 0.18:
        drivers.append("Low-danger phase")

    level = ("Decisive" if score >= 0.80 else "High" if score >= 0.60
             else "Medium" if score >= 0.40 else "Low")
    return {"score": score, "level": level, "drivers": drivers, "state": state}


# derived facts

def _prescore(match, events, ev):
    """Goals scored strictly before this event (shootout excluded), as the player
    faced it. Mirrors the frontend's preScore."""
    cutoff = ev.get("index", 0)
    h = a = 0
    for e in events:
        if (e.get("index") or 0) >= cutoff:
            break
        if e.get("type") == "Shot" and e.get("outcome") == "Goal" and (e.get("period") or 1) < 5:
            if e.get("team") == match["home_team"]:
                h += 1
            elif e.get("team") == match["away_team"]:
                a += 1
    return h, a


def _forward(ev):
    loc, end = ev.get("location"), ev.get("end_location")
    if isinstance(loc, list) and isinstance(end, list):
        return end[0] - loc[0]
    return None


def _pass_length(ev):
    """Straight-line distance the pass travelled (StatsBomb units), for the
    geometric difficulty model. None if the end point is unknown."""
    loc, end = ev.get("location"), ev.get("end_location")
    if isinstance(loc, list) and isinstance(end, list) and len(loc) >= 2 and len(end) >= 2:
        return round(((end[0] - loc[0]) ** 2 + (end[1] - loc[1]) ** 2) ** 0.5, 1)
    return None


def _shot_distance(ev):
    """Distance from the shot's origin to the centre of the goal (120, 40)."""
    loc = ev.get("location")
    if isinstance(loc, list) and len(loc) >= 2:
        return round(((120.0 - loc[0]) ** 2 + (40.0 - loc[1]) ** 2) ** 0.5, 1)
    return None


def _shot_off_target_margin(ev):
    """For a shot, how far (StatsBomb units) the ball ended OUTSIDE the goal frame:
    0.0 = on target (between the posts and under the bar), a small value = a near
    miss that just shaved the woodwork, None for non-shots / unknown end. Lets a
    well-struck shot that almost went in read as good execution even when it is
    logged 'Off T'. Goal mouth: posts at y 36..44, crossbar at z 2.67."""
    if ev.get("type") != "Shot":
        return None
    end = ev.get("end_location")
    if not (isinstance(end, list) and len(end) >= 2):
        return None
    ey = end[1]
    ez = end[2] if len(end) >= 3 else 0.0
    dy = max(0.0, 36.0 - ey, ey - 44.0)
    dz = max(0.0, (ez or 0.0) - 2.67)
    return round((dy * dy + dz * dz) ** 0.5, 2)


def _shot_placement_quality(ev):
    """For an ON-TARGET shot, how well it was placed inside the goal: 0.0 = straight
    at the centre of the goal at the keeper's body (a comfortable save), 1.0 = tucked
    right into a corner (hardest to reach). None for non-shots, off-target shots or
    unknown end. Lets a corner-bound shot that is saved read as a fine strike denied
    by the keeper, while a tame effort hit down the middle reads as poor placement.
    Goal mouth: posts at y 36..44, crossbar at z 2.67; easiest spot for a keeper is
    the centre near the ground/body (y 40, z 0)."""
    if ev.get("type") != "Shot":
        return None
    end = ev.get("end_location")
    if not (isinstance(end, list) and len(end) >= 2):
        return None
    ey = end[1]
    ez = end[2] if len(end) >= 3 else 0.0
    if not (36.0 <= ey <= 44.0 and 0.0 <= (ez or 0.0) <= 2.67):
        return None   # off target: placement quality is not meaningful
    horiz = abs(ey - 40.0) / 4.0           # 0 centre .. 1 by a post
    vert = (ez or 0.0) / 2.67              # 0 along the ground .. 1 under the bar
    q = (horiz * horiz + vert * vert) ** 0.5 / (2 ** 0.5)
    return round(min(1.0, q), 2)


def _defenders_bypassed(players, ev):
    loc, end = ev.get("location"), ev.get("end_location")
    if not (isinstance(loc, list) and isinstance(end, list)):
        return 0
    sx, ex = loc[0], end[0]
    if ex <= sx + 1:
        return 0
    return sum(1 for p in players
               if not p.get("teammate") and isinstance(p.get("location"), list)
               and sx + 0.5 < p["location"][0] < ex)


def _goal_effect(match, ev, h, a):
    if ev.get("outcome") != "Goal" or (ev.get("period") or 1) == 5:
        return None
    home = ev.get("team") == match["home_team"]
    me, them = (h, a) if home else (a, h)
    margin = me - them
    final = f"{h + (1 if home else 0)}-{a + (0 if home else 1)}"
    if margin == 0:
        return f"put {ev['team']} ahead {final}"
    if margin > 0:
        return f"extended {ev['team']}'s lead to {final}"
    if me + 1 == them:
        return f"levelled the match at {final}"
    return f"pulled one back to make it {final}, still behind"


def assemble_context(match: dict, ev: dict, frame: dict, events: list) -> dict:
    """Full context dict for granite_client.assess_moment / open_stream, with the
    match+event ids so the cache keys by moment."""
    ctx = frame.get("context", {})
    h, a = _prescore(match, events, ev)
    forward = _forward(ev)
    stakes = compute_stakes(match, ev, h, a, forward)
    return {
        "match_id": match["match_id"],
        "event_id": ev["id"],
        "player_name": ev.get("player"),
        "team": ev.get("team"),
        "stage": match.get("stage"),
        "minute": (ev.get("minute") or 0) + 1,
        "action_type": ev.get("type"),
        "shot_type": ev.get("shot_type"),
        "is_penalty": ev.get("shot_type") == "Penalty",
        "is_shootout": ev.get("period") == 5,
        # the first touch of a half or the restart after a goal: by the Laws it MUST
        # be a pass, so there is no "should have carried/driven" alternative and the
        # choice is not really the player's to make. Handled specially downstream.
        "is_kickoff": ev.get("set_piece") == "Kick Off",
        "zone": ctx.get("zone"),
        "pressure": ctx.get("pressure"),
        "nearest_defender_dist": ctx.get("nearest_defender_dist"),
        "open_teammate_count": ctx.get("open_teammate_count"),
        "teammate_count": ctx.get("teammate_count"),
        "opponent_count": ctx.get("opponent_count"),
        "outcome": ctx.get("outcome"),
        "xg": ctx.get("xg"),
        "scoreline": f"{match['home_team']} {h}-{a} {match['away_team']}",
        "goal_effect": _goal_effect(match, ev, h, a),
        "game_state": stakes["state"],
        "forward_progress": forward,
        "pass_length": _pass_length(ev),
        # how far the ball was carried (None for non-carries); feeds the geometric
        # difficulty so a long driving run is not scored like a 5m touch.
        "carry_distance": _pass_length(ev) if ev.get("type") == "Carry" else None,
        "shot_distance": _shot_distance(ev),
        # how far a shot ended outside the goal frame (0 = on target); lets a
        # near-miss read as well struck even when logged 'Off T'.
        "shot_off_target_margin": _shot_off_target_margin(ev),
        # how well an on-target shot was placed (0 centre .. 1 corner); separates a
        # corner-bound shot well saved from a tame one hit at the keeper.
        "shot_placement_quality": _shot_placement_quality(ev),
        "goal_assist": ev.get("goal_assist"),
        "shot_assist": ev.get("shot_assist"),
        "defenders_bypassed": _defenders_bypassed(frame.get("players", []), ev),
        "pass_technique": ev.get("pass_technique"),
        "stakes_level": stakes["level"],
        "stakes_drivers": stakes["drivers"],
        # raw spatial data for the AI Field Map + Truth Anchor (assess pipeline)
        "players": frame.get("players"),
        "event_location": ev.get("location"),
    }

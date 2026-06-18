import json
import math
import os
from functools import lru_cache
from pathlib import Path

import pandas as pd
from statsbombpy import sb

COMPETITION_ID = 43   # FIFA World Cup
SEASON_ID = 106       # 2022

CACHE_DIR = Path(__file__).resolve().parent / ".firsttouch_cache"
CACHE_DIR.mkdir(exist_ok=True)

# Event types surfaced in the UI. Pressure is intentionally excluded: it is an
# off-ball defensive action, not a decision moment, and clutters the feed.
ON_BALL_TYPES = {
    "Pass", "Shot", "Dribble", "Carry", "Interception",
    "Clearance", "Block", "Bad Behaviour",
}
# Interception outcomes that mean the player stepped in but LOST the ball — shown
# as a "Lost Duel" and filtered out of the feed (a negative, non-decision moment).
_LOST_INTERCEPTION = {"Lost", "Lost In Play", "Lost Out"}

# Fixes for truncated/odd StatsBomb nicknames.
NAME_OVERRIDES = {
    "Randal Kolo": "Randal Kolo Muani",
}

# StatsBomb position ids are already canonically ordered GK -> DEF -> MID -> FWD
# (1 = Goalkeeper ... 25 = Secondary Striker). Used for tactics-based inference.


# Raw StatsBomb access (memoised)

@lru_cache(maxsize=1)
def get_matches() -> tuple:
    df = sb.matches(competition_id=COMPETITION_ID, season_id=SEASON_ID)
    df = df.sort_values(["match_date", "kick_off"])
    df = df.where(pd.notnull(df), None)
    matches = []
    for _, row in df.iterrows():
        matches.append({
            "match_id": int(row["match_id"]),
            "match_date": row["match_date"],
            "kick_off": row["kick_off"],
            "stage": row.get("competition_stage"),
            "home_team": row["home_team"],
            "away_team": row["away_team"],
            "home_score": int(row["home_score"]) if row["home_score"] is not None else None,
            "away_score": int(row["away_score"]) if row["away_score"] is not None else None,
            "stadium": row.get("stadium"),
            "referee": row.get("referee"),
            "home_manager": row.get("home_manager_name"),
            "away_manager": row.get("away_manager_name"),
        })
    return tuple(json.dumps(m) for m in matches)


def list_matches() -> list:
    return [json.loads(m) for m in get_matches()]


@lru_cache(maxsize=8)
def _events_sorted(match_id: int) -> tuple:
    """All raw events for a match, sorted by index. Cached as a JSON tuple
    so lru_cache stays hashable-safe."""
    raw = sb.events(match_id, fmt="dict")
    if isinstance(raw, dict):
        events = list(raw.values())
    else:
        events = list(raw)
    events.sort(key=lambda e: e.get("index", 0))
    return (json.dumps(events),)


def get_raw_events(match_id: int) -> list:
    return json.loads(_events_sorted(match_id)[0])


@lru_cache(maxsize=8)
def _frames_map_cached(match_id: int) -> tuple:
    """360 freeze frames keyed by event uuid, disk-cached after first fetch
    (the three-sixty file is large and slow to download)."""
    disk = CACHE_DIR / f"frames_{match_id}.json"
    if disk.exists():
        return (disk.read_text(encoding="utf-8"),)

    raw = sb.frames(match_id, fmt="dict")
    frames_map = {}
    if isinstance(raw, dict):
        # Either already {uuid: [dots]} or {uuid: {freeze_frame: [...]}}
        for uuid, val in raw.items():
            if isinstance(val, dict):
                frames_map[uuid] = {
                    "freeze_frame": val.get("freeze_frame", []),
                    "visible_area": val.get("visible_area"),
                }
            else:
                frames_map[uuid] = {"freeze_frame": val, "visible_area": None}
    else:
        for entry in raw:
            frames_map[entry["event_uuid"]] = {
                "freeze_frame": entry.get("freeze_frame", []),
                "visible_area": entry.get("visible_area"),
            }
    text = json.dumps(frames_map)
    disk.write_text(text, encoding="utf-8")
    return (text,)


def get_frames_map(match_id: int) -> dict:
    return json.loads(_frames_map_cached(match_id)[0])


def _ts_to_seconds(t):
    """'115:32' -> 6932 seconds; None/garbage -> None."""
    if not t or ":" not in str(t):
        return None
    try:
        mm, ss = str(t).split(":")[:2]
        return int(mm) * 60 + int(ss)
    except (ValueError, TypeError):
        return None


def _best_position(positions):
    """The most representative position a player held: the Starting XI role for
    starters, otherwise the position played for the longest stint. StatsBomb
    lists every position in order, so the first one can be a 2-second cameo."""
    if not isinstance(positions, list) or not positions:
        return None
    best, best_score = None, -1
    for p in positions:
        name = p.get("position")
        if not name:
            continue
        f = _ts_to_seconds(p.get("from"))
        t = _ts_to_seconds(p.get("to"))
        if p.get("to") is None:
            dur = 12000                      # played to the final whistle
        elif f is not None and t is not None and t >= f:
            dur = t - f
        else:
            dur = 0                          # garbled cross-period timestamps
        score = dur + (100000 if p.get("start_reason") == "Starting XI" else 0)
        if score > best_score:
            best_score, best = score, name
    return best


@lru_cache(maxsize=8)
def _lineups_cached(match_id: int) -> tuple:
    lineups = sb.lineups(match_id)
    out = {}
    for team_name, df in lineups.items():
        players = []
        for _, row in df.iterrows():
            position = _best_position(row.get("positions"))
            nickname = row.get("player_nickname")
            pname = nickname if isinstance(nickname, str) and nickname else row["player_name"]
            pname = NAME_OVERRIDES.get(pname, pname)
            players.append({
                "player_id": int(row["player_id"]),
                "player_name": pname,
                "full_name": row["player_name"],
                "jersey_number": int(row["jersey_number"]),
                "position": position,
            })
        players.sort(key=lambda p: p["jersey_number"])
        out[team_name] = players
    return (json.dumps(out),)


def get_lineups(match_id: int) -> dict:
    return json.loads(_lineups_cached(match_id)[0])


def _player_index(match_id: int) -> dict:
    """player_id -> {name, jersey, team} for both squads."""
    idx = {}
    for team, players in get_lineups(match_id).items():
        for p in players:
            idx[p["player_id"]] = {
                "player_name": p["player_name"],
                "jersey_number": p["jersey_number"],
                "team": team,
                "position": p["position"],
            }
    return idx


# Simplified event feed

def _event_outcome(ev: dict) -> str | None:
    t = ev.get("type", {}).get("name")
    if t == "Pass":
        out = ev.get("pass", {}).get("outcome", {}).get("name")
        return out or "Complete"
    if t == "Shot":
        return ev.get("shot", {}).get("outcome", {}).get("name")
    if t == "Dribble":
        return ev.get("dribble", {}).get("outcome", {}).get("name")
    if t == "Interception":
        return ev.get("interception", {}).get("outcome", {}).get("name")
    if t == "Goal Keeper":
        return ev.get("goalkeeper", {}).get("outcome", {}).get("name") or \
               ev.get("goalkeeper", {}).get("type", {}).get("name")
    return None


def _event_end_location(ev: dict):
    t = ev.get("type", {}).get("name")
    if t == "Pass":
        return ev.get("pass", {}).get("end_location")
    if t == "Shot":
        # keep the full 3D end (x, y, z) so the UI can show shot height; a shot
        # blazed over the bar reads as off target instead of looking on goal
        end = ev.get("shot", {}).get("end_location")
        return end if end else None
    if t == "Carry":
        return ev.get("carry", {}).get("end_location")
    return None


def _event_card(ev: dict) -> str | None:
    for key in ("bad_behaviour", "foul_committed"):
        card = ev.get(key, {}).get("card", {}).get("name")
        if card:
            return card
    return None


def simplify_event(ev: dict, frames_map: dict | None = None,
                   names: dict | None = None) -> dict:
    t = ev.get("type", {}).get("name")
    shot = ev.get("shot", {})
    pid = ev.get("player", {}).get("id")
    # Prefer the common name (StatsBomb nickname: "Lionel Messi") over the
    # full legal name ("Lionel Andrés Messi Cuccittini").
    info = (names or {}).get(pid, {})
    player_name = info.get("player_name") or ev.get("player", {}).get("name")
    return {
        "id": ev["id"],
        "index": ev.get("index"),
        "minute": ev.get("minute"),
        "second": ev.get("second"),
        "period": ev.get("period"),
        "type": t,
        "player": player_name,
        "player_id": ev.get("player", {}).get("id"),
        "jersey_number": info.get("jersey_number"),
        "position": info.get("position"),
        "team": ev.get("team", {}).get("name"),
        "possession": ev.get("possession"),
        "possession_team": ev.get("possession_team", {}).get("name"),
        "location": ev.get("location"),
        "end_location": _event_end_location(ev),
        "outcome": _event_outcome(ev),
        "under_pressure": bool(ev.get("under_pressure")),
        "xg": shot.get("statsbomb_xg"),
        "shot_type": shot.get("type", {}).get("name"),
        # set-piece origin (Penalty / Free Kick / Corner / Throw-in / Kick Off) for
        # either a shot or a pass; None for open play. Lets the UI treat penalties
        # and free kicks as standalone moments.
        "set_piece": (shot.get("type", {}).get("name") if t == "Shot"
                      else ((ev.get("pass") or {}).get("type") or {}).get("name")),
        "goal_assist": bool(ev.get("pass", {}).get("goal_assist")),
        "shot_assist": bool(ev.get("pass", {}).get("shot_assist")),
        "pass_technique": ev.get("pass", {}).get("technique", {}).get("name"),
        "card": _event_card(ev),
        "has_shot_freeze_frame": bool(shot.get("freeze_frame")),
        "has_360": bool(frames_map and ev["id"] in frames_map),
    }


def list_events(match_id: int) -> list:
    frames_map = get_frames_map(match_id)
    names = _player_index(match_id)
    out = []
    for ev in get_raw_events(match_id):
        t = ev.get("type", {}).get("name")
        if t in ON_BALL_TYPES or (t == "Foul Committed" and _event_card(ev)):
            if not ev.get("location"):
                continue
            # drop "Lost Duel" moments: a player stepped in but lost the ball. They
            # are a negative non-decision, not worth surfacing in the feed.
            if t == "Interception" and _event_outcome(ev) in _LOST_INTERCEPTION:
                continue
            out.append(simplify_event(ev, frames_map, names))
    return out


# Tactics state (live lineup at a given event index)

def _tactics_state_at(match_id: int, index: int) -> dict:
    """team_name -> list of the 11 players on the pitch at this event index,
    each {player_id, player_name, position_id, position, jersey_number}."""
    players = _player_index(match_id)
    state: dict[str, dict] = {}
    for ev in get_raw_events(match_id):
        if ev.get("index", 0) > index:
            break
        t = ev.get("type", {}).get("name")
        team = ev.get("team", {}).get("name")
        if t in ("Starting XI", "Tactical Shift"):
            lineup = ev.get("tactics", {}).get("lineup", [])
            state[team] = {}
            for p in lineup:
                pid = p["player"]["id"]
                state[team][pid] = {
                    "player_id": pid,
                    "player_name": players.get(pid, {}).get("player_name", p["player"]["name"]),
                    "position_id": p["position"]["id"],
                    "position": p["position"]["name"],
                    "jersey_number": p.get("jersey_number") or players.get(pid, {}).get("jersey_number"),
                }
        elif t == "Substitution":
            off_id = ev.get("player", {}).get("id")
            repl = ev.get("substitution", {}).get("replacement", {})
            if team in state and off_id in state[team] and repl.get("id"):
                slot = state[team].pop(off_id)
                pid = repl["id"]
                state[team][pid] = {
                    "player_id": pid,
                    "player_name": players.get(pid, {}).get("player_name", repl.get("name")),
                    "position_id": slot["position_id"],
                    "position": slot["position"],
                    "jersey_number": players.get(pid, {}).get("jersey_number"),
                }
    return {team: list(d.values()) for team, d in state.items()}


# Team sheet (formation, subs, manager) for the Line-ups view

# StatsBomb position name -> (x, y) on a 0-100 grid for the formation diagram.
# x is depth (own goal 0 -> opponent goal 100, i.e. up the pitch); y is left(0)
# to right(100). Approximate but gives a recognisable shape for any formation.
POSITION_XY = {
    "Goalkeeper": (8, 50),
    # back line, well clear of the keeper
    "Right Back": (27, 85), "Right Center Back": (26, 63), "Center Back": (25, 50),
    "Left Center Back": (26, 37), "Left Back": (27, 15),
    "Right Wing Back": (33, 88), "Left Wing Back": (33, 12),
    # holding midfield
    "Right Defensive Midfield": (44, 63), "Center Defensive Midfield": (44, 50),
    "Left Defensive Midfield": (44, 37),
    # central midfield
    "Right Midfield": (57, 85), "Right Center Midfield": (56, 63), "Center Midfield": (56, 50),
    "Left Center Midfield": (56, 37), "Left Midfield": (57, 15),
    # attacking midfield
    "Right Attacking Midfield": (68, 66), "Center Attacking Midfield": (68, 50),
    "Left Attacking Midfield": (68, 34),
    # wide forwards
    "Right Wing": (79, 83), "Left Wing": (79, 17),
    # strikers
    "Right Center Forward": (85, 60), "Striker": (88, 50), "Center Forward": (88, 50),
    "Left Center Forward": (85, 40), "Secondary Striker": (74, 50),
}


def _expected_xy(position_name: str, attacking_plus_x: bool) -> tuple:
    """Expected freeze-frame location (StatsBomb 120x80) for a formation position,
    in the actor-attacks-+x frame. POSITION_XY is on a 0-100 grid with x = depth
    (own goal -> opponent goal) and y = left(0) -> right(100); StatsBomb attacking
    +x puts a team's right side at high y, so the mapping is direct. The OPPONENT
    attacks the other way, so their whole shape is point-reflected — both depth and
    left/right mirror — which is what keeps an opponent's right-back on the side of
    the frame it actually occupies instead of borrowing the actor-side label."""
    px, py = POSITION_XY.get(position_name, (50, 50))
    x, y = px / 100.0 * 120.0, py / 100.0 * 80.0
    if not attacking_plus_x:
        x, y = 120.0 - x, 80.0 - y
    return (x, y)


def _fmt_formation(f) -> str | None:
    """433 -> '4-3-3', 4231 -> '4-2-3-1'."""
    if f is None:
        return None
    return "-".join(str(int(f)))


def _formation_coords(formation, lineup) -> dict:
    """Clean, evenly-spaced diagram coordinates derived from the FORMATION, the way
    broadcast/Google graphics do it: one horizontal band per line (GK, then each
    formation number), spaced evenly up the pitch, with the players in each line
    spread evenly across the width. Returns player_id -> (x depth, y width)."""
    digits = [int(c) for c in str(int(formation))] if formation else []
    if not digits or not lineup:
        return {p["player"]["id"]: POSITION_XY.get(p["position"]["name"], (50, 50)) for p in lineup}
    # StatsBomb lists the lineup goalkeeper-first then by line, so walk it in order:
    # the first player is the keeper, then consume each formation number as a line.
    rows = [[lineup[0]]]
    idx = 1
    for n in digits:
        rows.append(lineup[idx:idx + n])
        idx += n
    if idx < len(lineup):                       # any mismatch: tack the rest on top
        rows.append(lineup[idx:])
    R = len(rows)
    coords = {}
    for r, row in enumerate(rows):
        x = 8 + (90 - 8) * (r / (R - 1)) if R > 1 else 50      # GK low, attack high
        # keep left-to-right order using the position's lateral hint
        row.sort(key=lambda p: POSITION_XY.get(p["position"]["name"], (0, 50))[1])
        n = len(row)
        for i, p in enumerate(row):
            y = (i + 1) / (n + 1) * 100                        # even across the width
            coords[p["player"]["id"]] = (round(x, 1), round(y, 1))
    return coords


def _goal_assist_tallies(raw_events: list) -> tuple:
    """{player_id: goals}, {player_id: assists} over normal time + extra time
    (the shootout, period 5, is excluded so it matches the on-field scoreline)."""
    goals, assists = {}, {}
    for ev in raw_events:
        if ev.get("period") == 5:
            continue
        t = ev.get("type", {}).get("name")
        pid = (ev.get("player") or {}).get("id")
        if not pid:
            continue
        if t == "Shot" and ev.get("shot", {}).get("outcome", {}).get("name") == "Goal":
            goals[pid] = goals.get(pid, 0) + 1
        elif t == "Pass" and ev.get("pass", {}).get("goal_assist"):
            assists[pid] = assists.get(pid, 0) + 1
    return goals, assists


def team_sheet(match_id: int) -> dict:
    """Per-team starting formation, substitutions and managers for the Line-ups
    view. Each starter carries its formation-diagram (x,y) and goal/assist tally;
    each sub records who came off, who came on (inheriting the slot), and when."""
    players = _player_index(match_id)
    raw = get_raw_events(match_id)
    goals, assists = _goal_assist_tallies(raw)
    match = next((m for m in list_matches() if m["match_id"] == match_id), {})
    managers = {match.get("home_team"): match.get("home_manager"),
                match.get("away_team"): match.get("away_manager")}
    home_t, away_t = match.get("home_team"), match.get("away_team")
    # full-time/extra-time score plus the shootout, so the prose can be grounded in
    # the REAL result (the WC2022 final was 3-3, Argentina won 4-2 on penalties).
    so_home = so_away = 0
    for ev in raw:
        if ev.get("period") == 5 and ev.get("type", {}).get("name") == "Shot" \
                and ev.get("shot", {}).get("outcome", {}).get("name") == "Goal":
            if ev.get("team", {}).get("name") == home_t:
                so_home += 1
            else:
                so_away += 1
    result = {"home_score": match.get("home_score"), "away_score": match.get("away_score"),
              "shootout": {"home": so_home, "away": so_away} if (so_home or so_away) else None}

    teams: dict[str, dict] = {}
    for ev in raw:
        t = ev.get("type", {}).get("name")
        team = ev.get("team", {}).get("name")
        if t == "Starting XI":
            tac = ev.get("tactics", {})
            coords = _formation_coords(tac.get("formation"), tac.get("lineup", []))
            starting = []
            for p in tac.get("lineup", []):
                pid = p["player"]["id"]
                pos = p["position"]["name"]
                x, y = coords.get(pid, (50, 50))
                info = players.get(pid, {})
                starting.append({
                    "player_id": pid,
                    "name": info.get("player_name") or p["player"]["name"],
                    "jersey": p.get("jersey_number") or info.get("jersey_number"),
                    "position": pos, "x": x, "y": y,
                    "goals": goals.get(pid, 0), "assists": assists.get(pid, 0),
                })
            teams[team] = {
                "formation": _fmt_formation(tac.get("formation")),
                "manager": managers.get(team),
                "starting": starting,
                "subs": [],
            }
        elif t == "Substitution" and team in teams:
            off_id = (ev.get("player") or {}).get("id")
            repl = ev.get("substitution", {}).get("replacement", {})
            on_id = repl.get("id")
            if not on_id:
                continue
            # the slot the incoming player inherits: the outgoing player's spot,
            # whether he started or was himself an earlier substitute
            slot = next((s for s in teams[team]["starting"] if s["player_id"] == off_id), None)
            if slot is None:
                slot = next((s["on"] for s in teams[team]["subs"]
                             if s["on"]["player_id"] == off_id), None)
            x, y = (slot["x"], slot["y"]) if slot else (50, 50)
            pos = slot["position"] if slot else None
            on_info = players.get(on_id, {})
            teams[team]["subs"].append({
                "minute": ev.get("minute"),
                "off": {
                    "player_id": off_id,
                    "name": players.get(off_id, {}).get("player_name") or (ev.get("player") or {}).get("name"),
                    "jersey": players.get(off_id, {}).get("jersey_number"),
                },
                "on": {
                    "player_id": on_id,
                    "name": on_info.get("player_name") or repl.get("name"),
                    "jersey": on_info.get("jersey_number"),
                    "position": pos, "x": x, "y": y,
                    "goals": goals.get(on_id, 0), "assists": assists.get(on_id, 0),
                },
            })
    return {
        "home_team": home_t,
        "away_team": away_t,
        "result": result,
        "teams": teams,
    }


# Freeze-frame identity enrichment

def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _point_to_segment(p, a, b) -> float:
    """Distance from point p to segment a->b."""
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _assist_dots(ev: dict, shot_ev: dict, players_idx: dict) -> list:
    """Reconstruct an assist from the freeze frame of the shot it created: the
    passer (actor) at the pass origin, the receiver at the shot spot, and every
    other player from the shot's freeze frame, all with exact identity."""
    def mk(loc, teammate, actor, keeper, pid, fallback_name=None, pos=None):
        info = players_idx.get(pid, {})
        return {
            "location": loc[:2],
            "teammate": teammate,
            "actor": actor,
            "keeper": keeper,
            "player_id": pid,
            "player_name": info.get("player_name") or fallback_name,
            "position": info.get("position") or pos,
            "jersey_number": info.get("jersey_number"),
            "identity_confidence": "exact",
        }

    dots = []
    apid = ev.get("player", {}).get("id")
    if ev.get("location"):
        dots.append(mk(ev["location"], True, True, False, apid,
                       ev.get("player", {}).get("name"),
                       (ev.get("position") or {}).get("name")))
    spid = shot_ev.get("player", {}).get("id")
    if shot_ev.get("location") and spid != apid:
        dots.append(mk(shot_ev["location"], True, False, False, spid,
                       shot_ev.get("player", {}).get("name"),
                       (shot_ev.get("position") or {}).get("name")))
    for e in (shot_ev.get("shot", {}).get("freeze_frame") or []):
        pid = e.get("player", {}).get("id")
        if pid in (apid, spid):
            continue
        pos = (e.get("position") or {}).get("name")
        dots.append(mk(e["location"], bool(e.get("teammate")), False,
                       pos == "Goalkeeper", pid,
                       e.get("player", {}).get("name"), pos))
    return dots


def enrich_frame(match_id: int, event_id: str) -> dict:
    raw_events = get_raw_events(match_id)
    ev = next((e for e in raw_events if e["id"] == event_id), None)
    if ev is None:
        raise KeyError(f"event {event_id} not found in match {match_id}")

    frames_map = get_frames_map(match_id)
    frame = frames_map.get(event_id)
    if not frame or not frame.get("freeze_frame"):
        # No 360 frame. Reconstruct from the shot's own freeze frame (full
        # identity); the shooter isn't in it, so add the actor explicitly.
        # Penalties may have no freeze frame at all (e.g. some shootout kicks),
        # so synthesize a minimal shooter-vs-keeper scene for those.
        sff = ev.get("shot", {}).get("freeze_frame") or []
        is_pen = (ev.get("shot", {}).get("type") or {}).get("name") == "Penalty"
        pass_obj = ev.get("pass", {})
        is_assist = bool(pass_obj.get("goal_assist") or pass_obj.get("shot_assist"))

        # An assist has no frame of its own, but the shot it created does. Borrow
        # that freeze frame so the assist shows the real box, not a lone passer.
        if is_assist:
            shot_ev = next((e for e in raw_events
                            if (e.get("shot") or {}).get("key_pass_id") == event_id), None)
            if shot_ev and (shot_ev.get("shot", {}).get("freeze_frame")):
                players_idx = _player_index(match_id)
                dots = _assist_dots(ev, shot_ev, players_idx)
                actor_team = ev.get("team", {}).get("name")
                opponent_team = next((t for t in get_lineups(match_id).keys()
                                      if t != actor_team), None)
                return {
                    "event": simplify_event(ev, frames_map, players_idx),
                    "players": dots,
                    "visible_area": None,
                    "context": _decision_context(ev, dots),
                    "teams": {"actor_team": actor_team, "opponent_team": opponent_team},
                }

        if not sff and not is_pen and not is_assist:
            raise KeyError(f"no freeze frame for event {event_id}")
        loc = ev.get("location") or ([108, 40] if is_pen else None)
        synth = []
        if loc:
            synth.append({"location": loc, "teammate": True, "actor": True, "keeper": False})
        if sff:
            for e in sff:
                pos = (e.get("position") or {}).get("name")
                synth.append({"location": e["location"],
                              "teammate": bool(e.get("teammate")),
                              "actor": False, "keeper": pos == "Goalkeeper"})
        elif is_pen:
            synth.append({"location": [120, 40], "teammate": False,
                          "actor": False, "keeper": True})
        # an assist with no frame shows just the passer; the pass arrow conveys
        # the rest of the action
        frame = {"freeze_frame": synth, "visible_area": None}

    actor_team = ev.get("team", {}).get("name")
    all_teams = list(get_lineups(match_id).keys())
    opponent_team = next((t for t in all_teams if t != actor_team), None)

    players_idx = _player_index(match_id)
    tactics = _tactics_state_at(match_id, ev.get("index", 0))

    dots = []
    for d in frame["freeze_frame"]:
        dots.append({
            "location": d["location"][:2],
            "teammate": bool(d.get("teammate")),
            "actor": bool(d.get("actor")),
            "keeper": bool(d.get("keeper")),
            "player_id": None,
            "player_name": None,
            "position": None,
            "jersey_number": None,
            "identity_confidence": "unknown",
        })

    assigned_ids: set[int] = set()

    def assign(dot, pid, confidence, position=None, name=None):
        info = players_idx.get(pid, {})
        dot["player_id"] = pid
        # lineup index carries the common name; fall back to the raw one
        dot["player_name"] = info.get("player_name") or name
        dot["jersey_number"] = info.get("jersey_number")
        dot["position"] = position or info.get("position")
        dot["identity_confidence"] = confidence
        if pid is not None:
            assigned_ids.add(pid)

    # 1) Actor — exact from the event itself
    actor_pid = ev.get("player", {}).get("id")
    actor_dot = next((d for d in dots if d["actor"]), None)
    if actor_dot is None and ev.get("location"):
        # 360 frames occasionally miss the actor flag; fall back to nearest
        # teammate dot to the event location.
        candidates = [d for d in dots if d["teammate"]]
        if candidates:
            actor_dot = min(candidates, key=lambda d: _dist(d["location"], ev["location"]))
            actor_dot["actor"] = True
    if actor_dot is not None and actor_pid:
        assign(actor_dot, actor_pid, "exact",
               position=ev.get("position", {}).get("name"))

    # 2) Shot freeze frame — full identity, matched to 360 dots by distance
    sff = ev.get("shot", {}).get("freeze_frame") or []
    for entry in sff:
        pid = entry.get("player", {}).get("id")
        if pid is None or pid in assigned_ids:
            continue
        same_side = bool(entry.get("teammate"))
        best, best_d = None, 2.0
        for d in dots:
            if d["player_id"] is not None or d["actor"] or d["teammate"] != same_side:
                continue
            dd = _dist(d["location"], entry["location"])
            if dd < best_d:
                best, best_d = d, dd
        if best is not None:
            assign(best, pid, "exact", position=entry.get("position", {}).get("name"),
                   name=entry.get("player", {}).get("name"))

    # 3) Keepers — exact, one per side from the live tactics lineup
    for dot in dots:
        if not dot["keeper"] or dot["player_id"] is not None:
            continue
        side_team = actor_team if dot["teammate"] else opponent_team
        lineup = tactics.get(side_team, [])
        gk = next((p for p in lineup if p["position_id"] == 1 and p["player_id"] not in assigned_ids), None)
        if gk:
            assign(dot, gk["player_id"], "exact", position=gk["position"])

    # 4) IDENTITY FROM NEIGHBOURING FRAMES — the strong signal. Players who are on
    #    the ball in the events just before/after this one have a KNOWN identity and
    #    a known location. Within one possession every event shares the same
    #    (attack-toward-+x) coordinate frame, so a freeze-frame dot sitting almost
    #    exactly where a known player was a moment earlier or later IS that player,
    #    even when the positional guess (step 5) would have said someone else. This
    #    fixes e.g. a pass receiver shown as the wrong number: the very next frame
    #    (the receiver's touch / Ball Receipt) reveals who actually got the ball.
    this_idx = ev.get("index", 0)
    this_poss = ev.get("possession")
    anchors = []   # (player_id, team_name, location) from nearby same-possession events
    for e in raw_events:
        if e is ev or e.get("possession") != this_poss:
            continue
        if abs(e.get("index", 0) - this_idx) > 6:
            continue
        pid = (e.get("player") or {}).get("id")
        loc = e.get("location")
        if pid and pid not in assigned_ids and isinstance(loc, list) and len(loc) >= 2:
            anchors.append((pid, (e.get("team") or {}).get("name"), loc))
    if anchors:
        cands = []   # (distance, dot_index, player_id) for every plausible match
        for di, dot in enumerate(dots):
            if dot["player_id"] is not None:        # keep exact/shot-frame/keeper ids
                continue
            dteam = actor_team if dot["teammate"] else opponent_team
            for pid, ateam, loc in anchors:
                if ateam != dteam:
                    continue
                d = _dist(dot["location"], loc)
                if d <= 4.0:                        # ~within a stride = the same player
                    cands.append((d, di, pid))
        cands.sort(key=lambda c: c[0])              # assign the closest matches first
        taken = set()
        for d, di, pid in cands:
            if di in taken or pid in assigned_ids:
                continue
            assign(dots[di], pid, "exact")          # derived from a real adjacent frame
            taken.add(di)

    # 5) Everyone else — tactics-based positional inference (last resort). Match
    #    each remaining dot to the nearest EXPECTED formation position for its own
    #    team (greedy, closest pairings first). Because the opponent's expected
    #    shape is point-reflected (see _expected_xy), an opponent dot on the
    #    actor's right is read with the opponent's LEFT-side label, not the
    #    actor-side one — fixing e.g. the right-back label leaking across sides.
    for side_team, is_teammate in ((actor_team, True), (opponent_team, False)):
        pool = [d for d in dots if d["teammate"] == is_teammate
                and d["player_id"] is None and not d["actor"] and not d["keeper"]]
        lineup = [p for p in tactics.get(side_team, [])
                  if p["player_id"] not in assigned_ids and p["position_id"] != 1]
        if not pool or not lineup:
            continue
        cands = []   # (distance, dot_idx, player_idx, dot, player) for every pairing
        for di, dot in enumerate(pool):
            for pi, player in enumerate(lineup):
                ex, ey = _expected_xy(player["position"], is_teammate)
                cands.append((_dist(dot["location"], (ex, ey)), di, pi, dot, player))
        cands.sort(key=lambda c: (c[0], c[1], c[2]))
        for _d, _di, _pi, dot, player in cands:
            if dot["player_id"] is not None or player["player_id"] in assigned_ids:
                continue
            assign(dot, player["player_id"], "inferred", position=player["position"])

    # A handful of 360 freeze frames come back POINT-REFLECTED relative to the
    # (normalised, attack-toward-x=120) event location, which made the 3D render
    # those moments with the actor attacking the wrong way. Detect it by comparing
    # the actor dot to the event location and, if the reflected position is the
    # closer match, mirror the whole frame so the players, the event location and
    # the action arrow all share one orientation (actor attacks +x). A point
    # reflection preserves every pairwise distance, so the pressure / lane /
    # identity math computed above is unaffected.
    ev_loc = ev.get("location")
    actor_dot2 = next((d for d in dots if d.get("actor")), None)
    if actor_dot2 and isinstance(ev_loc, list) and len(ev_loc) >= 2:
        ax, ay = actor_dot2["location"]
        d_same = (ax - ev_loc[0]) ** 2 + (ay - ev_loc[1]) ** 2
        d_refl = ((120 - ax) - ev_loc[0]) ** 2 + ((80 - ay) - ev_loc[1]) ** 2
        if d_refl < d_same:
            for d in dots:
                lx, ly = d["location"]
                d["location"] = [round(120 - lx, 2), round(80 - ly, 2)]

    context = _decision_context(ev, dots)

    return {
        "event": simplify_event(ev, frames_map, players_idx),
        "players": dots,
        "visible_area": frame.get("visible_area"),
        "context": context,
        "teams": {"actor_team": actor_team, "opponent_team": opponent_team},
    }


# Decision context

def _zone(location) -> str:
    if not location:
        return "middle third"
    x, y = location[0], location[1]
    if x >= 102 and 18 <= y <= 62:
        return "penalty area"
    if x >= 80:
        return "attacking third"
    if x >= 40:
        return "middle third"
    return "defensive third"


def _decision_context(ev: dict, dots: list) -> dict:
    loc = ev.get("location")
    actor_dot = next((d for d in dots if d["actor"]), None)
    origin = (actor_dot["location"] if actor_dot else loc) or [60, 40]

    opponents = [d for d in dots if not d["teammate"]]
    teammates = [d for d in dots if d["teammate"] and not d["actor"]]

    nearest = min((_dist(origin, o["location"]) for o in opponents), default=None)
    if nearest is None:
        pressure = "LOW"
    elif nearest < 3.0:
        pressure = "HIGH"
    elif nearest < 6.0:
        pressure = "MEDIUM"
    else:
        pressure = "LOW"

    # a team-mate is "open" if no opponent sits within the lane-block radius of the
    # passing CORRIDOR (a defender marking the receiver does not block the lane).
    # Single source of truth with the tactical engine / 3D pitch.
    from tactical_analysis import LANE_BLOCK_RADIUS, lane_clearance
    open_count = 0
    for tm in teammates:
        if lane_clearance(origin, tm["location"], opponents) >= LANE_BLOCK_RADIUS:
            open_count += 1

    return {
        "nearest_defender_dist": round(nearest, 2) if nearest is not None else None,
        "pressure": pressure,
        "open_teammate_count": open_count,
        "teammate_count": len(teammates),
        "opponent_count": len(opponents),
        "zone": _zone(loc),
        "xg": ev.get("shot", {}).get("statsbomb_xg"),
        "outcome": _event_outcome(ev),
    }


# Possession chains (for replay)

def possession_chain(match_id: int, possession: int, up_to_index: int | None = None) -> list:
    """The possession's on-ball spell, PLUS the single opponent touch immediately
    before it (where the ball was won off them) and immediately after it (where
    possession changed hands). Those two bracketing moments give the move its
    before/after context; the frontend marks them as the opponent's."""
    frames_map = get_frames_map(match_id)
    names = _player_index(match_id)
    # all on-ball, located events in index order
    onball = [ev for ev in get_raw_events(match_id)
              if ev.get("type", {}).get("name") in ON_BALL_TYPES and ev.get("location")]
    core = [i for i, ev in enumerate(onball) if ev.get("possession") == possession]
    if not core:
        return []
    lo = core[0] - 1 if core[0] - 1 >= 0 else core[0]          # opponent touch before
    hi = core[-1] + 1 if core[-1] + 1 < len(onball) else core[-1]  # opponent touch after
    chain = []
    for ev in onball[lo:hi + 1]:
        if up_to_index is not None and ev.get("index", 0) > up_to_index:
            break
        chain.append(simplify_event(ev, frames_map, names))
    return chain

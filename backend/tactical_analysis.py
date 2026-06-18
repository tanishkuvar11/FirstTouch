"""
FirstTouch tactical analysis engine.

Pure-geometry football intelligence computed from a freeze frame. This is the
substrate for IBM Granite's explanations (and the offline fallback): pressure,
passing lanes, space ahead, and a ranked best option.

Coordinates are StatsBomb pitch units (120 x 80, attack toward x = 120).
"""

import math

LANE_BLOCK_RADIUS = 1.0     # an opponent within this distance of a lane blocks it
DENSITY_RADIUS = 5.0        # defenders inside this radius count toward density
GOAL = (120.0, 40.0)


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _point_to_segment(p, a, b) -> float:
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


# A defender this close to the PASSER is applying pressure, not sitting in a lane;
# this close to the RECEIVER is marking him, not cutting the lane. Either way the
# ball still travels the corridor, so only defenders in the MIDDLE of the lane block
# it. (Without the passer buffer, one defender pressing the ball-carrier would block
# every lane at once, since all lanes start at the passer.)
PASSER_PRESSURE_BUFFER = 1.5
RECEIVER_MARK_BUFFER = 1.5
# A defender this tight to the receiver (Euclidean) is draped over him, so the pass
# is contested at the reception even though he sits in the receiver end-zone: he is
# NOT trimmed away by RECEIVER_MARK_BUFFER, his perpendicular distance still closes
# the lane. (A defender merely standing GOAL-SIDE of the receiver, further than this,
# is still ignored, so a free man with a defender behind him stays a clean option.)
RECEIVER_MARK_RADIUS = 1.3


def lane_clearance(origin, target, opponents) -> float:
    """Smallest perpendicular distance from any opponent to the PASSING CORRIDOR:
    the ball's path with the pressure zone (near the passer) and the marking zone
    (near the receiver) trimmed off, so only a defender genuinely positioned to
    INTERCEPT the pass closes the lane. A defender tightly marking the receiver
    (within RECEIVER_MARK_RADIUS) is the exception: he contests the reception, so
    he still counts. Returns a large number when clear."""
    ax, ay = origin
    bx, by = target
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    if length == 0:
        return 99.0
    ux, uy = dx / length, dy / length
    lo, hi = PASSER_PRESSURE_BUFFER, length - RECEIVER_MARK_BUFFER
    if hi <= lo:                                    # short pass: keep a small central band
        mid = length / 2.0
        lo, hi = max(0.0, mid - 0.75), min(length, mid + 0.75)
    best = 99.0
    for o in opponents:
        px, py = o["location"]
        tight_mark = math.hypot(px - bx, py - by) <= RECEIVER_MARK_RADIUS
        along = (px - ax) * ux + (py - ay) * uy     # projection along the lane
        if (along < lo or along > hi) and not tight_mark:
            continue                                # in a trimmed end-zone, not the lane
        perp = abs((px - ax) * uy - (py - ay) * ux)  # perpendicular distance to the lane
        if perp < best:
            best = perp
    return round(best, 2)


def _space_ahead(origin, opponents) -> float:
    """How far the actor can carry straight toward goal before meeting a
    defender (defender within 3 units of the carry line, ahead of the actor)."""
    blockers = []
    for o in opponents:
        ox, oy = o["location"]
        if ox > origin[0] and abs(oy - origin[1]) < 3.0:
            blockers.append(ox - origin[0])
    if not blockers:
        return round(min(25.0, 120.0 - origin[0]), 1)
    return round(min(blockers), 1)


def _shot_value(origin, opponents) -> float:
    """Crude shot value: distance + angle + bodies between ball and goal."""
    d = _dist(origin, GOAL)
    if d > 35:
        return 0.0
    value = max(0.0, 1.0 - d / 35.0)
    in_cone = sum(1 for o in opponents
                  if _point_to_segment(o["location"], origin, GOAL) < 2.0)
    value *= max(0.15, 1.0 - 0.3 * in_cone)
    return round(value, 3)


def analyze_frame(freeze_frame: list, actor_location, event_type: str,
                  end_location=None) -> dict:
    """
    freeze_frame: enriched FramePlayer dicts (teammate/actor/keeper + identity)
    Returns the tactical picture the actor faced.
    """
    origin = tuple(actor_location) if actor_location else (60.0, 40.0)
    opponents = [d for d in freeze_frame if not d["teammate"]]
    teammates = [d for d in freeze_frame if d["teammate"] and not d.get("actor")]

    nearest_defender = min((_dist(origin, o["location"]) for o in opponents),
                           default=None)
    density = sum(1 for o in opponents if _dist(origin, o["location"]) < DENSITY_RADIUS)

    # Pressure 0..1 — exponential falloff on nearest defender, boosted by density
    if nearest_defender is None:
        pressure_score = 0.0
    else:
        pressure_score = math.exp(-nearest_defender / 4.0)
        pressure_score = min(1.0, pressure_score + 0.08 * max(0, density - 1))
    pressure_score = round(pressure_score, 3)

    open_options, blocked_options = [], []
    for tm in teammates:
        lane_margin = lane_clearance(origin, tm["location"], opponents)
        progress = tm["location"][0] - origin[0]   # forward gain of the pass
        option = {
            "player_name": tm.get("player_name"),
            "jersey_number": tm.get("jersey_number"),
            "position": tm.get("position"),
            "location": tm["location"],
            "distance": round(_dist(origin, tm["location"]), 1),
            "lane_margin": round(lane_margin, 1),
            "forward_progress": round(progress, 1),
        }
        (open_options if lane_margin >= LANE_BLOCK_RADIUS else blocked_options).append(option)

    open_options.sort(key=lambda o: -o["forward_progress"])
    blocked_options.sort(key=lambda o: -o["forward_progress"])

    space = _space_ahead(origin, opponents)
    shot_value = _shot_value(origin, opponents)

    # Rank the basic options: shoot / pass / carry
    candidates = [("shot", shot_value)]
    if open_options:
        best_pass = open_options[0]
        pass_value = 0.3 + 0.012 * max(0.0, best_pass["forward_progress"]) \
            + 0.05 * min(4, len(open_options))
        jersey = best_pass.get("jersey_number")
        label = f"pass_to_{jersey}" if jersey else "pass"
        candidates.append((label, round(min(0.95, pass_value), 3)))
    carry_value = min(0.7, 0.05 * space) * (1.0 - pressure_score * 0.6)
    candidates.append(("carry", round(carry_value, 3)))
    best_option = max(candidates, key=lambda c: c[1])[0]

    # Decision quality: did the chosen action line up with the best option?
    chosen = {"Shot": "shot", "Pass": "pass", "Carry": "carry",
              "Dribble": "carry"}.get(event_type)
    ranked = sorted(candidates, key=lambda c: -c[1])
    chosen_rank = next((i for i, (name, _) in enumerate(ranked)
                        if chosen and name.startswith(chosen)), None)
    if chosen_rank == 0:
        decision_quality = "optimal"
    elif chosen_rank == 1:
        decision_quality = "good"
    elif chosen_rank is not None:
        decision_quality = "suboptimal"
    else:
        decision_quality = "good"   # defensive actions etc. — no ranking basis
    if pressure_score > 0.75 and decision_quality == "suboptimal":
        decision_quality = "poor"

    return {
        "pressure_score": pressure_score,
        "nearest_defender_dist": round(nearest_defender, 2) if nearest_defender is not None else None,
        "defender_density": density,
        "open_passing_options": open_options,
        "blocked_options": blocked_options,
        "space_ahead": space,
        "shot_value": shot_value,
        "best_option": best_option,
        "option_ranking": [{"option": n, "value": v} for n, v in ranked],
        "decision_quality": decision_quality,
    }

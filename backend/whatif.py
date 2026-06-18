"""FirstTouch What-If engine.

The decision-intelligence core: for one on-ball moment, value EVERY option the
player actually had, so the road not taken is measured, not guessed.

Passing and carrying options are valued by the real Expected Threat (xT) of the
position they reach (Karun Singh's published 12x8 grid), i.e. how dangerous the
ball would be there. The shoot option is valued with a transparent geometric xG
estimate. Both are absolute goal-probabilities, so "shoot vs pass" is compared
like-for-like: the textbook xT decision rule is shoot when xG exceeds the xT of
the position a pass would reach. (Valuing passes by xT-ADDED while valuing the
shot by absolute xG would unfairly handicap the pass by its starting position.)
Lane geometry (which team-mates are reachable) reuses tactical_analysis.

Granite then reasons over this ranked, real-number table to deliver the verdict
(see granite_client.whatif_verdict) — the numbers are ground truth, the judgment
is the model's. Coordinates are StatsBomb units (120x80, attack toward x=120)."""

import math

import tactical_analysis as ta

GOAL = (120.0, 40.0)

# Karun Singh's Expected Threat surface, 8 rows (y) x 12 cols (x). Identical to
# the frontend XT_GRID so the panel and the engine agree to the decimal.
XT_GRID = [
    [0.00638303, 0.00779616, 0.00844854, 0.00977659, 0.01126267, 0.01248588, 0.01473348, 0.0174553, 0.02122129, 0.02756312, 0.03485072, 0.0379259],
    [0.00750072, 0.00878589, 0.00942382, 0.0105949, 0.01214719, 0.0138454, 0.01611813, 0.01870347, 0.02401521, 0.02953272, 0.04066992, 0.04647721],
    [0.0088799, 0.00977745, 0.01001304, 0.01110462, 0.01269174, 0.01429128, 0.01685596, 0.01935132, 0.0241224, 0.02855202, 0.05491138, 0.06442595],
    [0.00941056, 0.01082722, 0.01016549, 0.01132376, 0.01262646, 0.01484598, 0.01689528, 0.0199707, 0.02385149, 0.03511326, 0.10805102, 0.25745362],
    [0.00941056, 0.01082722, 0.01016549, 0.01132376, 0.01262646, 0.01484598, 0.01689528, 0.0199707, 0.02385149, 0.03511326, 0.10805102, 0.25745362],
    [0.0088799, 0.00977745, 0.01001304, 0.01110462, 0.01269174, 0.01429128, 0.01685596, 0.01935132, 0.0241224, 0.02855202, 0.05491138, 0.06442595],
    [0.00750072, 0.00878589, 0.00942382, 0.0105949, 0.01214719, 0.0138454, 0.01611813, 0.01870347, 0.02401521, 0.02953272, 0.04066992, 0.04647721],
    [0.00638303, 0.00779616, 0.00844854, 0.00977659, 0.01126267, 0.01248588, 0.01473348, 0.0174553, 0.02122129, 0.02756312, 0.03485072, 0.0379259],
]


def xt_at(loc) -> float:
    """xT value at a StatsBomb location. Port of the frontend xtAt()."""
    if not (isinstance(loc, (list, tuple)) and len(loc) >= 2):
        return 0.0
    x, y = loc[0], loc[1]
    if not (isinstance(x, (int, float)) and isinstance(y, (int, float))):
        return 0.0
    col = max(0, min(11, int((x / 120.0) * 12)))
    row = max(0, min(7, int((y / 80.0) * 8)))
    return XT_GRID[row][col]


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _xg_estimate(origin, opponents) -> float:
    """A transparent geometric xG estimate for the hypothetical 'shoot' option:
    closer + a wider open goal angle => higher, knocked down by bodies in the
    shooting cone. Clearly an ESTIMATE (the shot never happened); the headline
    comparison rests on the xT-graded passing options, which are exact."""
    d = _dist(origin, GOAL)
    if d > 32:
        return 0.0
    # angle the goalmouth subtends (posts at y=36 and y=44)
    a1 = math.atan2(36.0 - origin[1], 120.0 - origin[0])
    a2 = math.atan2(44.0 - origin[1], 120.0 - origin[0])
    angle = abs(a2 - a1)
    base = math.exp(-0.085 * d) * (angle / 0.7)        # ~0.7 rad is a great angle
    in_cone = sum(1 for o in opponents
                  if ta._point_to_segment(o["location"], origin, GOAL) < 2.0)
    xg = base * max(0.2, 1.0 - 0.25 * in_cone)
    return round(max(0.0, min(0.9, xg)), 3)


def _chosen_value(ev, origin, xt0, ctx_xg):
    """Value of the action actually taken, in the same units as the options it is
    compared against: absolute xT of the position a move reaches, xG for a shot."""
    t = ev.get("type")
    end = ev.get("end_location")
    if t == "Shot":
        xg = ctx_xg if isinstance(ctx_xg, (int, float)) else ev.get("xg")
        return (round(float(xg), 3) if isinstance(xg, (int, float)) else 0.05), "xG"
    if isinstance(end, (list, tuple)):
        return round(xt_at(end), 4), "xT"
    return 0.0, "xT"


def enumerate_options(frame: dict) -> dict:
    """Rank every option the player had, valued with real xT / estimated xG.

    Returns {origin, actor, options[], summary{}}. Each option carries its value,
    its value_kind ('xT'|'xG'), whether the lane was viable, and chosen/best
    flags. summary gives the chosen vs best comparison that is the headline."""
    players = frame.get("players") or []
    ev = frame.get("event") or {}
    ctx = frame.get("context") or {}

    actor = next((p for p in players if p.get("actor")), None)
    origin = tuple(actor["location"]) if actor and isinstance(actor.get("location"), (list, tuple)) \
        else tuple(ev.get("location") or (60.0, 40.0))
    xt0 = xt_at(list(origin))
    opponents = [p for p in players if not p.get("teammate") and isinstance(p.get("location"), (list, tuple))]

    tac = ta.analyze_frame(players, list(origin), ev.get("type"), ev.get("end_location"))

    options = []

    # --- pass options: every team-mate, valued by xT-added, viable iff lane open
    for tm in tac.get("open_passing_options", []) + tac.get("blocked_options", []):
        loc = tm["location"]
        viable = tm["lane_margin"] >= ta.LANE_BLOCK_RADIUS
        name = tm.get("player_name")
        jersey = tm.get("jersey_number")
        who = name or (f"#{jersey}" if jersey else "team-mate")
        options.append({
            "kind": "pass",
            "label": f"Pass to {who}",
            "receiver": name, "jersey_number": jersey, "position": tm.get("position"),
            "target": loc,
            "value": round(xt_at(loc), 4),     # absolute threat of the receiver's position
            "value_kind": "xT",
            "viable": viable,
            "blocked": not viable,
            "forward": tm.get("forward_progress"),
        })

    # --- carry into the space ahead
    space = tac.get("space_ahead") or 0.0
    if space and space > 3:
        target = [min(120.0, origin[0] + space), origin[1]]
        options.append({
            "kind": "carry",
            "label": f"Carry into {round(space)} m of space",
            "target": target,
            "value": round(xt_at(target), 4),   # absolute threat of the position carried into
            "value_kind": "xT",
            "viable": True, "blocked": False,
        })

    # --- shoot (only when realistically in range), estimated xG. Skipped when the
    # action actually taken was already a shot: the chosen row IS that shot (with
    # its real xG), so a synthetic estimate would only duplicate it confusingly.
    if ev.get("type") != "Shot" and _dist(origin, GOAL) <= 32:
        xg = _xg_estimate(origin, opponents)
        if xg > 0:
            options.append({
                "kind": "shot",
                "label": "Shoot",
                "target": list(GOAL),
                "value": xg,
                "value_kind": "xG",
                "viable": True, "blocked": False,
                "estimate": True,
            })

    # --- the action actually chosen
    chosen_val, chosen_kind = _chosen_value(ev, origin, xt0, ctx.get("xg"))
    # name the chosen action as the OPTION (imperative), not a past-tense recap, so
    # it sits in the same frame as the alternatives and never reads as a separate
    # "what if he had shot there instead" option
    chosen_label = {
        "Shot": "Shoot", "Pass": "The pass played",
        "Carry": "The carry made", "Dribble": "The dribble taken",
    }.get(ev.get("type"), "The action taken")
    chosen = {
        "kind": (ev.get("type") or "action").lower(),
        "label": chosen_label,
        "target": ev.get("end_location") or list(GOAL),
        "value": chosen_val,
        "value_kind": chosen_kind,
        "viable": True, "blocked": False,
        "chosen": True,
    }
    options.append(chosen)

    # rank by value (xT and xG live on the same goal-probability scale)
    options.sort(key=lambda o: -(o["value"] if o.get("value") is not None else -9))
    for o in options:
        o["best"] = False
    # best alternative = highest-value VIABLE option that isn't the chosen one AND
    # is actually better than what was chosen. If nothing viable beats the chosen
    # action (e.g. the higher-xT passes were all blocked), there is no "better
    # option" to flag and the choice stands as optimal.
    alt = [o for o in options
           if o.get("viable") and not o.get("chosen") and o["value"] > chosen_val]
    best = alt[0] if alt else None
    if best:
        best["best"] = True

    # the best option OVERALL, viable or not, so we can tell a genuinely optimal
    # choice from a FORCED one: if the highest-value ball on the pitch was clearly
    # better but its lane was BLOCKED, the player did not pick the best option, he
    # was denied it and left with the best of what remained.
    others = [o for o in options
              if not o.get("chosen") and isinstance(o.get("value"), (int, float))]
    best_overall = max(others, key=lambda o: o["value"], default=None)
    blocked_dream = (
        best_overall if best_overall and best_overall.get("blocked")
        and best_overall["value"] >= max(chosen_val * 2.0, chosen_val + 0.05)
        else None
    )

    rank = next((i for i, o in enumerate(options) if o.get("chosen")), None)
    summary = {
        "chosen_value": chosen_val,
        "chosen_kind": chosen_kind,
        "best_value": best["value"] if best else None,
        "best_label": best["label"] if best else None,
        "best_target": best["target"] if best else None,
        "delta": round((best["value"] - chosen_val), 4) if best else None,
        "blocked_best_label": blocked_dream["label"] if blocked_dream else None,
        "blocked_best_value": blocked_dream["value"] if blocked_dream else None,
        "rank": rank,            # 0 = the chosen action was the top-valued option
        "count": len(options),
    }
    # verdict class for the deterministic baseline / fallback
    if best is not None and summary["delta"] is not None and summary["delta"] > 0.005:
        summary["verdict_class"] = "solid" if chosen_val >= 0.7 * best["value"] else "better_available"
    elif blocked_dream is not None:
        # nothing viable beat it, but a much better ball was cut out: a forced choice
        summary["verdict_class"] = "forced"
    else:
        summary["verdict_class"] = "optimal"

    return {
        "origin": list(origin),
        "actor": (actor or {}).get("player_name") or ev.get("player"),
        "options": options,
        "summary": summary,
    }

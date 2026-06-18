"""
IBM Granite integration, with LangChain prompt orchestration.

Backends, in order of preference: watsonx.ai (if credentials are set), then a
local Granite model via Ollama, then a structured local fallback so the product
never shows a broken state. The prompt is situational: Granite is asked to weigh
the moment (scoreline, stage, time, stakes), not just the action in isolation.
"""

import hashlib
import os
import random

from dotenv import load_dotenv

import analyst_personas

load_dotenv()

RULES = (
    "STYLE: Talk like a warm, likeable human pundit chatting with a friend on the "
    "sofa, not an AI and not a report. Be friendly, natural and easy to listen to: a "
    "little warmth, a little personality, the odd bit of feeling. Still be honest and "
    "specific: genuinely enjoy a lovely piece of play, and when a choice was poor (a "
    "forced pass, a rushed finish, a sloppy turnover, a defender who read it all the "
    "way) say so kindly but plainly, without softening every mistake into bad luck or "
    "forcing praise that was not earned. "
    "Always REACT to what actually happened (the outcome) with feeling, then explain "
    "WHY, do not just describe the set-up and trail off. Explain the FOOTBALL in plain "
    "words: what the player saw, the passing lanes, the pressure, the space, the "
    "defenders' shape. "
    "IMPORTANT: whenever a clearly better option was on (a team-mate in more space, a "
    "shot that was on, grass to carry into), name it in plain language and say why you "
    "would have liked it more. If the choice really was the best available, say that "
    "too. "
    "When a player wastes a real chance or makes a glaring error, react the instinctive, "
    "human way a pundit does out loud, and fit the line to the actual circumstances: a "
    "missed sitter or an easy distance earns something like 'he has to score that' or "
    "'you just cannot miss from there'; a chance laid on for him earns 'he had it served "
    "on a plate'; a wild finish earns 'what is he doing there'; a soft giveaway earns "
    "'you cannot give the ball away like that'. Use these as feeling, not a checklist: "
    "pick at most one such line when it genuinely fits, say it naturally in your own "
    "language, and never force it onto a hard chance or a good decision. "
    "Describe the action he ACTUALLY took, exactly as stated in THE MOMENT: a carry is "
    "him driving forward with the ball at his feet, a pass is him giving it to a "
    "team-mate, a shot is him striking at goal. Never swap them (do not call a carry a "
    "pass). Anything tagged 'also on' is an ALTERNATIVE he did NOT take, the road not "
    "taken, so do not describe it as his choice. Refer to players by name, never by "
    "shirt number (say 'a pass to Disasi', never 'a pass to number 3'). "
    "NEVER narrate metrics: do not mention or quote any rating, score, number out of "
    "100, percentage or xG figure, and never use the words Action Quality, Stakes, "
    "Difficulty, Vision, Execution, Risk or Leverage. Interpret the moment, never "
    "report numbers. "
    "Let the stakes and your feelings set your tone: a final or a decisive late goal "
    "carries real emotion; a routine group-stage moment is calmer and chattier. "
    "Vary your opening and structure so no two reads feel the same; never begin with "
    "'In this' or 'found himself'. Stay in the moment: do not predict what happens "
    "next or state the final result of the game, and do not invent players, options "
    "or numbers beyond those given. "
    "If a goalkeeper name is given in THE MOMENT, use that EXACT name; if none is "
    "given, call them 'the goalkeeper' and NEVER invent a name for them. "
    "Keep it to 2 to 4 sentences. No em dashes anywhere; use full stops and commas."
)

OPEN_PLAY_TEMPLATE = """{persona}

THE MOMENT
{player_name} ({team}) {action_verb} in the {zone}, minute {minute} of a World Cup {stage}.
Game state for {team}: {game_state} (match score {scoreline}).
What is at stake: {stakes_level}. Drivers: {stakes_drivers}.

WHAT THE PLAYER SAW
Pressure: {pressure}, nearest defender {nearest_defender_dist}m. Open team-mates: {open_teammate_count} of {teammate_count}. Opponents in view: {opponent_count}. {xg_line}
{keeper_line}
{options_line}
Outcome: {outcome}.{result_line} {shot_placement}

PRIVATE STEER (this is for your judgment only, do NOT quote any of it):
Our read of the choice is broadly {decision_label}. In its favour: {decision_pros}. Against it: {decision_cons}.
{allegiance_line}

Now give your own verdict on this moment as {analyst_name}, in your own voice. {language_line} {rules}"""

PENALTY_TEMPLATE = """{persona}

THE MOMENT
{player_name} ({team}) steps up to take {pen_kind} in the World Cup {stage}, minute {minute}.
{pen_context}
{keeper_line}
What is at stake: {stakes_level}. Drivers: {stakes_drivers}.
HOW THE KICK ENDED: {outcome}.

This already happened. Structure your read like this: open with AT MOST one short sentence of build-up, then state plainly whether he scored or missed, and then spend at least TWO sentences reacting to that result and analysing it. Let yourself feel it: if he buried it, the relief and release; if he missed or it was saved, the gut-punch, what it costs at this stage, and what it says about the moment. Do NOT end on the bare result with no reaction; the reaction and analysis MUST come after it. A penalty is one on one with the goalkeeper, so do NOT mention team-mates, passing lanes, nearby defenders or expected goals, only the nerve, the pressure and what this kick meant.
{allegiance_line}

Give your verdict as {analyst_name}, in your own voice. {language_line} {rules}"""

KICKOFF_TEMPLATE = """{persona}

THE MOMENT
{player_name} ({team}) takes {kickoff_label} in the World Cup {stage}.
Game state for {team}: {game_state} (match score {scoreline}).

A kick-off simply restarts play: by the Laws of the Game it MUST be a short pass to a team-mate, so it is NOT a decision to analyse. Do NOT weigh options, do NOT call it underwhelming, safe, cautious, unambitious or a missed chance to be braver, and do NOT suggest he should have carried, taken a touch or driven forward. There is no alternative and nothing to second-guess.

Instead, just set the scene like a commentator: who got things under way, the mood and shape of the match at this point, and what each side will be looking for from here. Keep it light, warm and natural, 2 to 3 sentences. Do not predict the result.
{allegiance_line}

Give your read as {analyst_name}, in your own voice. {language_line} {rules}"""


def _join(v, empty="none noted"):
    if isinstance(v, (list, tuple)):
        return "; ".join(str(x) for x in v) if v else empty
    return str(v) if v not in (None, "") else empty


def _render(template: str, fields: dict) -> str:
    try:
        from langchain_core.prompts import PromptTemplate
        return PromptTemplate.from_template(template).format(**fields)
    except Exception:
        return template.format(**fields)


def _teammate_name(ctx: dict, jersey) -> str | None:
    """Resolve a team-mate's jersey number to their name from the enriched frame,
    so the analyst can name players instead of saying 'number 8'."""
    for p in (ctx.get("players") or []):
        if (p.get("teammate") and not p.get("actor")
                and str(p.get("jersey_number")) == str(jersey)):
            return p.get("player_name")
    return None


def _keeper_name(ctx: dict) -> str | None:
    """The opposing goalkeeper's real name from the freeze frame, but ONLY when the
    identity is exact, so the analyst can name the keeper instead of hallucinating
    one. Returns None if the keeper is anonymous (then the prose says 'the keeper')."""
    for p in (ctx.get("players") or []):
        if p.get("keeper") and p.get("player_name") \
                and p.get("identity_confidence") == "exact":
            return p.get("player_name")
    return None


def _keeper_line(ctx: dict) -> str:
    """Grounding fact for the prompt: name the keeper if we know them, otherwise
    say nothing (the RULES then force a generic 'the goalkeeper')."""
    name = _keeper_name(ctx)
    return f"In goal for the opposition is {name}." if name else ""


def _alternative_line(ctx: dict) -> str:
    """A readable phrase for the clearest OTHER option the player had (the road not
    taken), so the analyst can weigh the choice against it. Framed explicitly as an
    alternative ("was also on"), names team-mates from the jersey number, and never
    offers the SAME action he chose (e.g. do not suggest 'carry' to a player who
    carried, which makes the model misreport the action)."""
    tac = ctx.get("tactical") or {}
    best = tac.get("best_option")
    action = (ctx.get("action_type") or "").lower()
    bits = []
    if isinstance(best, str):
        if best == "shot" and action != "shot":
            bits.append("A shot was on there too if he fancied it.")
        elif best == "carry" and action not in ("carry", "dribble"):
            bits.append("He could also have driven forward into the space with the ball himself.")
        elif best.startswith("pass_to_"):
            num = best.split("_")[-1]
            name = _teammate_name(ctx, num)
            who = name or f"the number {num}"
            bits.append(f"A pass to {who} was also on.")
        elif best == "pass":
            bits.append("A pass to a team-mate was also on.")
    space = tac.get("space_ahead")
    # only suggest carrying into space when he did NOT already carry/dribble
    if isinstance(space, (int, float)) and space > 8 and action not in ("carry", "dribble"):
        bits.append(f"There was roughly {round(space)}m of grass ahead to run into.")
    return " ".join(bits)


def _chance_phrase(xg) -> str:
    """Qualitative read of the chance quality, so the model never has a raw xG
    number to parrot (the no-metrics rule forbids quoting figures). Empty when
    xG is unknown."""
    if not isinstance(xg, (int, float)):
        return ""
    if xg >= 0.4:
        return "This was a gilt-edged chance, the kind you fully expect to be buried."
    if xg >= 0.18:
        return "This was a genuine, presentable chance."
    if xg >= 0.07:
        return "This was a half-chance, a low-percentage effort."
    return "This was a real long shot, a very low-percentage effort."


def _shot_placement_line(ctx: dict) -> str:
    """Where the shot actually finished, in plain words, read from the real
    end-location so the model can praise a near miss instead of calling a fine
    strike a failure. Silent for a goal (the result line covers it) or a shot that
    missed by a mile. Goal mouth: posts at y 36..44, crossbar at z 2.67."""
    if ctx.get("action_type") != "Shot":
        return ""
    outcome = ctx.get("outcome") or ""
    if outcome == "Goal":
        return ""
    if outcome in ("Saved", "Saved To Post"):
        q = ctx.get("shot_placement_quality")
        if outcome == "Saved To Post" or (isinstance(q, (int, float)) and q >= 0.55):
            return ("He struck it sweetly towards the corner: that was a fine effort "
                    "denied by a top-class save, not a poor finish, so credit the "
                    "goalkeeper rather than fault the strike.")
        if isinstance(q, (int, float)) and q <= 0.33:
            return ("He hit it too close to the goalkeeper, a comfortable save: he "
                    "really should have done better with the placement.")
        return "He hit the target and forced the goalkeeper into a save."
    margin = ctx.get("shot_off_target_margin")
    end = ctx.get("shot_end_location")
    if not (isinstance(margin, (int, float)) and margin <= 1.6):
        return ""   # a clear miss: there is no closeness to dwell on
    if outcome == "Post":
        return "It cannoned back off the woodwork, a whisker from a goal."
    over = isinstance(end, list) and len(end) >= 3 and end[2] > 2.67
    inside_posts = isinstance(end, list) and len(end) >= 2 and 36.0 <= end[1] <= 44.0
    if over and inside_posts:
        return "It flew just over the crossbar, agonisingly close to the top corner."
    if not over and not inside_posts:
        return "It flashed inches the wrong side of the post, so nearly in."
    return "It missed by the finest of margins, desperately close to going in."


def _allegiance_line(ctx: dict, lang: str) -> str:
    """A private steer telling the analyst how their national-team loyalty should
    colour the EMOTION of the read. The analyst openly supports their own country,
    so they are delighted when it benefits and hurt when it suffers, and they will
    still honestly criticise their own player for a poor decision. When neither
    side is their nation, they stay even-handed but warm. Truth never changes,
    only the tone."""
    me = analyst_personas.nation(lang)
    if not me:
        return ""
    team = ctx.get("team")
    home, away = ctx.get("home_team"), ctx.get("away_team")
    teams = [t for t in (home, away) if t]
    # fall back to just the acting team if we were not given both sides
    if me not in teams and me != team:
        return ("ALLEGIANCE (judgment only, never quote): neither side here is your "
                "own national team, so stay even-handed between them, but keep it warm "
                "and let yourself enjoy or wince at the football as a fan would.")
    opponent = None
    if teams:
        opponent = next((t for t in teams if t != me), None)
    acting_for_me = (team == me)
    opp_txt = f" against {opponent}" if opponent else ""
    return (
        f"ALLEGIANCE (judgment only, never quote): {me} is YOUR national team and "
        f"they are playing{opp_txt} here. Let your support show like a real pundit who "
        f"loves their country. Be openly delighted and emotional when {me} benefits, "
        f"and visibly frustrated or gutted when the moment hurts {me}. "
        + (
            f"This is a {me} player, so react as a passionate but fair {me} pundit: "
            f"celebrate the good and, if the decision was poor, criticise him honestly "
            f"the way a home pundit would, with feeling but without cruelty."
            if acting_for_me else
            f"This is a {opponent or 'the opposing'} player, so judge it fairly on the "
            f"football, but let your {me} heart show: quietly pleased when it goes "
            f"wrong for them, uneasy when they threaten {me}."
        )
        + " Never distort what actually happened; only your tone and emotion change."
    )


def build_prompt(ctx: dict) -> str:
    player = ctx.get("player_name") or "The player"
    team = ctx.get("team") or "his team"
    stage = ctx.get("stage") or "2022 match"
    minute = ctx.get("minute", "?")
    scoreline = ctx.get("scoreline") or "unknown"
    game_state = ctx.get("game_state") or scoreline
    lang = ctx.get("lang") or analyst_personas.DEFAULT_LANG
    p = analyst_personas.persona(lang)
    # plain-language verb for the action he ACTUALLY took, so the model never calls a
    # carry a pass (or vice versa). Penalties use their own template.
    action_verb = {
        "Carry": "carries the ball forward himself",
        "Pass": "plays a pass",
        "Shot": "has a shot",
        "Dribble": "takes his man on, dribbling",
    }.get(ctx.get("action_type"), f"attempts a {(ctx.get('action_type') or 'action').lower()}")
    common = {
        "player_name": player,
        "team": team,
        "stage": stage,
        "minute": minute,
        "action_verb": action_verb,
        "stakes_level": ctx.get("stakes_level") or "unrated",
        "stakes_drivers": _join(ctx.get("stakes_drivers")),
        "outcome": ctx.get("outcome") or "Unknown",
        "persona": p["voice"],
        "analyst_name": p["name"],
        "language_line": analyst_personas.language_line(lang),
        "allegiance_line": _allegiance_line(ctx, lang),
        "keeper_line": _keeper_line(ctx),
        "rules": RULES,
    }

    # Penalties get their own framing: no teammates/lanes/xG, and shootout kicks
    # explicitly do not change the match scoreline (stops "he gave them the lead"
    # style hallucinations).
    if ctx.get("is_penalty"):
        shootout = bool(ctx.get("is_shootout"))
        if shootout:
            pen_kind = "a penalty in the shootout"
            pen_context = (
                f"This is a shootout kick. The match itself finished level at "
                f"{scoreline} and is being settled on penalties, so this kick does "
                f"not change that score, it counts only in the shootout tally."
            )
        else:
            pen_kind = "a penalty"
            pen_context = f"Game state for {team}: {game_state} (match score {scoreline})."
        return _render(PENALTY_TEMPLATE, {
            **common,
            "pen_kind": pen_kind,
            "pen_context": pen_context,
        })

    # A kick-off is a forced restart pass, not a decision: a light scene-setting
    # read with the CORRECT restart named, and no "underwhelming / should have been
    # braver" critique.
    if ctx.get("is_kickoff"):
        return _render(KICKOFF_TEMPLATE, {
            **common,
            "kickoff_label": ctx.get("kickoff_label") or "the kick-off",
            "game_state": game_state,
            "scoreline": scoreline,
        })

    xg = ctx.get("xg")
    xg_line = _chance_phrase(xg)
    # If this was a goal, state precisely what it did to the score so the model
    # cannot misread it (e.g. call a go-ahead goal an "equaliser").
    goal_effect = ctx.get("goal_effect")
    result_line = (
        f" This goal {goal_effect}. Describe the consequence exactly that way "
        f"and do not restate the score differently."
    ) if goal_effect else ""
    # a direct free kick is a dead-ball strike: there are no open-play passing or
    # carrying alternatives to weigh, so steer the read onto the strike itself
    # instead of letting it invent a "he could have carried" critique.
    is_set_piece_shot = (ctx.get("action_type") == "Shot"
                         and ctx.get("shot_type") == "Free Kick")
    if ctx.get("is_kickoff"):
        # the kick-off MUST be a pass (Laws of the Game): there is no carry/drive
        # alternative, so never let the read invent a "should have been more
        # ambitious / could have driven forward" critique.
        options_line = (
            "This was the KICK-OFF, the first touch that restarts play (the start "
            "of a half, or the restart after a goal). By the Laws of the Game it "
            "MUST be a pass, so there is NO option to carry, dribble or drive "
            "forward and no more ambitious alternative to weigh. Do NOT suggest he "
            "should have carried, taken a touch or been more ambitious. Simply note "
            "that he got the match (or the half) under way and moved the ball on."
        )
    elif is_set_piece_shot:
        options_line = (
            "This was a direct free kick, a dead-ball set piece. Judge the strike "
            "itself: the technique, the placement and how close it came. Do NOT suggest "
            "carrying or passing alternatives, he was shooting from a stopped ball."
        )
    else:
        options_line = _alternative_line(ctx)
    return _render(OPEN_PLAY_TEMPLATE, {
        **common,
        "action_type": ctx.get("action_type") or "action",
        "zone": ctx.get("zone") or "middle third",
        "game_state": game_state,
        "scoreline": scoreline,
        "result_line": result_line,
        "pressure": ctx.get("pressure") or "UNKNOWN",
        "nearest_defender_dist": ctx.get("nearest_defender_dist", "?"),
        "open_teammate_count": ctx.get("open_teammate_count", 0),
        "teammate_count": ctx.get("teammate_count", 0),
        "opponent_count": ctx.get("opponent_count", 0),
        "xg_line": xg_line,
        "shot_placement": _shot_placement_line(ctx),
        "options_line": options_line,
        "decision_label": ctx.get("decision_label") or "unrated",
        "decision_pros": _join(ctx.get("decision_pros")),
        "decision_cons": _join(ctx.get("decision_cons")),
    })


def _credentials_present() -> bool:
    key = os.getenv("WATSONX_API_KEY", "")
    project = os.getenv("WATSONX_PROJECT_ID", "")
    placeholders = {"", "your_key_here", "your_project_id"}
    return key not in placeholders and project not in placeholders


def _granite_generate(prompt: str, max_tokens: int = 180, temperature: float = 0.55) -> str:
    from ibm_watsonx_ai import APIClient, Credentials
    from ibm_watsonx_ai.foundation_models import ModelInference
    from ibm_watsonx_ai.metanames import GenTextParamsMetaNames as GenParams

    credentials = Credentials(
        url=os.getenv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com"),
        api_key=os.getenv("WATSONX_API_KEY"),
    )
    client = APIClient(credentials, project_id=os.getenv("WATSONX_PROJECT_ID"))
    model = ModelInference(
        model_id=os.getenv("WATSONX_MODEL_ID", "ibm/granite-3-8b-instruct"),
        api_client=client,
        params={
            GenParams.MAX_NEW_TOKENS: max_tokens,
            GenParams.TEMPERATURE: temperature,
        },
    )
    response = model.generate_text(prompt=prompt)
    if isinstance(response, dict):
        results = response.get("results") or []
        if results:
            return results[0].get("generated_text", "").strip()
    return str(response).strip()


def _ollama_base() -> str:
    return os.getenv("OLLAMA_URL", "http://localhost:11434")


def _ollama_available() -> bool:
    """Quick probe; a refused connection fails fast so there's no real delay."""
    try:
        import requests
        requests.get(f"{_ollama_base()}/api/tags", timeout=1.5)
        return True
    except Exception:
        return False


def active_backend() -> str:
    """Which Granite backend a request would use right now, in preference order.
    Returns 'granite:<via>' when real Granite is reachable, else a 'local' note.
    Used for the startup banner and the precompute guard so it is obvious whether
    the app is serving Granite or the deterministic fallback."""
    if _credentials_present():
        return "granite:watsonx.ai"
    if _ollama_available():
        return "granite:Ollama"
    return "local (no Granite backend reachable)"


# keep the model resident in memory between requests so only the first call pays
# the (multi-second) load cost; without this Ollama unloads after ~5 min idle
_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")


def _ollama_generate(prompt: str, max_tokens: int = 170, temperature: float = 0.55,
                     fmt: str | None = None, model: str | None = None) -> str:
    """Local Granite via Ollama. Prefers LangChain's ChatOllama, falls back to
    Ollama's REST API if langchain-ollama isn't installed. `fmt='json'` asks
    Ollama to constrain the output to valid JSON (used by the assessment)."""
    model = model or os.getenv("OLLAMA_MODEL", "granite3.3:8b")
    base = _ollama_base()
    # Prefer LangChain's ChatOllama; fall back to Ollama's REST API on ANY
    # failure (missing package, or a broken transitive dep like numpy).
    try:
        from langchain_ollama import ChatOllama
        kwargs = dict(model=model, base_url=base, temperature=temperature,
                      num_predict=max_tokens, keep_alive=_KEEP_ALIVE)
        if fmt:
            kwargs["format"] = fmt
        llm = ChatOllama(**kwargs)
        return llm.invoke(prompt).content.strip()
    except Exception:
        import requests
        body = {"model": model, "prompt": prompt, "stream": False, "keep_alive": _KEEP_ALIVE,
                "options": {"temperature": temperature, "num_predict": max_tokens}}
        if fmt:
            body["format"] = fmt
        r = requests.post(f"{base}/api/generate", json=body, timeout=180)
        r.raise_for_status()
        return (r.json().get("response") or "").strip()


def _clean(text: str) -> str:
    """Enforce the no-em-dash rule even if the model ignores it."""
    return text.replace(" — ", ", ").replace("—", ", ").replace("–", "-").strip()


def _clean_chunk(piece: str) -> str:
    """Per-chunk em-dash scrub for streaming (can't see chunk boundaries)."""
    return piece.replace("—", ", ").replace("–", "-")


def _cap_sentences(text: str, n: int = 4) -> str:
    """Keep at most n sentences. The model often ignores the length rule, so we
    enforce it. Splits only on terminators followed by whitespace, leaving
    decimals like 0.10 intact."""
    import re
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(p for p in parts[:n] if p).strip()


import re as _re
# leading "In this ... moment," / "In a ...," opener the model loves to use
_OPENER = _re.compile(r"^\s*in (?:this|a|the)\b[^,.]{0,60},\s*", _re.IGNORECASE)


def _strip_opener(text: str) -> str:
    """Drop a leading 'In this ... moment,' style clause and re-capitalise."""
    m = _OPENER.match(text)
    if not m:
        return text
    rest = text[m.end():]
    return (rest[0].upper() + rest[1:]) if rest else text


def _chunk_text(text: str):
    """Yield a finished string word-by-word so non-streaming backends (cloud,
    fallback) still type out in the UI rather than appearing all at once."""
    import re
    for part in re.findall(r"\S+\s*", text):
        yield part


def _ollama_stream(prompt: str):
    """Open a streaming generation against Ollama and yield text deltas live.
    The POST is made eagerly so a refused connection raises here (letting the
    caller fall through to the next backend) before any chunk is yielded."""
    import json
    import requests
    model = os.getenv("OLLAMA_MODEL", "granite3.3:8b")
    base = _ollama_base()
    resp = requests.post(
        f"{base}/api/generate",
        json={"model": model, "prompt": prompt, "stream": True, "keep_alive": _KEEP_ALIVE,
              "options": {"temperature": 0.7, "num_predict": 240}},
        stream=True, timeout=180,
    )
    resp.raise_for_status()

    def gen():
        import re
        ender = re.compile(r"[.!?](?=\s)")
        full = ""
        emitted = 0
        header_done = False  # have we dealt with the leading opener yet?
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            piece = obj.get("response", "")
            done = obj.get("done")
            if piece:
                full += piece
                # Hold back the very start until we can see (and strip) any
                # "In this ... moment," opener, then emit from the clean start.
                if not header_done:
                    if "," in full or len(full) >= 80 or done:
                        full = _strip_opener(full)
                        emitted = 0
                        header_done = True
                    else:
                        continue
                hits = list(ender.finditer(full))
                if len(hits) >= 4:  # stop at four complete sentences
                    cut = hits[3].end()
                    seg = full[emitted:cut]
                    if seg:
                        yield _clean_chunk(seg)
                    break
                seg = full[emitted:]
                emitted = len(full)
                if seg:
                    yield _clean_chunk(seg)
            if done:
                break
    return gen()


def _caching_stream(inner, key: str, meta: dict):
    """Wrap a chunk iterator so the FULL streamed text is captured and frozen in
    the prose cache once it finishes naturally. If the client aborts mid-stream
    (rapid clicks) the partial text is NOT cached. Engine-agnostic: it caches
    whatever produced the stream (watsonx / HF / Ollama)."""
    parts, completed = [], False
    try:
        for ch in inner:
            parts.append(ch)
            yield ch
        completed = True
    finally:
        if completed:
            text = "".join(parts).strip()
            if text:
                _EXPLAIN_CACHE[key] = {"text": text, "source": meta["source"], "via": meta.get("via", "")}
                _persist_explain_cache()


def open_stream(frame_context: dict):
    """Returns (meta, chunks). meta = {source, via}; chunks is an iterator of
    text deltas. Mirrors get_explanation's backend preference order, but the
    Ollama path streams real tokens while the others word-chunk a finished
    string. Never raises: always falls through to the local fallback.

    A successful Granite read is frozen in a disk cache keyed by the moment, so a
    moment seen once replays INSTANTLY thereafter on ANY engine (and across
    restarts). The cache is engine-agnostic: it does not matter who generated it."""
    key = _explain_key(frame_context)
    hit = _EXPLAIN_CACHE.get(key)
    if hit:
        return {"source": hit.get("source", "granite"), "via": hit.get("via", "")}, _chunk_text(hit["text"])

    prompt = build_prompt(frame_context)

    # 1) watsonx.ai
    if _credentials_present():
        try:
            text = _granite_generate(prompt)
            if text:
                clean = _strip_opener(_cap_sentences(_clean(text)))
                meta = {"source": "granite", "via": "watsonx.ai"}
                return meta, _caching_stream(_chunk_text(clean), key, meta)
        except Exception as exc:
            print(f"[granite/watsonx] falling back: {exc}")

    # 2) local Granite via Ollama — true token streaming
    if _ollama_available():
        try:
            meta = {"source": "granite", "via": "Ollama"}
            return meta, _caching_stream(_ollama_stream(prompt), key, meta)
        except Exception as exc:
            print(f"[granite/ollama] falling back: {exc}")

    # 4) structured local fallback (NOT cached, so a real engine generates real
    #    prose once it is reachable)
    return {"source": "local", "via": ""}, _chunk_text(_fallback_explanation(frame_context))


def _fallback_explanation(ctx: dict) -> str:
    """Pundit-style explanation composed entirely from the tactical data."""
    player = ctx.get("player_name") or "The player"

    # A kick-off is a forced restart pass, not a decision: set the scene, never
    # critique it as a weak or unambitious choice.
    if ctx.get("is_kickoff"):
        team = ctx.get("team") or "the team"
        restart = ctx.get("kickoff_label") or "the kick-off"
        return (f"{player} gets things going with {restart} for {team}. "
                f"It is simply the restart, a routine ball rolled to a team-mate to "
                f"put the match back in motion, so there is nothing to read into the "
                f"pass itself. Eyes now on what {team} build from here.")

    # Penalties have no open-play options; speak to the moment, not the picture.
    if ctx.get("is_penalty"):
        scored = ctx.get("outcome") == "Goal"
        stage = ctx.get("stage") or "World Cup"
        stakes_level = (ctx.get("stakes_level") or "high").lower()
        if ctx.get("is_shootout"):
            where = f"In the shootout of the {stage}, {player} stepped up with the tie on the line."
        else:
            where = f"{player} stepped up to a penalty in the {stage}, the kind of kick a career is judged on."
        if scored:
            verdict = ("He held his nerve and buried it, the only acceptable "
                       "outcome under that much pressure.")
        else:
            verdict = ("He could not convert, and at this level a missed penalty "
                       "is the harshest swing a player can suffer.")
        close = f"With the stakes {stakes_level}, this was a moment of pure pressure, decided in a single kick."
        return " ".join([where, verdict, close])

    action = (ctx.get("action_type") or "action").lower()
    zone = ctx.get("zone") or "middle third"
    pressure = (ctx.get("pressure") or "UNKNOWN").upper()
    nd = ctx.get("nearest_defender_dist")
    if not isinstance(nd, (int, float)):
        nd = "several"
    open_n = ctx.get("open_teammate_count", 0)
    total_n = ctx.get("teammate_count", 0)
    opp_n = ctx.get("opponent_count", 0)
    outcome = ctx.get("outcome")
    xg = ctx.get("xg")
    tactical = ctx.get("tactical") or {}
    best = tactical.get("best_option")
    quality = tactical.get("decision_quality")
    space = tactical.get("space_ahead")

    sentences = []

    # 1) What he saw
    if pressure == "HIGH":
        seen = (f"Picking the ball up in the {zone}, {player} had a defender "
                f"right on top of him, barely {nd}m away, with {opp_n} "
                f"opponents in his field of view.")
    elif pressure == "MEDIUM":
        seen = (f"In the {zone}, {player} had a moment to lift his head: the "
                f"nearest defender was {nd}m off him, with {opp_n} opponents "
                f"screening the space ahead.")
    else:
        seen = (f"{player} found himself in rare space in the {zone}. The "
                f"nearest defender was a full {nd}m away, with time to pick his option.")
    sentences.append(seen)

    # 2) The options
    if open_n > 0:
        opts = (f"He had {open_n} of {total_n} teammates available through "
                f"clean passing lanes")
        if space and space > 8:
            opts += f", plus {space}m of grass to carry into"
        opts += f", and he chose the {action}."
    else:
        opts = (f"Every one of his {total_n} visible teammates was screened "
                f"off, so the {action} was as much necessity as choice.")
    sentences.append(opts)

    # 3) Was it right?
    if action == "shot" and isinstance(xg, (int, float)):
        scored = outcome == "Goal"
        if xg >= 0.3:
            verdict = (f"At {xg:.2f} expected goals this was a chance to take, "
                       + ("and he took it." if scored
                          else "and at this level it simply has to be buried."))
        elif xg >= 0.08:
            verdict = (f"A speculative effort at {xg:.2f} xG"
                       + (" that paid off handsomely." if scored
                          else ", and the percentages were always against it."))
        else:
            verdict = (f"At just {xg:.2f} xG the numbers screamed for a better option"
                       + (", so the finish was real reward for ambition." if scored
                          else ", and so it proved."))
    elif quality == "optimal":
        verdict = ("Set against every alternative in the frame, this was the "
                   "highest-value option on the pitch. Textbook decision-making.")
    elif quality in ("suboptimal", "poor") and best:
        verdict = (f"The data suggests a better option existed, "
                   f"{best.replace('_', ' ')}, so this goes down as a "
                   f"decision the analysts would question.")
    else:
        verdict = "Given the picture in front of him, it's a sound, low-risk choice."
    sentences.append(verdict)

    # 4) Difficulty
    if outcome in ("Goal",):
        diff = ("Executing under that scrutiny, at World Cup intensity, and "
                "finding the net. That is elite decision-making and execution in one motion.")
    elif pressure == "HIGH":
        diff = ("Make no mistake: with that little time and space, even the "
                "world's best get this wrong more often than they get it right.")
    else:
        diff = ("The positioning tells the story. This was a moment to be "
                "calm, and the difficulty lay in choosing well, not in executing.")
    sentences.append(diff)

    # 5) the stakes — why this moment mattered
    stakes_level = ctx.get("stakes_level")
    stakes_drivers = ctx.get("stakes_drivers") or []
    if stakes_level and stakes_level.lower() not in ("unrated", "low"):
        drivers_txt = ", ".join(str(d).lower() for d in stakes_drivers[:3])
        sentences.append(
            f"And the stakes were {stakes_level.lower()}: {drivers_txt}, "
            f"which only magnifies the weight on this decision."
        )

    return " ".join(sentences)


def get_explanation(frame_context: dict) -> dict:
    """Returns {explanation, source, via}. source is 'granite' (real model) or
    'local' (templated fallback); via names the backend that served it."""
    prompt = build_prompt(frame_context)

    # 1) watsonx.ai, if real credentials are configured
    if _credentials_present():
        try:
            text = _granite_generate(prompt)
            if text:
                return {"explanation": _strip_opener(_cap_sentences(_clean(text))), "source": "granite", "via": "watsonx.ai"}
        except Exception as exc:
            print(f"[granite/watsonx] falling back: {exc}")

    # 2) local Granite via Ollama
    if _ollama_available():
        try:
            text = _ollama_generate(prompt)
            if text:
                return {"explanation": _strip_opener(_cap_sentences(_clean(text))), "source": "granite", "via": "Ollama"}
        except Exception as exc:
            print(f"[granite/ollama] falling back: {exc}")

    # 4) structured local fallback
    return {"explanation": _fallback_explanation(frame_context), "source": "local"}


# Granite as the analyst: AIML-computed assessment (stakes, decision, DNA).
# Granite reasons over ONLY the real StatsBomb facts and returns a strict-JSON,
# range-clamped verdict; low temperature plus a per-moment cache keep a score
# stable. If the model is unreachable or returns junk, source='local' is returned
# and the frontend falls back to its deterministic engine.

ASSESS_RULES = (
    "Use ONLY the facts given. Do not invent players, defenders, numbers or "
    "events. Weigh the factors with an expert's judgment, do not just average "
    "them. No em dashes. Respond with ONLY the JSON object, no prose, no "
    "markdown fences."
)

ASSESS_TEMPLATE = """You are an elite football analyst judging ONE on-ball moment, dimension by dimension.

THE MOMENT
{player} ({team}) attempts a {action_type} in the {zone}, minute {minute} of a World Cup {stage}.
Game state for {team}: {game_state} (match score {scoreline}).
RESULT (ground truth from the data, you must NOT contradict this): {result}{goal_line}

WHAT THE PLAYER FACED (real tracking data)
Pressure: {pressure}. Nearest defender: {nd} m. Open team-mates: {open_n} of {mates} in clear lanes. Opponents in view: {opp}.{xg_line}{prog_line}{beaten_line}

Judge ONLY the action itself, one dimension at a time. Do NOT rate how much the moment mattered (the stage, minute and scoreline are handled separately and you must IGNORE them here): the same action is judged identically in a dead rubber and in a final.

Rate each dimension with an expert's eye, justified by the facts above:
- decision_quality 0-100: was this the BEST available option? Shooting a clear chance or a one-on-one is a correct call (85-100); a speculative shot when a pass was clearly on is poor (30-50); a penalty is the only option so the decision is correct (about 95); picking out a goalscorer or splitting the defence is top (95-100); a simple safe pass is fair (60-70).
- execution 0-100: how well was it STRUCK, from the real outcome. A goal or assist is 90-100. An open-play shot that is ON TARGET and saved is GOOD execution, 70-80 (the keeper beat it, not the striker). A shot OFF target, wide or wayward is poor, 0-15. A blocked shot is about 30. A completed pass is 65-80, an incomplete pass 10-20. A PENALTY missed or saved is poor execution, 0-10 (converting is the baseline).
- difficulty 0-100: how hard was the situation, including technique. A free one-on-one or a tap-in is low (15-30). A first-time volley, an overhead, a tight angle or a defence-splitting ball is high (80-100). A penalty is low (10-20). Difficulty is CONTEXT: it must NEVER excuse a poor outcome.
- vision 0.0-1.0: how much perception was required. A shot needs almost none (about 0.05). A simple sideways pass is low (0.1). A defence-splitting through ball or a cross-field switch is high (0.85-1.0).
- risk 0.0-1.0: the downside if it had failed. A safe back-pass is near 0. A routine shot is about 0.2. A dribble or backheel through traffic, or a through ball into the gaps, is high (0.7-0.95).

Your scores, pros and cons MUST be consistent with the RESULT above. Never describe the action as failing if it succeeded, or as succeeding if it failed.

The pros and cons must describe the QUALITY of the choice and how it was struck, never his environment and never the occasion. Do NOT list "pressure from opponents", "high-pressure area", "no open team-mates", "defender nearby", "tight space", "big moment" or "high stakes" as EITHER a pro or a con. For a shot that did not score, do NOT use "attempted a shot" as a redeeming pro. A con belongs only when the choice or its execution was poor.

Return ONLY this JSON:
{{"decision":{{"decision_quality":0,"execution":0,"difficulty":0,"pros":["short phrase"],"cons":["short phrase"]}},"dna":{{"vision":0.0,"risk":0.0}}}}

{rules}"""


# AI-first variant: instead of pre-chewed facts, the model is handed the raw
# freeze-frame coordinates and must READ the field itself (which lanes are open,
# who is a threat) before scoring. A reasoning_audit chain-of-thought is required;
# the Python Truth Anchor (_validate_assessment) then vetoes any hallucinated
# label and any "viable" target the geometry says was actually blocked.
ASSESS_TEMPLATE_RAW = """You are an elite football TACTICAL ANALYST. You are given the raw freeze-frame positions of every player and must read the field yourself, then judge ONE on-ball moment.

THE MOMENT
{player} ({team}) attempts a {action_type} in the {zone}, minute {minute} of a World Cup {stage}.
Game state for {team}: {game_state} (match score {scoreline}).
RESULT (ground truth from the data, you must NOT contradict this): {result}{goal_line}

FIELD MAP (StatsBomb coordinates: x 0-120 attacking toward the goal at x=120, y 0-80 across; {team} attacks toward x=120)
{field_map}{xg_line}

STEP 1 - READ THE FIELD (reasoning_audit). Using the coordinates ONLY:
- threats: list the labels of the 2 to 4 opponents (e.g. D1, D4, GK) close enough to pressure the ball or sit in the dangerous passing lanes.
- viable_targets: list the labels of the team-mates (e.g. T2, T5) who could ACTUALLY be reached now, i.e. no opponent sits between them and the ball cutting the lane. Use an empty list [] only if truly none are reachable.
Copy the EXACT labels from the FIELD MAP above into these lists. Do NOT output the placeholders "D#"/"T#", do not invent labels, and do not leave the reasoning in the note instead of the lists.

STEP 2 - JUDGE THE ACTION, one dimension at a time. Ignore the stage, minute and scoreline (handled separately): the same action is judged identically in a dead rubber and in a final.
- decision_quality 0-100: was this the BEST available option given your viable_targets? Shooting a clear chance or a one-on-one is a correct call (85-100); a speculative shot when a viable pass was clearly on is poor (30-50); a penalty is the only option so the decision is correct (about 95); picking out a goalscorer or splitting the defence is top (95-100); a simple safe pass is fair (60-70).
- execution 0-100: how well it was STRUCK, from the real outcome. A goal or assist is 90-100. An open-play shot ON TARGET and saved is GOOD, 70-80 (the keeper beat it, not the striker). A shot OFF target is poor, 0-15. A blocked shot is about 30. A completed pass is 65-80, an incomplete pass 10-20. A PENALTY missed or saved is poor, 0-10.
- difficulty 0-100: how hard the situation was, including technique. A free one-on-one or tap-in is low (15-30). A first-time volley, overhead, tight angle or defence-splitting ball is high (80-100). A penalty is low (10-20). Difficulty is CONTEXT: it must NEVER excuse a poor outcome.
- vision 0.0-1.0: how much perception the picture above demanded. A shot needs almost none (about 0.05). A simple sideways pass is low (0.1). A defence-splitting through ball or cross-field switch is high (0.85-1.0).
- risk 0.0-1.0: the downside had it failed, given the opponents around the ball. A safe back-pass is near 0. A routine shot is about 0.2. A dribble or pass through traffic is high (0.7-0.95).

Your scores, pros and cons MUST be consistent with the RESULT above; never describe a success as a failure or a failure as a success. The pros and cons describe the QUALITY of the choice and how it was struck, never the environment and never the occasion: do NOT list pressure, space, a nearby defender, tight space, a big moment or high stakes as a pro or a con.

Return ONLY this JSON (replace the example labels D1/D4/T2 with the real labels you chose from the FIELD MAP):
{{"reasoning_audit":{{"threats":["D1","D4"],"viable_targets":["T2"],"note":"one sentence on the picture you read"}},"decision":{{"decision_quality":0,"execution":0,"difficulty":0,"pros":["short phrase"],"cons":["short phrase"]}},"dna":{{"vision":0.0,"risk":0.0}}}}

{rules}"""


def _result_phrase(ctx: dict) -> str:
    """A plain-English statement of what actually happened, from the real outcome,
    so the model cannot invent a different result."""
    t = ctx.get("action_type")
    o = (ctx.get("outcome") or "").strip()
    p = ctx.get("player_name") or "He"
    if ctx.get("is_penalty") or ctx.get("shot_type") == "Penalty":
        where = "in the shootout" if ctx.get("is_shootout") else ""
        if o == "Goal":
            return f"{p} CONVERTED the penalty {where} (expected to score)."
        return f"the penalty {where} was MISSED / SAVED, NO goal (a costly failure)."
    if t == "Shot":
        if o == "Goal":
            return f"{p} SCORED a goal."
        if o in ("Saved", "Saved To Post"):
            return "the shot was ON TARGET but SAVED by the keeper, NO goal."
        if o == "Post":
            return "the shot hit the woodwork, NO goal."
        if o == "Blocked":
            return "the shot was BLOCKED, NO goal."
        return "the shot MISSED the target, NO goal (a wasted chance)."
    if t == "Pass":
        if o != "Complete":
            return "the pass FAILED to reach a team-mate (possession lost)."
        if ctx.get("goal_assist"):
            return ("the pass was an ASSIST that DIRECTLY set up a GOAL: the best "
                    "outcome a pass can have (elite decision and execution).")
        if ctx.get("shot_assist"):
            return "the pass was a KEY PASS that created a clear SHOT for a team-mate (success)."
        return "the pass was COMPLETED to a team-mate (success)."
    if t == "Dribble":
        return f"{p} beat his man (success)." if o == "Complete" \
            else f"{p} was dispossessed (failed)."
    if t == "Carry":
        return f"{p} carried the ball (kept possession)."
    if t == "Interception":
        return "he won the ball (success)." if o not in ("Lost", "Lost In Play", "Lost Out") \
            else "he stepped in but did NOT win the ball (failed)."
    return f"outcome: {o or 'unknown'}."


def _field_map(ctx: dict):
    """Turn the raw freeze-frame into a labelled coordinate Field Map for the AI,
    plus a registry the Truth Anchor uses to veto hallucinations and geometry lies.

    Labels are assigned DETERMINISTICALLY (team-mates T1.. by forward progress,
    opponents D1.. by distance to the ball, the keeper GK) so the same moment
    always produces the same map and the same cache key. Team-mate viability comes
    from the real lane geometry (tactical_analysis), so the model's "viable_targets"
    can be checked against physics. Returns {text, registry, labels} or None."""
    players = ctx.get("players")
    if not isinstance(players, list) or len(players) < 3:
        return None
    actor = next((p for p in players if p.get("actor")), None)
    actor_loc = (actor or {}).get("location") or ctx.get("event_location")
    if not (isinstance(actor_loc, (list, tuple)) and len(actor_loc) >= 2):
        return None

    import tactical_analysis as ta
    tac = ta.analyze_frame(players, list(actor_loc), ctx.get("action_type"), None)

    # team-mates with geometric viability (open lane vs blocked lane)
    tms = [(o, True) for o in tac.get("open_passing_options", [])] \
        + [(o, False) for o in tac.get("blocked_options", [])]
    tms.sort(key=lambda t: (-t[0]["forward_progress"], t[0]["location"][0], t[0]["location"][1]))

    def _name_at(loc):
        # the real player name of the freeze-frame dot at this spot, so the field
        # read can say "Tchouaméni" instead of the internal label "D1".
        for pp in players:
            pl = pp.get("location")
            if (isinstance(pl, (list, tuple)) and len(pl) >= 2
                    and abs(pl[0] - loc[0]) < 0.6 and abs(pl[1] - loc[1]) < 0.6):
                return pp.get("player_name")
        return None

    registry, t_lines = {}, []
    for i, (o, viable) in enumerate(tms, 1):
        label, loc = f"T{i}", o["location"]
        pos = o.get("position")
        t_lines.append(f"{label} at ({loc[0]:.0f},{loc[1]:.0f})" + (f" [{pos}]" if pos else ""))
        registry[label] = {"loc": loc, "viable": viable, "kind": "teammate",
                           "name": o.get("player_name") or _name_at(loc)}

    # opponents (+ keeper), nearest the ball first
    opps = [p for p in players if not p.get("teammate")
            and isinstance(p.get("location"), (list, tuple))]
    opps.sort(key=lambda p: (ta._dist(actor_loc, p["location"]), p["location"][0], p["location"][1]))
    d_lines, di, gk_used = [], 0, False
    for p in opps:
        loc = p["location"]
        if p.get("keeper") and not gk_used:
            label, gk_used = "GK", True
        else:
            di += 1
            label = f"D{di}"
        d_lines.append(f"{label} at ({loc[0]:.0f},{loc[1]:.0f}) [{ta._dist(actor_loc, loc):.0f}m]")
        registry[label] = {"loc": loc, "viable": None, "kind": "opponent",
                           "name": p.get("player_name") or _name_at(loc)}

    if not t_lines and not d_lines:
        return None
    name = ctx.get("player_name") or "the ball carrier"
    text = (f"ACTOR: {name} at ({actor_loc[0]:.0f},{actor_loc[1]:.0f}).\n"
            f"Team-mates: {('; '.join(t_lines)) or 'none in view'}.\n"
            f"Opponents: {('; '.join(d_lines)) or 'none in view'}.")
    return {"text": text, "registry": registry, "labels": set(registry) | {"ACTOR"}}


def _build_assess_prompt(ctx: dict, fmap: dict | None = None) -> str:
    xg = ctx.get("xg")
    xg_line = f" Shot quality (xG): {xg:.2f}." if isinstance(xg, (int, float)) else ""
    prog = ctx.get("forward_progress")
    if isinstance(prog, (int, float)):
        if prog > 3:
            prog_line = f" Ball moved {round(prog)} m up the pitch."
        elif prog < -3:
            prog_line = f" Ball played {abs(round(prog))} m backward (a safe, retaining ball)."
        else:
            prog_line = " A short, sideways ball with little forward progress."
    else:
        prog_line = ""
    beaten = ctx.get("defenders_bypassed")
    beaten_line = f" Took {beaten} defender(s) out of the game." if isinstance(beaten, int) and beaten >= 1 else ""
    goal_effect = ctx.get("goal_effect")
    goal_line = f" This goal {goal_effect}." if goal_effect else ""
    fields = {
        "player": ctx.get("player_name") or "The player",
        "team": ctx.get("team") or "his team",
        "action_type": ctx.get("action_type") or "action",
        "zone": ctx.get("zone") or "middle third",
        "minute": ctx.get("minute", "?"),
        "stage": ctx.get("stage") or "match",
        "game_state": ctx.get("game_state") or ctx.get("scoreline") or "unknown",
        "scoreline": ctx.get("scoreline") or "unknown",
        "outcome": ctx.get("outcome") or "Unknown",
        "result": _result_phrase(ctx),
        "goal_line": goal_line,
        "pressure": ctx.get("pressure") or "UNKNOWN",
        "nd": ctx.get("nearest_defender_dist", "?"),
        "open_n": ctx.get("open_teammate_count", 0),
        "mates": ctx.get("teammate_count", 0),
        "opp": ctx.get("opponent_count", 0),
        "xg_line": xg_line,
        "prog_line": prog_line,
        "beaten_line": beaten_line,
        "rules": ASSESS_RULES,
    }
    # AI-first path: hand the model the raw coordinate Field Map and let it read
    # the lanes/threats itself. Fall back to the pre-chewed facts only when there
    # is no usable freeze frame (extra fields are ignored by the formatter).
    if fmap and fmap.get("text"):
        fields["field_map"] = fmap["text"]
        return _render(ASSESS_TEMPLATE_RAW, fields)
    return _render(ASSESS_TEMPLATE, fields)


def _complete(prompt: str, max_tokens: int, temperature: float,
              fmt: str | None = None, ollama_model: str | None = None):
    """Run the backend preference chain for a one-shot completion. Returns
    (text, via) or (None, None) if no backend is reachable."""
    if _credentials_present():
        try:
            return _granite_generate(prompt, max_tokens, temperature), "watsonx.ai"
        except Exception as exc:
            print(f"[assess/watsonx] falling back: {exc}")
    if _ollama_available():
        try:
            return _ollama_generate(prompt, max_tokens, temperature, fmt=fmt,
                                    model=ollama_model), "Ollama"
        except Exception as exc:
            print(f"[assess/ollama] falling back: {exc}")
    return None, None


def _extract_json(text: str) -> dict:
    """Pull the first JSON object out of a model response, tolerating markdown
    fences or stray prose around it."""
    import json
    s = text.strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1] if "```" in s[3:] else s[3:]
        if s.lstrip().startswith("json"):
            s = s.lstrip()[4:]
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object in response")
    blob = s[start:end + 1]
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        # tolerate the common small-model slips: trailing commas before a closing
        # brace/bracket, and stray newlines, then retry once.
        import re as _rj
        fixed = _rj.sub(r",\s*([}\]])", r"\1", blob)
        return json.loads(fixed)


def _clampi(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(round(float(v)))))
    except (TypeError, ValueError):
        return default


def _clampf(v, default=0.4):
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return default


def _decision_label(score: int) -> str:
    return "Outstanding" if score >= 80 else "Good" if score >= 65 else "Reasonable" if score >= 45 else "Poor"


def _geometric_difficulty(ctx: dict):
    """Difficulty as a GEOMETRIC fact, computed from the real freeze-frame instead
    of the model's guess (the model rates it inconsistently). Overrides Granite's
    difficulty when the geometry is available; returns None otherwise (carries,
    dribbles, etc. keep the model's value).

      * Shot  - read from xG, a calibrated model of distance, angle, pressure and
        the keeper: a low-xG finish is, by definition, a hard chance. A 0.03 xG
        goal from outside the box is elite-hard (~90), a tap-in is easy (~15).
        Falls back to raw distance from goal if xG is missing.
      * Pass  - how far the ball travelled and how many opponents it played
        THROUGH: a line-splitting through ball past seven defenders is ~98, a
        short ball past no one is low.
      * Carry - how far the player drove the ball, how much of that was FORWARD
        progress, how many opponents he ran past and the pressure he did it under:
        a 50m solo run up the pitch beating defenders is elite-hard, a 5m touch is
        trivial."""
    import math
    t = ctx.get("action_type")
    if t == "Shot":
        xg = ctx.get("xg")
        if isinstance(xg, (int, float)) and xg > 0:
            d = 15.6 - 21.2 * math.log(max(xg, 0.005))   # difficulty rises as xG falls
            return int(max(12, min(96, round(d))))
        dist = ctx.get("shot_distance")
        if isinstance(dist, (int, float)):
            return int(max(15, min(95, round(8 + dist * 3.0))))
        return None
    if t == "Pass":
        length = ctx.get("pass_length")
        if not isinstance(length, (int, float)):
            return None
        bypassed = ctx.get("defenders_bypassed") or 0
        through = ctx.get("pass_technique") == "Through Ball"
        d = 22 + min(bypassed, 8) * 8 + min(length, 45) * 0.6 + (10 if through else 0)
        return int(max(10, min(98, round(d))))
    if t == "Carry":
        dist = ctx.get("carry_distance")
        if not isinstance(dist, (int, float)):
            return None
        prog = ctx.get("forward_progress") or 0
        bypassed = ctx.get("defenders_bypassed") or 0
        pressure = ctx.get("pressure")
        d = 18 + min(dist, 60) * 0.7 + max(prog, 0) * 0.35 + min(bypassed, 6) * 7
        d += 8 if pressure == "HIGH" else 4 if pressure == "MEDIUM" else 0
        return int(max(10, min(95, round(d))))
    return None


def _compose_action_quality(dq: int, ex: int, diff: int) -> int:
    """Combine Granite's three per-dimension JUDGMENTS into the Action Quality
    score with a transparent formula (same as the frontend engine). This is
    arithmetic over Granite's judgment, not a judgment itself: decision quality,
    gated by execution, with a bonus only for difficulty that was actually
    overcome (difficulty * execution) so a hard MISS gets no credit for being
    hard. Stage/minute/scoreline blind by construction."""
    dqf, exf, dff = dq / 100.0, ex / 100.0, diff / 100.0
    aq = dqf * (0.2 + 0.8 * exf) + dff * exf * 0.22
    return max(5, min(99, round(aq * 100)))


# phrases that describe the SITUATION, not a fault in the decision — these must
# never appear as decision cons (the model still slips them in despite the rubric)
_ENV_CON_MARKERS = (
    "pressure", "no option", "few option", "limited option", "lack of option",
    "without option", "no clear option", "no passing option", "no open",
    "no team-mate", "no teammate", "few team-mate", "few teammate",
    "tight space", "little space", "no space", "limited space", "lack of space",
    "congest", "crowded", "surrounded", "outnumbered", "closely marked",
    "tightly marked", "defender near", "nearby defender", "close defender",
    "marked by", "hemmed", "boxed in", "difficult position", "tough position",
)


def _sanitize_cons(cons: list) -> list:
    """Strip cons that merely describe the environment he was in (pressure, lack
    of options, tight space) rather than a flaw in the decision itself."""
    out = []
    for c in cons:
        if any(m in c.lower() for m in _ENV_CON_MARKERS):
            continue
        out.append(c)
    return out


# environment is context, not a virtue either — strip it from pros so a miss is
# never propped up by "in a high-pressure area" or "attempted a shot"
_ENV_PRO_MARKERS = _ENV_CON_MARKERS + ("attempted a shot", "attempted shot", "took a shot")


def _sanitize_pros(pros: list) -> list:
    out = []
    for p in pros:
        if any(m in p.lower() for m in _ENV_PRO_MARKERS):
            continue
        out.append(p)
    return out


# claims that an action FAILED / SUCCEEDED — used to strip lines that contradict
# the real outcome (the model sometimes invents an interception on a completed
# pass, etc.)
_FAIL_CLAIMS = (
    "intercept", "lost", "gave away", "give away", "turnover", "dispossess",
    "failed", "incomplete", "off target", "off-target", "blocked", "saved",
    "missed", "wayward", "did not find", "didn't find", "didn t find",
    "overhit", "underhit", "went wide", "over the bar", "conceded",
)
_SUCCESS_CLAIMS = (
    "scored", "found the net", "assist", "completed successfully", "buried",
    "converted", "beat his man", "won the ball", "goal scored",
)
# claims that call the STRIKE itself poor: invalid for an on-target shot or a near
# miss, which by definition was well struck (it forced a save or nearly went in).
_POOR_STRIKE_CLAIMS = (
    "off target", "off-target", "missed the target", "wayward", "poor execution",
    "poorly executed", "poor strike", "inaccurate", "lacked accuracy",
    "lack of accuracy", "overhit", "underhit", "went wide", "skied", "ballooned",
)


def _action_succeeded(ctx: dict):
    """True/False if the real outcome makes success unambiguous, else None."""
    t = ctx.get("action_type")
    o = (ctx.get("outcome") or "").strip()
    if t == "Shot":
        return o == "Goal"
    if t in ("Pass", "Dribble"):
        return o == "Complete"
    if t in ("Carry", "Pressure", "Clearance", "Block", "Goal Keeper"):
        return True
    if t == "Interception":
        return o not in ("Lost", "Lost In Play", "Lost Out")
    return None


def _drop_contradictions(items: list, banned: tuple) -> list:
    return [x for x in items if not any(b in x.lower() for b in banned)]


# Internal field-map labels (D1, T2, GK) must never reach the user: swap them for
# the real player names, and scrub any that still slip through with a generic noun.
def _label_name_map(fmap) -> dict:
    if not (isinstance(fmap, dict) and fmap.get("registry")):
        return {}
    reg = fmap["registry"]
    return {l: reg[l]["name"] for l in reg if reg[l].get("name")}


def _swap_labels(text: str, name_map: dict) -> str:
    if not text or not name_map:
        return text
    for lbl in sorted(name_map, key=len, reverse=True):   # longest first: D10 before D1
        text = _re.sub(r"\b" + _re.escape(lbl) + r"\b", name_map[lbl], text)
    return text


_LABEL_SCRUB = [
    (_re.compile(r"\bT\d+\b"), "a team-mate"),
    (_re.compile(r"\bD\d+\b"), "a defender"),
    (_re.compile(r"\bGK\b"), "the goalkeeper"),
]


def _scrub_labels(text: str) -> str:
    """Final safety net: replace any field-map label that survived name-mapping
    (e.g. the model invented one not in the map) with a generic noun, so wording
    like 'chosen target T2' can never reach the UI."""
    if not text:
        return text
    for pat, repl in _LABEL_SCRUB:
        text = pat.sub(repl, text)
    return text


def _audit_truth_anchor(raw_audit, fmap) -> dict | None:
    """Veto the model's field-reading against physics (the 20% Math):
      * HALLUCINATION CHECK: drop any player label the model cites that is not in
        the actual Field Map.
      * GEOMETRY VETO: drop any 'viable_target' the lane geometry says was blocked
        (an opponent is cutting the lane) - the model cannot claim an impossible
        pass was on. Vetoed targets are kept separately so the UI can show them."""
    if not (isinstance(raw_audit, dict) and fmap):
        return None
    labels, reg = fmap["labels"], fmap["registry"]
    threats = [l for l in (raw_audit.get("threats") or []) if isinstance(l, str) and l in labels]
    targets = [l for l in (raw_audit.get("viable_targets") or []) if isinstance(l, str) and l in labels]
    vetoed = [l for l in targets if reg.get(l, {}).get("viable") is False]
    targets = [l for l in targets if reg.get(l, {}).get("viable") is not False]
    # Swap the internal field-map labels (D1, T2, GK) for the real player names, so
    # the field read reads like a human ("pressed by Tchouaméni and Koundé") rather
    # than "by D1 and D4", scrubbing any label that slipped through unmapped.
    note = _scrub_labels(_swap_labels(
        _clean(str(raw_audit.get("note") or "").strip()), _label_name_map(fmap)))
    audit = {
        "threats": threats[:6],
        "viable_targets": targets[:6],
        "note": note[:200],
    }
    if vetoed:
        audit["vetoed_targets"] = vetoed[:4]   # claimed open, but the lane was blocked
    return audit


def _validate_assessment(raw: dict, game_state: str | None = None,
                         succeeded: bool | None = None, is_goal: bool = False,
                         is_penalty: bool = False, on_target_chance: bool = False,
                         is_assist: bool = False, is_key_pass: bool = False,
                         is_routine_pass: bool = False, fmap: dict | None = None,
                         geo_difficulty: int | None = None,
                         is_progressive_carry: bool = False,
                         well_placed_save: bool = False,
                         poor_placement_save: bool = False,
                         is_kickoff: bool = False) -> dict:
    """Shape Granite's per-dimension JUDGMENT into the assessment.

    Granite supplies the judgment (decision_quality, execution, difficulty, vision,
    risk); this function does only what the model can't be trusted to do reliably:
      * compose Action Quality from the three sub-scores (transparent arithmetic),
      * apply truth floors/caps that encode football facts (a goal IS a success;
        a missed penalty IS a failure) so a model slip can't invert a result,
      * clamp to ranges and re-derive the text labels (presentational),
      * strip lines that contradict the ground-truth outcome,
      * reuse the SAME execution/difficulty value in both Action Quality and the
        DNA radar (single source of truth) so the panels can never disagree.
    STAKES is NOT taken from Granite here (the model rates it unreliably); the
    frontend's deterministic stakes engine owns it, and the DNA leverage axis is
    filled from that on the frontend."""
    de = raw.get("decision") or {}
    dna = raw.get("dna") or {}

    # Granite's three per-dimension judgments, clamped.
    dq = _clampi(de.get("decision_quality"), 0, 100, 55)
    ex = _clampi(de.get("execution"), 0, 100, 45)
    diff = _clampi(de.get("difficulty"), 0, 100, 40)

    # Difficulty is a geometric fact, not a judgment: when the freeze-frame gives
    # us the real geometry (shot xG / pass length + defenders bypassed), that
    # deterministic value REPLACES the model's guess. The penalty/routine caps
    # below still clamp it where the situation is inherently easy.
    if geo_difficulty is not None:
        diff = geo_difficulty

    # Truth floors/caps: football facts the model occasionally fumbles.
    if is_kickoff:
        # a kick-off MUST be a pass (Laws of the Game): there is no carry/drive
        # alternative, so the choice is correct by definition and the situation is
        # trivial. Never let it read as a missed chance to "be more ambitious".
        dq = max(dq, 88)
        ex = max(ex, 82) if succeeded else min(ex, 45)
        diff = min(diff, 10)
    elif is_penalty:
        ex = min(max(ex, 88), 100) if succeeded else min(ex, 8)
        dq = max(dq, 90)            # taking the penalty is the correct call
        diff = min(diff, 25)        # a penalty is not a hard situation
    elif is_goal:
        ex = max(ex, 90)            # a goal is the action coming off
    elif is_assist:
        # an assist that directly created a goal is the best outcome a pass can
        # have: it executed perfectly and was a top-tier decision.
        ex = max(ex, 93)
        dq = max(dq, 95)
    elif is_key_pass:
        ex = max(ex, 78)           # created a clear shot
        dq = max(dq, 85)
    elif well_placed_save:
        ex = max(ex, 82)            # struck into the corner, beaten only by a fine save
        dq = max(dq, 85)            # going for goal there was the right call
    elif poor_placement_save:
        ex = min(ex, 42)            # hit too near the keeper, a comfortable save
    elif on_target_chance:
        ex = max(ex, 72)            # on target, forced a save = good execution
        dq = max(dq, 85)            # shooting a clear chance is a correct call
    elif is_progressive_carry:
        ex = max(ex, 80)            # drove the ball a long way and kept it = well executed
        dq = max(dq, 75)            # taking on the space was the right, brave call
    elif is_routine_pass:
        # a short sideways/backward ball that took out no one is not hard, not
        # visionary, and a fair-but-unremarkable decision: keep it modest. Cap
        # execution too (the model over-rewards "completed" so a 5m pass doesn't
        # read as elite striking), so a safe pass lands in the "Reasonable" band.
        dq = min(dq, 68)
        ex = min(ex, 72)
        diff = min(diff, 20)

    d_score = _compose_action_quality(dq, ex, diff)
    if is_goal or is_assist:
        d_score = max(d_score, 85)          # a goal or assist is never mediocre
    elif is_penalty:
        d_score = min(max(d_score, 70), 82) if succeeded else min(max(d_score, 25), 33)
    elif well_placed_save:
        d_score = max(d_score, 70)          # a corner-bound strike denied by a save is a good action
    elif is_progressive_carry:
        d_score = max(d_score, 68)          # a big driving run is never just "Reasonable"
    elif succeeded is True:
        # a clean, completed action (kept/advanced possession, beat a man, won the
        # ball) is a SUCCESS - unremarkable maybe, but never "Poor". "Poor" is
        # reserved for failures and clearly bad gambles; a routine success floors
        # into the "Reasonable" band so normal play never reads as red.
        d_score = max(d_score, 52)

    def _phrases(v):
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()][:4]
        return [str(v).strip()] if v else []

    pros = _sanitize_pros(_phrases(de.get("pros")))
    cons = _sanitize_cons(_phrases(de.get("cons")))
    # never let the reasoning contradict the real result (truth, not scoring)
    if succeeded is True:
        cons = _drop_contradictions(cons, _FAIL_CLAIMS)
    elif succeeded is False:
        pros = _drop_contradictions(pros, _SUCCESS_CLAIMS)
    # an on-target shot or a near miss was well struck: a "poor execution / missed
    # the target / wayward" con contradicts that, so drop it.
    if on_target_chance:
        cons = _drop_contradictions(cons, _POOR_STRIKE_CLAIMS)
    # a goal (or a goal assist, or a converted penalty) is the best possible
    # outcome: the choice was vindicated, so a "could have done better / found a
    # team-mate / better option" critique is invalid. Drop cons for these.
    if is_goal or is_assist or (is_penalty and succeeded):
        cons = []

    # a penalty is one on one with the keeper: the reasoning is simply the result,
    # not a lanes/defenders/team-mate read. Force a single clear line.
    if is_penalty:
        if succeeded:
            pros, cons = ["Penalty converted"], []
        else:
            pros, cons = [], ["Penalty not converted"]

    # a kick-off is a forced pass to restart play, not a judgement call: never
    # critique it (no "should have carried / been more ambitious"). State it plainly.
    if is_kickoff:
        pros, cons = (["Kick-off, restarted play cleanly"] if succeeded
                      else ["Kick-off taken"]), []

    # field-map labels (T2, D4, GK) are internal: name them, or scrub to a generic
    # noun, so the reasoning never shows wording like "chosen target T2".
    _nm = _label_name_map(fmap)
    pros = [_scrub_labels(_swap_labels(p, _nm)) for p in pros]
    cons = [_scrub_labels(_swap_labels(c, _nm)) for c in cons]

    audit = _audit_truth_anchor(raw.get("reasoning_audit"), fmap)

    return {
        "reasoning_audit": audit,
        "decision": {
            "score": d_score,
            "label": _decision_label(d_score),
            "components": {"decision": dq, "execution": ex, "difficulty": diff},
            "pros": pros,
            "cons": cons,
        },
        "dna": {
            # difficulty/execution reuse the Action Quality sub-scores Granite
            # gave; vision/risk are Granite's own axes. leverage is omitted so the
            # frontend fills it from the deterministic stakes (single source).
            "difficulty": diff / 100.0,
            "execution": ex / 100.0,
            "vision": min(_clampf(dna.get("vision")), 0.2) if is_routine_pass else _clampf(dna.get("vision")),
            "risk": _clampf(dna.get("risk")),
        },
    }


# Per-moment cache so a given moment is scored by Granite EXACTLY ONCE and then
# frozen forever. Combined with temperature-0 decoding this is what makes the
# assessment 100% consistent: the same moment can never show a different verdict,
# even across server restarts, because the first Granite verdict is persisted to
# disk and replayed thereafter.
_CACHE_DIR = os.path.join(os.path.dirname(__file__), ".firsttouch_cache")
_CACHE_FILE = os.path.join(_CACHE_DIR, "assess_cache.json")


def _load_assess_cache() -> "dict[str, dict]":
    try:
        import json
        with open(_CACHE_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


_ASSESS_CACHE: "dict[str, dict]" = _load_assess_cache()


def _persist_assess_cache() -> None:
    try:
        import json
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(_CACHE_FILE, "w", encoding="utf-8") as fh:
            json.dump(_ASSESS_CACHE, fh)
    except Exception as exc:
        print(f"[assess] could not persist cache: {exc}")


# Victor's prose cache — same engine-agnostic disk approach as the assessment, so
# a moment's written read is generated once (by ANY backend) then replayed
# instantly thereafter, including across restarts and for every visitor.
_EXPLAIN_FILE = os.path.join(_CACHE_DIR, "explain_cache.json")
_EXPLAIN_VERSION = "ex-v17"  # ex-v17: dedicated kick-off template (correct half, scene-setting only, no decision critique)


def _load_explain_cache() -> "dict[str, dict]":
    try:
        import json
        with open(_EXPLAIN_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


_EXPLAIN_CACHE: "dict[str, dict]" = _load_explain_cache()


def _persist_explain_cache() -> None:
    try:
        import json
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(_EXPLAIN_FILE, "w", encoding="utf-8") as fh:
            json.dump(_EXPLAIN_CACHE, fh)
    except Exception as exc:
        print(f"[explain] could not persist cache: {exc}")


def _explain_key(ctx: dict) -> str:
    import json
    # the analyst language is part of the identity of a read: each persona/language
    # is generated and frozen separately, so switching language re-narrates.
    lang = (ctx.get("lang") or analyst_personas.DEFAULT_LANG).lower()
    mid, eid = ctx.get("match_id"), ctx.get("event_id")
    if mid is not None and eid:
        return hashlib.sha1(f"explain:{mid}:{eid}:{lang}:{_EXPLAIN_VERSION}".encode()).hexdigest()
    keys = ("player_name", "team", "action_type", "minute", "stage", "scoreline",
            "outcome", "pressure", "nearest_defender_dist", "open_teammate_count",
            "teammate_count", "opponent_count", "xg", "goal_effect",
            "is_penalty", "is_shootout")
    payload = {k: ctx.get(k) for k in keys}
    payload["_v"] = _EXPLAIN_VERSION
    payload["lang"] = lang
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha1(blob.encode()).hexdigest()


# Bump when the prompt/schema changes so old cached verdicts are not replayed
# under new semantics. (v5 = routine-pass cap + pass distance fed to Granite.)
_ASSESS_VERSION = "v24"  # v24: scrub field-map labels (T2/D4/GK) in pros/cons; kick-off treated as a forced pass (no carry critique)


def _assess_key(ctx: dict) -> str:
    import json
    # A moment is uniquely identified by (match_id, event_id). Keying on that is
    # robust and means a moment computed ONCE (live OR by the precompute) is
    # served to every visitor and across restarts. Falls back to a field hash for
    # any caller that does not send the ids (back-compat).
    mid, eid = ctx.get("match_id"), ctx.get("event_id")
    if mid is not None and eid:
        return hashlib.sha1(f"assess:{mid}:{eid}:{_ASSESS_VERSION}".encode()).hexdigest()
    keys = ("player_name", "team", "action_type", "minute", "stage", "scoreline",
            "outcome", "pressure", "nearest_defender_dist", "open_teammate_count",
            "teammate_count", "opponent_count", "xg", "goal_effect",
            "goal_assist", "shot_assist", "defenders_bypassed")
    payload = {k: ctx.get(k) for k in keys}
    payload["_v"] = _ASSESS_VERSION
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha1(blob.encode()).hexdigest()


# What-If: Granite's verdict over the real, ranked option table.
# whatif.enumerate_options() does the maths (xT-added per option, xG for a shot) —
# ground truth. Granite only judges that table (right call? road not taken?).
# Cached per moment like the assessment so a given what-if is stable.

_WHATIF_FILE = os.path.join(_CACHE_DIR, "whatif_cache.json")
_WHATIF_VERSION = "w-v13"  # v13: point-reflected opponent shape in positional inference -> correct side/identity for inferred players


def _load_whatif_cache() -> "dict[str, dict]":
    try:
        import json
        with open(_WHATIF_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


_WHATIF_CACHE: "dict[str, dict]" = _load_whatif_cache()


def _persist_whatif_cache() -> None:
    try:
        import json
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(_WHATIF_FILE, "w", encoding="utf-8") as fh:
            json.dump(_WHATIF_CACHE, fh)
    except Exception as exc:
        print(f"[whatif] could not persist cache: {exc}")


def _whatif_key(ctx: dict) -> str:
    lang = (ctx.get("lang") or analyst_personas.DEFAULT_LANG).lower()
    mid, eid = ctx.get("match_id"), ctx.get("event_id")
    if mid is not None and eid:
        return hashlib.sha1(f"whatif:{mid}:{eid}:{lang}:{_WHATIF_VERSION}".encode()).hexdigest()
    return hashlib.sha1(f"whatif:{ctx.get('player_name')}:{ctx.get('minute')}:{lang}:{_WHATIF_VERSION}".encode()).hexdigest()


WHATIF_RULES = (
    "Use ONLY the numbers given. Do not invent options, players or values. No em "
    "dashes. Respond with ONLY the JSON object, no prose, no markdown fences."
)

WHATIF_TEMPLATE = """{persona}

You are writing the short WHAT-IF verdict on one on-ball decision: was it the right call, and what was the road not taken.

THE MOMENT
{player} ({team}) chose: {chosen_label}, worth {chosen_val}.
Zone: {zone}. Pressure: {pressure}. Nearest defender: {nd} m. Outcome: {outcome}.

EVERY OPTION HE HAD, valued by expected threat added (xT) or estimated xG, best first:
{options_block}
{best_note}

A higher-xT ball only counts as a real alternative if its lane was VIABLE. A pass tagged "lane blocked" was NOT available, so never describe it as viable, open, or on. The analysis has already decided the verdict from the numbers:

VERDICT: {verdict_class} - {verdict_meaning}

Write a headline and detail that JUSTIFY this exact verdict using only the numbers above (ignore the stage, minute and scoreline). Do not contradict it. If the verdict is forced, make clear the genuinely better ball was blocked and the player was left with a low-value best-of-what-remained, so do NOT call it a great or optimal choice. If the verdict is optimal, say plainly it was the best ball on.

Write the headline and detail in your own analyst voice. {language_line} Return ONLY this JSON:
{{"headline":"max 8 words, no score","detail":"one or two sentences naming the road not taken and why"}}

{rules}"""

# plain-language meaning of each deterministic verdict class, fed to Granite so its
# prose matches the engine's call instead of re-deciding it
WHATIF_MEANING = {
    "optimal": "this was the best available ball; no open option came close to beating it",
    "forced": "a clearly better ball existed but its lane was BLOCKED, so the player was forced into the best of what was left, even though it was a low-value action",
    "solid": "a defensible choice; the gains elsewhere were marginal or too risky",
    "better_available": "a clearly higher-value, VIABLE option was open and not taken",
}


def _fmt_opt_value(o: dict) -> str:
    v = o.get("value")
    if not isinstance(v, (int, float)):
        return "n/a"
    if o.get("value_kind") == "xG":
        return f"{v:.2f} xG (est)"
    return f"{v:.3f} xT"   # absolute threat of the position the ball reaches


def _build_whatif_prompt(ctx: dict, whatif: dict) -> str:
    opts = whatif.get("options", [])
    lines = []
    for o in opts[:7]:
        tag = []
        if o.get("chosen"):
            tag.append("CHOSEN")
        if o.get("best"):
            tag.append("best alternative")
        if o.get("blocked"):
            tag.append("lane blocked")
        suffix = f" [{', '.join(tag)}]" if tag else ""
        lines.append(f"- {o.get('label')}: {_fmt_opt_value(o)}{suffix}")
    summary = whatif.get("summary", {})
    if summary.get("best_label") and isinstance(summary.get("delta"), (int, float)) and summary["delta"] > 0:
        best_note = (f"The highest-value alternative was {summary['best_label']}, "
                     f"{summary['delta']:+.3f} xT more than the option taken.")
    elif summary.get("blocked_best_label"):
        best_note = (f"The most dangerous ball, the pass to {summary['blocked_best_label']}, "
                     f"was BLOCKED, so it was never on; the player was left with the best of "
                     f"what remained.")
    else:
        best_note = "No clearly higher-value, viable option was available."
    vclass = whatif.get("summary", {}).get("verdict_class", "solid")
    _lang = ctx.get("lang") or analyst_personas.DEFAULT_LANG
    fields = {
        "persona": analyst_personas.persona(_lang)["voice"],
        "language_line": analyst_personas.language_line(_lang),
        "player": ctx.get("player_name") or "The player",
        "team": ctx.get("team") or "his team",
        "chosen_label": next((o["label"] for o in opts if o.get("chosen")), "his action"),
        "chosen_val": _fmt_opt_value(next((o for o in opts if o.get("chosen")), {})),
        "zone": ctx.get("zone") or "the pitch",
        "pressure": ctx.get("pressure") or "UNKNOWN",
        "nd": ctx.get("nearest_defender_dist", "?"),
        "outcome": ctx.get("outcome") or "Unknown",
        "options_block": "\n".join(lines),
        "best_note": best_note,
        "verdict_class": vclass,
        "verdict_meaning": WHATIF_MEANING.get(vclass, WHATIF_MEANING["solid"]),
        "rules": WHATIF_RULES,
    }
    return _render(WHATIF_TEMPLATE, fields)


def _whatif_fallback(whatif: dict) -> dict:
    """Deterministic verdict straight from the numbers, for when Granite is
    unreachable or returns junk."""
    s = whatif.get("summary", {})
    cls = s.get("verdict_class", "solid")
    best = s.get("best_label")
    delta = s.get("delta")
    if cls == "optimal":
        return {"verdict": "optimal", "headline": "Best available option",
                "detail": "Set against every option in the frame, this was the highest-value ball on the pitch."}
    if cls == "forced":
        dream = s.get("blocked_best_label")
        road = f"the ball to {dream.split(' to ')[-1] if dream else 'a team-mate'}"
        return {"verdict": "forced", "headline": "Hands were tied",
                "detail": f"The genuinely better option, {road}, was blocked, so this was the best of what was left, even if it was a low-value action."}
    if cls == "solid" or not best:
        return {"verdict": "solid", "headline": "A sound, low-risk choice",
                "detail": "A defensible option; the marginal gains elsewhere did not justify the added risk."}
    dtxt = f"{delta:+.3f} xT" if isinstance(delta, (int, float)) else "more"
    return {"verdict": "better_available", "headline": "A higher-value option was on",
            "detail": f"The data points to {best.lower()} as the stronger call, worth {dtxt} more than the option taken."}


def whatif_verdict(ctx: dict, whatif: dict) -> dict:
    """Granite's judgment over the ranked option table. Returns
    {source, via, verdict, headline, detail}; cached per moment."""
    key = _whatif_key(ctx)
    if key in _WHATIF_CACHE:
        return _WHATIF_CACHE[key]

    prompt = _build_whatif_prompt(ctx, whatif)
    text, via = _complete(prompt, max_tokens=200, temperature=0.0, fmt="json",
                          ollama_model=os.getenv("OLLAMA_ASSESS_MODEL"))
    if text:
        try:
            raw = _extract_json(text)
            # the verdict CLASS is ground truth from the engine, not Granite's to
            # re-decide; Granite only supplies the prose that justifies it
            verdict = whatif.get("summary", {}).get("verdict_class", "solid")
            result = {
                "source": "granite", "via": via,
                "verdict": verdict,
                "headline": _clean(str(raw.get("headline") or "").strip())[:80],
                "detail": _clean(_cap_sentences(str(raw.get("detail") or "").strip(), 2)),
            }
            if not result["headline"] or not result["detail"]:
                fb = _whatif_fallback(whatif)
                result["headline"] = result["headline"] or fb["headline"]
                result["detail"] = result["detail"] or fb["detail"]
            _WHATIF_CACHE[key] = result
            _persist_whatif_cache()
            return result
        except Exception as exc:
            print(f"[whatif] could not parse Granite JSON, using local: {exc}")

    fb = _whatif_fallback(whatif)
    fb["source"] = "local"
    fb["via"] = ""
    return fb


# Display-text translation. The assessment is computed once in English (so scores
# are identical in every language and the Truth Anchor checks keep working), then
# the human-facing strings are translated on the way out, cached per phrase+language.
_TRANSLATE_FILE = os.path.join(_CACHE_DIR, "translate_cache.json")
_TRANSLATE_VERSION = "t-v1"
_LANG_NAMES = {"es": "Spanish", "fr": "French", "de": "German"}


def _load_translate_cache() -> "dict[str, list]":
    try:
        import json
        with open(_TRANSLATE_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


_TRANSLATE_CACHE: "dict[str, list]" = _load_translate_cache()


def _persist_translate_cache() -> None:
    try:
        import json
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(_TRANSLATE_FILE, "w", encoding="utf-8") as fh:
            json.dump(_TRANSLATE_CACHE, fh, ensure_ascii=False)
    except Exception as exc:
        print(f"[translate] could not persist cache: {exc}")


def _translate_texts(texts: list, lang: str) -> list:
    """Translate a list of short phrases into `lang`, preserving order and count.
    Cached per (phrases, lang). Returns the originals unchanged on any failure."""
    lang = (lang or "en").lower()
    texts = [str(t) for t in texts]
    if lang not in _LANG_NAMES or not any(t.strip() for t in texts):
        return texts
    ckey = hashlib.sha1(("".join(texts) + ":" + lang + ":" + _TRANSLATE_VERSION).encode()).hexdigest()
    if ckey in _TRANSLATE_CACHE:
        cached = _TRANSLATE_CACHE[ckey]
        if isinstance(cached, list) and len(cached) == len(texts):
            return cached
    lines = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(texts))
    prompt = (
        f"You are a professional football translator. Translate each numbered phrase "
        f"below into {_LANG_NAMES[lang]}. Keep each translation concise, natural and "
        f"in the SAME order, and translate ALL of them. Do not add notes or numbering "
        f'in the values. Return ONLY this JSON: {{"out":["...","..."]}} with exactly '
        f"{len(texts)} strings.\nPHRASES:\n{lines}"
    )
    # Translation needs the 8B prose model: the 2B mangles football idioms
    # ("carried past" -> "pasto"/grass). Use the default OLLAMA_MODEL.
    text, _ = _complete(prompt, max_tokens=300, temperature=0.0, fmt="json")
    try:
        raw = _extract_json(text)
        arr = raw.get("out") if isinstance(raw, dict) else None
        if isinstance(arr, list) and len(arr) == len(texts):
            res = [_clean(str(x).strip()) for x in arr]
            _TRANSLATE_CACHE[ckey] = res
            _persist_translate_cache()
            return res
    except Exception as exc:
        print(f"[translate] failed ({lang}): {exc}")
    return texts


def _localize_assess(result: dict, lang: str) -> dict:
    """Return a copy of an assessment with its pros/cons/field-read note translated
    into `lang`. Scores and labels are untouched (labels are localized client-side)."""
    if not result or (lang or "en").lower() == "en" or result.get("source") != "granite":
        return result
    dec = result.get("decision") or {}
    pros = list(dec.get("pros") or [])
    cons = list(dec.get("cons") or [])
    audit = result.get("reasoning_audit") or {}
    note = audit.get("note") or ""
    batch = pros + cons + ([note] if note else [])
    if not batch:
        return result
    tx = _translate_texts(batch, lang)
    if len(tx) != len(batch):
        return result
    import copy
    r = copy.deepcopy(result)
    r["decision"]["pros"] = tx[:len(pros)]
    r["decision"]["cons"] = tx[len(pros):len(pros) + len(cons)]
    if note:
        r.setdefault("reasoning_audit", {})["note"] = tx[-1]
    r["lang"] = lang
    return r


def assess_moment(ctx: dict) -> dict:
    """Granite-computed assessment of a moment. Returns
    {source, via, stakes, decision, dna} on success, or {source:'local'} so the
    caller can fall back to its own deterministic engine. Human-facing text is
    translated into ctx['lang'] (scores are language-agnostic)."""
    lang = ctx.get("lang")
    key = _assess_key(ctx)
    if key in _ASSESS_CACHE:
        return _localize_assess(_ASSESS_CACHE[key], lang)

    # raw coordinate Field Map (AI reads the field); None if no usable freeze frame
    fmap = _field_map(ctx)
    prompt = _build_assess_prompt(ctx, fmap)
    # temperature 0 = greedy/deterministic decoding: the SAME moment always yields
    # the SAME score, so it never "randomly changes" between clicks or restarts.
    # 256 tokens is plenty for the compact JSON and cuts generation time. A
    # smaller Granite can be set for the structured scoring (much faster) while
    # the 8B still writes the prose: set OLLAMA_ASSESS_MODEL=granite3.3:2b.
    text, via = _complete(prompt, max_tokens=300, temperature=0.0, fmt="json",
                          ollama_model=os.getenv("OLLAMA_ASSESS_MODEL"))
    if text:
        try:
            is_penalty = bool(ctx.get("is_penalty") or ctx.get("shot_type") == "Penalty")
            is_goal = (ctx.get("action_type") == "Shot"
                       and ctx.get("outcome") == "Goal" and not is_penalty)
            xg = ctx.get("xg")
            placement = ctx.get("shot_placement_quality")
            saved_on_target = (
                ctx.get("action_type") == "Shot" and not is_penalty and not is_goal
                and ctx.get("outcome") in ("Saved", "Saved To Post")
            )
            # PLACEMENT decides a saved shot's execution: a corner-bound strike that
            # is saved is fine execution beaten by the keeper (not the shooter's
            # fault), while a tame shot down the middle is a poor finish that made the
            # save comfortable. "Saved To Post" was tipped onto the woodwork, so it was
            # by definition well placed.
            well_placed_save = saved_on_target and (
                ctx.get("outcome") == "Saved To Post"
                or (isinstance(placement, (int, float)) and placement >= 0.55)
            )
            poor_placement_save = (
                saved_on_target and ctx.get("outcome") != "Saved To Post"
                and isinstance(placement, (int, float)) and placement <= 0.33
            )
            # a middling-placement save of a genuine chance: still a decent strike
            on_target_chance = (
                saved_on_target and not well_placed_save and not poor_placement_save
                and isinstance(xg, (int, float)) and xg >= 0.15
            )
            # a near miss: a shot logged OFF target (or off the post) that actually
            # shaved the frame, e.g. a free kick that nearly top-binned it. Judged on
            # PLACEMENT from the real end-location, not xG, so a fine strike that just
            # missed is not scored like a wild slice.
            margin = ctx.get("shot_off_target_margin")
            near_miss = (
                ctx.get("action_type") == "Shot" and not is_penalty and not is_goal
                and ctx.get("outcome") in ("Off T", "Off Target", "Wayward",
                                           "Post", "Saved Off T")
                and isinstance(margin, (int, float)) and margin <= 1.5
            )
            # all of these were genuinely well struck (good placement on target, a
            # great-save corner, or a near miss), so a "poor execution" con is invalid.
            # A poor-placement save is deliberately excluded: its placement WAS poor.
            quality_strike = on_target_chance or near_miss or well_placed_save
            is_assist = (ctx.get("action_type") == "Pass"
                         and ctx.get("outcome") == "Complete" and bool(ctx.get("goal_assist")))
            is_key_pass = (ctx.get("action_type") == "Pass"
                           and ctx.get("outcome") == "Complete"
                           and bool(ctx.get("shot_assist")) and not is_assist)
            prog = ctx.get("forward_progress")
            # "routine" = a safe retention ball: a back/sideways/short pass that
            # did NOT break lines. Danger and merit come from FORWARD progress, so
            # we gate on prog < 8 (not abs): a pass dropped backwards is the SAFEST
            # kind and must stay routine no matter how far back it travels.
            is_routine_pass = (
                ctx.get("action_type") == "Pass" and ctx.get("outcome") == "Complete"
                and not is_assist and not is_key_pass
                and not (ctx.get("defenders_bypassed") or 0)
                and ctx.get("pass_technique") != "Through Ball"
                and isinstance(prog, (int, float)) and prog < 8
            )
            # a genuinely progressive ball-carry: a completed carry that drove the
            # ball a long way UP the pitch (not a 5m touch). Floors execution and
            # decision so a big solo run reads as the quality action it is, while
            # the geometric difficulty above already scales with how big it was.
            carry_dist = ctx.get("carry_distance")
            is_progressive_carry = (
                ctx.get("action_type") == "Carry"
                and isinstance(prog, (int, float)) and prog >= 18
                and isinstance(carry_dist, (int, float)) and carry_dist >= 20
            )
            result = _validate_assessment(
                _extract_json(text), ctx.get("game_state"),
                _action_succeeded(ctx), is_goal, is_penalty, quality_strike,
                is_assist, is_key_pass, is_routine_pass, fmap=fmap,
                geo_difficulty=_geometric_difficulty(ctx),
                is_progressive_carry=is_progressive_carry,
                well_placed_save=well_placed_save,
                poor_placement_save=poor_placement_save,
                is_kickoff=bool(ctx.get("is_kickoff")))
            result["source"] = "granite"
            result["via"] = via
            _ASSESS_CACHE[key] = result
            _persist_assess_cache()    # freeze this English verdict forever
            return _localize_assess(result, lang)
        except Exception as exc:
            print(f"[assess] could not parse Granite JSON, using local: {exc}")
    return {"source": "local"}


# Manager tactics prose (Line-ups view) — a short Granite read on the approach
_MANAGER_VERSION = "mgr-v2"  # mgr-v2: grounded by the REAL result (incl. shootout) so it can't invent the winner
_MANAGER_FILE = os.path.join(_CACHE_DIR, "manager_cache.json")


def _load_manager_cache() -> "dict[str, dict]":
    try:
        import json
        with open(_MANAGER_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


_MANAGER_CACHE: "dict[str, dict]" = _load_manager_cache()


def _persist_manager_cache() -> None:
    try:
        import json
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(_MANAGER_FILE, "w", encoding="utf-8") as fh:
            json.dump(_MANAGER_CACHE, fh)
    except Exception as exc:
        print(f"[manager] could not persist cache: {exc}")


MANAGER_TEMPLATE = """{persona}

You are giving a SHORT tactical read on a manager's approach in one World Cup match.

THE FACTS (do not invent anything beyond these):
Manager: {manager}, in charge of {team} ({stage}). Final result: {result}.
Shape: {team} lined up in a {formation}.
Substitutions made: {subs}.
Who contributed: {contributors}.

Write 2 to 3 sentences interpreting the manager's tactical APPROACH and how the shape and the substitutions shaped the game, all from {team}'s point of view. Talk like a warm, knowledgeable pundit. Do NOT list the eleven names; read the SHAPE and the CHANGES. State the outcome ONLY as given in the result above: never claim who won or lost beyond that, and never invent a winner. No metrics or numbers out of 100, no invented names, no em dashes. {language_line}"""


def _result_text(sheet: dict) -> str:
    """A plain, accurate result line (incl. the shootout) to ground the prose."""
    r = sheet.get("result") or {}
    home, away = sheet.get("home_team"), sheet.get("away_team")
    hs, as_ = r.get("home_score"), r.get("away_score")
    if hs is None or as_ is None:
        return "result unknown"
    base = f"{home} {hs}, {away} {as_}"
    so = r.get("shootout")
    if so:
        sh, sa = so.get("home", 0), so.get("away", 0)
        winner = home if sh > sa else away
        base += f", finishing level; {winner} then won the penalty shootout {max(sh, sa)}-{min(sh, sa)}"
    return base


def _manager_facts(sheet: dict, team: str):
    """Plain-language fact strings (formation, subs, contributors, result) that
    GROUND the manager prose, so Granite interprets real events, never invents."""
    info = (sheet.get("teams") or {}).get(team, {})
    formation = info.get("formation") or "set shape"
    subs = info.get("subs") or []
    sub_bits = []
    for s in subs:
        on, off = s.get("on", {}), s.get("off", {})
        extra = ""
        g, a = on.get("goals", 0), on.get("assists", 0)
        if g or a:
            parts = ([f"{g} goal" + ("s" if g > 1 else "")] if g else []) \
                + ([f"{a} assist" + ("s" if a > 1 else "")] if a else [])
            extra = f" (then {' and '.join(parts)})"
        sub_bits.append(f"{on.get('name')} on for {off.get('name')} at {s.get('minute')}'" + extra)
    subs_txt = "; ".join(sub_bits) if sub_bits else "no substitutions of note"
    # top contributors from the starters + subs
    pool = list(info.get("starting") or []) + [s["on"] for s in subs]
    scorers = sorted([p for p in pool if p.get("goals")], key=lambda p: -p["goals"])
    assisters = sorted([p for p in pool if p.get("assists")], key=lambda p: -p["assists"])
    cbits = [f"{p['name']} ({p['goals']}G)" for p in scorers[:3]] \
        + [f"{p['name']} ({p['assists']}A)" for p in assisters[:3]]
    contributors = ", ".join(cbits) if cbits else "no goals or assists"
    return formation, subs_txt, contributors


def manager_tactics(match_id: int, team: str, sheet: dict, lang: str | None = None):
    """Short Granite read on a manager's approach, grounded by the real formation,
    substitutions and contributors. Cached on disk per match+team+language."""
    lang = (lang or analyst_personas.DEFAULT_LANG)
    key = hashlib.sha1(f"manager:{match_id}:{team}:{lang}:{_MANAGER_VERSION}".encode()).hexdigest()
    if key in _MANAGER_CACHE:
        return _MANAGER_CACHE[key]

    info = (sheet.get("teams") or {}).get(team, {})
    manager = info.get("manager") or "The manager"
    formation, subs_txt, contributors = _manager_facts(sheet, team)
    result = _result_text(sheet)

    p = analyst_personas.persona(lang)
    prompt = _render(MANAGER_TEMPLATE, {
        "persona": p["voice"],
        "language_line": analyst_personas.language_line(lang),
        "manager": manager, "team": team, "stage": "World Cup 2022",
        "result": result, "formation": formation, "subs": subs_txt,
        "contributors": contributors,
    })
    text, via = _complete(prompt, max_tokens=240, temperature=0.4)
    if text and text.strip():
        out = {"prose": _clean(text.strip()), "manager": manager,
               "formation": info.get("formation"), "source": "granite", "via": via}
        _MANAGER_CACHE[key] = out
        _persist_manager_cache()
        return out
    # fallback: a plain factual line (no invented analysis) when no model is up
    return {"prose": f"{manager} set {team} up in a {formation}.",
            "manager": manager, "formation": info.get("formation"), "source": "local"}

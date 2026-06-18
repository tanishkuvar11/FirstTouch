"""One-shot smoke test for the FirstTouch data layer (run from backend/)."""
import warnings
warnings.filterwarnings("ignore")

import data_layer as dl

matches = dl.list_matches()
print("matches:", len(matches))
final = [m for m in matches if m["stage"] == "Final"][0]
print("final:", final["home_team"], final["home_score"], "-",
      final["away_score"], final["away_team"], "id:", final["match_id"])

events = dl.list_events(final["match_id"])
print("events:", len(events))
shots = [e for e in events if e["type"] == "Shot" and e["has_360"]]
print("shots with 360:", len(shots))
goals = [e for e in shots if e["outcome"] == "Goal"]
print("goals:", [(g["minute"], g["player"]) for g in goals])

frame = dl.enrich_frame(final["match_id"], goals[1]["id"])
print("frame players:", len(frame["players"]))
for p in frame["players"][:8]:
    print("  #", p["jersey_number"], p["player_name"], p["identity_confidence"],
          "ACTOR" if p["actor"] else "", "GK" if p["keeper"] else "")
print("context:", frame["context"])

import tactical_analysis as ta
tact = ta.analyze_frame(frame["players"], frame["event"]["location"],
                        frame["event"]["type"], frame["event"]["end_location"])
print("tactical best_option:", tact["best_option"], "| quality:", tact["decision_quality"],
      "| pressure_score:", tact["pressure_score"])

import granite_client as gc
out = gc.get_explanation({
    "player_name": frame["event"]["player"], "team": frame["event"]["team"],
    "stage": final["stage"], "minute": frame["event"]["minute"],
    "action_type": frame["event"]["type"], **frame["context"], "tactical": tact,
})
print("explanation source:", out["source"])
print(out["explanation"][:400])

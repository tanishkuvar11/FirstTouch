// Shared football primitives, computed ONCE from a freeze frame + event.
//
// Each primitive answers exactly ONE question, and the three top-level systems
// (Action Quality, Stakes, Decision DNA) are all derived from these. That is the
// whole point of this module: Execution is computed here once and read by both
// Action Quality and the DNA radar, so they can never drift apart or answer the
// same question twice with different numbers.
//
//   decisionQuality - was the chosen action the best available option?
//   execution       - how well was the chosen action technically performed?
//   difficulty      - how hard was the football situation (incl. technique)?
//   vision          - how much perception / awareness did it require?
//   risk            - what was the downside if it had failed?
//
// Leverage is NOT here: it is owned by Stakes (see stakes.js) and the DNA radar
// reads it straight from the stakes score, so leverage and stakes are one number.

const clamp01 = (v) => Math.max(0, Math.min(1, v))

// StatsBomb abbreviates some outcomes ("Off T", "Saved Off T"). Expand them so
// the UI never shows cryptic stubs.
const OUTCOME_DISPLAY = {
  'Off T': 'Off Target',
  'Saved Off T': 'Saved Off Target',
  'Saved To Post': 'Saved Onto the Post',
}
export function prettyOutcome(o) {
  if (!o) return o
  return OUTCOME_DISPLAY[o] || o
}
function prettyOutcomeLite(o) {
  return (prettyOutcome(o) || '').toLowerCase()
}

function forwardProgress(ev) {
  if (!ev?.location || !ev?.end_location) return 0
  return ev.end_location[0] - ev.location[0]
}
function lateralSwing(ev) {
  if (!ev?.location || !ev?.end_location) return 0
  return Math.abs(ev.end_location[1] - ev.location[1])
}
function ballDistance(ev) {
  if (!ev?.location || !ev?.end_location) return 0
  const dx = ev.end_location[0] - ev.location[0]
  const dy = ev.end_location[1] - ev.location[1]
  return Math.hypot(dx, dy)
}
// opponents the ball physically travelled past (start x -> end x, attacking +x)
function defendersBypassed(frameData, ev) {
  if (!ev?.location || !ev?.end_location) return 0
  const sx = ev.location[0]
  const ex = ev.end_location[0]
  if (ex <= sx + 1) return 0
  return (frameData.players || [])
    .filter((p) => !p.teammate && Array.isArray(p.location))
    .filter((p) => p.location[0] > sx + 0.5 && p.location[0] < ex)
    .length
}

const ON_TARGET_MISS = new Set(['Saved', 'Saved To Post', 'Post'])
const FAIL_OUTCOMES = new Set([
  'Incomplete', 'Out', 'Pass Offside', 'Lost', 'Lost In Play', 'Lost Out',
  'Off T', 'Saved Off T', 'Off Target', 'Wayward', 'Unknown',
])
const HARD_TECHNIQUE = new Set([
  'Volley', 'Half Volley', 'Overhead Kick', 'Lob', 'Backheel', 'Diving Header',
])

function isPenalty(ev) {
  return (ev?.shot_type || '') === 'Penalty'
}

// True / false / null when the outcome makes success (un)ambiguous.
function actionSucceeded(type, outcome) {
  if (type === 'Shot') return outcome === 'Goal'
  if (type === 'Pass' || type === 'Dribble') return outcome === 'Complete'
  if (['Carry', 'Pressure', 'Clearance', 'Block', 'Goal Keeper'].includes(type)) return true
  if (type === 'Interception') return !['Lost', 'Lost In Play', 'Lost Out'].includes(outcome)
  return null
}

// EXECUTION - how well the chosen action was technically performed.
// Outcome-driven only. The key football nuance: an open-play shot ON TARGET
// that forces a save is GOOD execution (the keeper beat it, not the striker);
// a shot OFF the target is poor execution; a PENALTY missed/saved is poor
// execution because converting is the baseline expectation.
function computeExecution(frameData, ev, type, outcome) {
  if (isPenalty(ev)) return outcome === 'Goal' ? 1.0 : 0.06

  if (type === 'Shot') {
    if (outcome === 'Goal') return 1.0
    if (ON_TARGET_MISS.has(outcome)) return 0.72   // beat everyone, keeper saved
    if (outcome === 'Blocked') return 0.35         // struck but charged down
    return 0.1                                     // off target / wayward
  }
  if (type === 'Pass') {
    if (ev.goal_assist) return 0.95
    if (outcome === 'Complete') {
      let e = ev.shot_assist ? 0.78 : 0.7
      if (defendersBypassed(frameData, ev) >= 2) e += 0.12
      if (ev.pass_technique === 'Through Ball') e += 0.05
      return clamp01(e)
    }
    return 0.15
  }
  if (type === 'Dribble') return outcome === 'Complete' ? 0.8 : 0.15
  if (type === 'Carry') return 0.65
  if (type === 'Interception') return actionSucceeded(type, outcome) ? 0.7 : 0.18
  if (['Pressure', 'Clearance', 'Block', 'Goal Keeper'].includes(type)) return 0.62
  if (type === 'Foul Committed' || type === 'Bad Behaviour') return 0.1
  return 0.45
}

// DIFFICULTY - how hard the football situation was. Spatial pressure PLUS, for
// shots, the difficulty of the chance itself (low xG = a hard chance) and the
// technique used (a volley is hard even when unmarked). Difficulty NEVER excuses
// a poor outcome; it is context, surfaced as its own dimension.
function spatialDifficulty(ctx) {
  let s = 0
  if (ctx.pressure === 'HIGH') s += 0.4
  else if (ctx.pressure === 'MEDIUM') s += 0.18
  const nd = ctx.nearest_defender_dist
  if (typeof nd === 'number') {
    if (nd < 2) s += 0.28
    else if (nd < 4) s += 0.14
    else if (nd < 6) s += 0.05
  }
  const open = ctx.open_teammate_count ?? 0
  const mates = ctx.teammate_count ?? 0
  if (mates > 0) {
    const ratio = open / mates
    if (ratio === 0) s += 0.22
    else if (ratio < 0.34) s += 0.12
  }
  if ((ctx.opponent_count ?? 0) >= 8) s += 0.08
  return clamp01(s)
}

function computeDifficulty(frameData, ev, ctx, type, xg) {
  const spatial = spatialDifficulty(ctx)
  if (isPenalty(ev)) return 0.12

  if (type === 'Shot') {
    const q = typeof xg === 'number' ? xg : 0.1
    const chanceDiff = clamp01(1 - q / 0.5)          // 0.5+ xG sitter -> 0
    let d = Math.max(spatial, 0.3 * spatial + 0.75 * chanceDiff)
    if (HARD_TECHNIQUE.has(ev.shot_technique)) d += 0.2
    return clamp01(d)
  }
  if (type === 'Pass') {
    const through = ev.pass_technique === 'Through Ball'
    const bypass = defendersBypassed(frameData, ev)
    const sw = lateralSwing(ev) > 25 && ballDistance(ev) > 30
    return clamp01(spatial * 0.7 + (through ? 0.2 : 0) + Math.min(bypass * 0.08, 0.24) + (sw ? 0.15 : 0))
  }
  if (type === 'Dribble') return clamp01(0.4 + spatial * 0.5)
  if (type === 'Carry') return clamp01(spatial * 0.6 + Math.max(0, forwardProgress(ev)) / 120)
  return clamp01(spatial * 0.7)
}

// DECISION QUALITY - was the chosen action the best available option, given
// what the player could see. Independent of how it was struck (execution) and
// of whether it went in. A correct decision to shoot a clear chance is correct
// whether it is scored or missed.
function computeDecisionQuality(frameData, ev, ctx, type, outcome, xg) {
  const open = ctx.open_teammate_count ?? 0
  if (isPenalty(ev)) return 0.95     // shooting is the only option; correct call

  if (type === 'Shot') {
    const q = typeof xg === 'number' ? xg : 0.1
    // shooting from a shooting position is a fair call; a clear chance makes it
    // clearly right. Low xG alone is NOT a bad decision (a screamer is a great
    // strike, not a poor choice) - only mark it down when a pass was clearly on.
    let dq = q >= 0.3 ? 0.9 : 0.8
    if (q < 0.12 && open >= 2 && ctx.pressure !== 'HIGH') dq = 0.5
    return clamp01(dq)
  }
  if (type === 'Pass') {
    if (ev.goal_assist) return 1.0
    if (ev.shot_assist) return 0.9
    if (ev.pass_technique === 'Through Ball') return 0.82
    const prog = forwardProgress(ev)
    if (outcome === 'Complete') {
      if (prog > 15) return 0.78
      if (prog > 5) return 0.7
      if (prog < -3) return 0.55
      return 0.65
    }
    // an incomplete pass: the CHOICE may still have been sound (execution failed)
    const ambitious = ev.pass_technique === 'Through Ball' || prog > 15
    return ambitious ? 0.55 : 0.45
  }
  if (type === 'Dribble') {
    const attackingThird = Array.isArray(ev.location) && ev.location[0] > 80
    return attackingThird ? 0.72 : 0.6
  }
  if (type === 'Carry') return forwardProgress(ev) > 5 ? 0.72 : 0.6
  if (['Interception', 'Clearance', 'Block', 'Goal Keeper', 'Pressure'].includes(type)) return 0.72
  if (type === 'Foul Committed') return 0.3
  if (type === 'Bad Behaviour') return 0.18
  return 0.6
}

// VISION - how much perception / awareness the action required. Shooting needs
// almost none; a defence-splitting pass or a cross-field switch needs a lot.
function computeVision(ev, ctx, type) {
  if (type === 'Shot') return 0.08
  if (type === 'Pass') {
    if (ev.goal_assist) return 1.0
    if (ev.shot_assist) return 0.85
    if (ev.pass_technique === 'Through Ball') return 0.9
    const len = ballDistance(ev)
    const latr = lateralSwing(ev)
    const prog = forwardProgress(ev)
    const open = ctx.open_teammate_count ?? 0
    const mates = ctx.teammate_count ?? 0
    if (latr > 25 && len > 30) return 0.82        // cross-field switch
    if (len > 35) return 0.6                       // long ball / keeper launch
    if (prog > 20) return 0.5
    return clamp01(0.1 + (mates > 0 ? open / mates : 0) * 0.25)
  }
  if (type === 'Interception') return 0.5          // anticipation
  if (type === 'Carry') return 0.2
  if (type === 'Dribble') return 0.15
  if (type === 'Goal Keeper') return 0.4
  return 0.3
}

// RISK - what was the downside if the action had failed. A safe back-pass risks
// nothing; a backheel or dribble through traffic risks a counterattack.
function computeRisk(frameData, ev, ctx, type, xg) {
  if (isPenalty(ev)) return 0.2
  if (type === 'Shot') {
    const q = typeof xg === 'number' ? xg : 0.1
    let r = 0.2
    if (q < 0.12 && (ctx.open_teammate_count ?? 0) >= 2) r += 0.12
    return clamp01(r)
  }
  if (type === 'Pass') {
    const through = ev.pass_technique === 'Through Ball'
    const bypass = defendersBypassed(frameData, ev)
    const prog = Math.max(0, forwardProgress(ev))
    const sw = lateralSwing(ev) > 25 && ballDistance(ev) > 30
    return clamp01(0.03 + bypass * 0.18 + (prog / 60) * 0.5 + (through ? 0.25 : 0) + (sw ? 0.2 : 0))
  }
  if (type === 'Dribble') {
    return clamp01(0.5 + spatialDifficulty(ctx) * 0.4)
  }
  if (type === 'Carry') {
    return clamp01(0.1 + Math.max(0, forwardProgress(ev)) / 60 * 0.4)
  }
  return 0.2
}

// Audit detail strings, so every primitive can be traced back to real numbers.
function buildDetails(frameData, ev, ctx, type, outcome, xg) {
  const open = ctx.open_teammate_count ?? 0
  const mates = ctx.teammate_count ?? 0
  const nd = ctx.nearest_defender_dist
  const ndTxt = typeof nd === 'number' ? `${nd.toFixed(1)}m` : 'n/a'
  const q = typeof xg === 'number' ? xg : null
  const bypass = defendersBypassed(frameData, ev)
  const prog = Math.round(forwardProgress(ev))

  const difficulty = type === 'Shot' && q != null
    ? `${q.toFixed(2)} xG chance, ${(ctx.pressure || 'low').toLowerCase()} pressure`
    : `${(ctx.pressure || 'low').toLowerCase()} pressure, nearest ${ndTxt}, ${open}/${mates} lanes`

  const execution = outcome ? prettyOutcomeLite(outcome) : 'no clear outcome'

  const vision = ev.goal_assist ? `${open}/${mates} open, found the assist`
    : ev.shot_assist ? `${open}/${mates} open, found the shot`
      : ev.pass_technique === 'Through Ball' ? 'split the line with a through ball'
        : type === 'Shot' ? 'a shot, little perception required'
          : `${open} of ${mates} team-mates in clear lanes`

  const risk = type === 'Pass' && ev.pass_technique === 'Through Ball' ? 'through ball into the gaps'
    : bypass >= 2 ? `played through ${bypass} defenders`
      : prog > 15 ? `${prog}m forward ball`
        : type === 'Dribble' ? `take-on under ${(ctx.pressure || 'low').toLowerCase()} pressure`
          : type === 'Shot' ? 'a shot, low turnover risk'
            : 'low-risk retention'

  const decision = isPenalty(ev) ? 'a penalty, shooting is the only call'
    : type === 'Shot' && q != null ? `shooting a ${q.toFixed(2)} xG chance`
      : ev.goal_assist ? 'picked out the goalscorer'
        : ev.shot_assist ? 'created a clear shot'
          : type === 'Pass' && prog > 5 ? `a progressive ball, ${prog}m upfield`
            : 'the available option'

  return { difficulty, execution, vision, risk, decision }
}

// Returns every primitive plus audit details and success flags, computed once.
export function computePrimitives(frameData, activeEvent) {
  if (!frameData || !activeEvent) return null
  const ctx = frameData.context || {}
  const type = activeEvent.type
  const outcome = ctx.outcome || activeEvent.outcome
  const xg = ctx.xg ?? activeEvent.xg

  const decisionQuality = computeDecisionQuality(frameData, activeEvent, ctx, type, outcome, xg)
  const execution = computeExecution(frameData, activeEvent, type, outcome)
  const difficulty = computeDifficulty(frameData, activeEvent, ctx, type, xg)
  const vision = computeVision(activeEvent, ctx, type)
  const risk = computeRisk(frameData, activeEvent, ctx, type, xg)

  return {
    decisionQuality,
    execution,
    difficulty,
    vision,
    risk,
    succeeded: actionSucceeded(type, outcome),
    isPenalty: isPenalty(activeEvent),
    isGoal: type === 'Shot' && outcome === 'Goal' && !isPenalty(activeEvent),
    details: buildDetails(frameData, activeEvent, ctx, type, outcome, xg),
    raw: { type, outcome, xg },
  }
}

export {
  clamp01, forwardProgress, lateralSwing, ballDistance, defendersBypassed,
  isPenalty, actionSucceeded, ON_TARGET_MISS, FAIL_OUTCOMES,
}

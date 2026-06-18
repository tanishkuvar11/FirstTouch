// Situational STAKES for a moment - "How much could this moment have changed
// the outcome of the match or tournament?"
//
// Stakes is completely independent of Action Quality. It considers ONLY context:
//   - the occasion  : stage, minute, scoreline (how big the moment is)
//   - the swing      : what KIND of moment this is (a chance/penalty/goal can
//                      swing the result; a routine back-pass cannot)
// It deliberately ignores technical quality, pass/shot quality, the OUTCOME and
// player skill. A goal and the identical saved shot carry the same stakes,
// because before the ball is struck both could equally change the game.
//
// Calibration anchors (WC2022): Kolo Muani / Lautaro final chance ~Decisive;
// Montiel winning penalty ~Decisive; Messi final penalty ~High/Decisive; Japan
// goal vs Spain ~High; Messi opener penalty vs Saudi ~Medium; Spain possession
// at 5-0 ~Low.

const clamp01 = (v) => Math.max(0, Math.min(1, v))

const STAGE = {
  'Group Stage':     { w: 0.55, label: 'group stage',          knockout: false },
  'Round of 16':     { w: 0.74, label: 'round of 16',          knockout: true },
  'Quarter-finals':  { w: 0.84, label: 'quarter-final',        knockout: true },
  'Semi-finals':     { w: 0.93, label: 'semi-final',           knockout: true },
  '3rd Place Final': { w: 0.60, label: 'third-place play-off', knockout: true },
  'Final':           { w: 1.00, label: 'final',                knockout: true },
}

// How big the OCCASION is (0..1): stage scaled by time and scoreline. These act
// as multipliers around the stage weight so a final stays a final even early on,
// while a dead rubber or a comfortable lead is damped down.
function occasionWeight({ stage, st, minute, period, margin, knockoutOrLate, drivers }) {
  let timeMult
  if (period === 5) { timeMult = 1.1; drivers.push('Penalty shootout') }
  else if (period === 3 || period === 4) { timeMult = 1.08; drivers.push('Extra time') }
  else if (minute >= 80) { timeMult = 1.05; drivers.push(`Late on (${minute + 1}')`) }
  else if (minute >= 70) { timeMult = 1.0 }
  else if (minute >= 60) { timeMult = 0.92 }
  else if (period === 2) { timeMult = 0.85 }
  else if (minute >= 23) { timeMult = 0.78 }
  else { timeMult = 0.72 }

  let stateMult
  if (knockoutOrLate) {
    if (margin === 0) { stateMult = 1.06; drivers.push('Scores level') }
    else if (margin === -1) { stateMult = 1.1; drivers.push('Trailing by one') }
    else if (margin <= -2) { stateMult = 0.95; drivers.push(`Trailing by ${-margin}`) }
    else if (margin === 1) { stateMult = 1.02; drivers.push('Protecting a one-goal lead') }
    else if (margin >= 3) { stateMult = 0.65; drivers.push('Game already decided') }
    else { stateMult = 0.85 }
  } else if (Math.abs(margin) <= 1) {
    stateMult = 0.98
  } else if (Math.abs(margin) >= 3) {
    stateMult = 0.7; drivers.push('Game already decided')
  } else {
    stateMult = 0.88
  }

  return clamp01(st.w * timeMult * stateMult)
}

// Inherent swing of THIS action (0..1): its potential to change the result,
// regardless of how well it came off. Outcome is intentionally ignored.
function momentSwing({ type, isPenalty, xg, goalAssist, shotAssist, forward, location }) {
  if (isPenalty) return 0.45
  if (type === 'Shot') {
    const q = typeof xg === 'number' ? xg : 0.1
    return Math.max(0.38, Math.min(0.5, 0.38 + q * 0.3))   // any shot is a goal threat
  }
  if (goalAssist) return 0.45
  if (shotAssist) return 0.35
  if (type === 'Dribble') {
    const attackingThird = Array.isArray(location) && location[0] > 80
    return attackingThird ? 0.3 : 0.22
  }
  if (['Interception', 'Block', 'Clearance', 'Goal Keeper'].includes(type)) {
    const nearOwnGoal = Array.isArray(location) && location[0] < 40
    return nearOwnGoal ? 0.42 : 0.3
  }
  if (type === 'Foul Committed' || type === 'Bad Behaviour') return 0.3
  if (type === 'Pass' || type === 'Carry') {
    if (typeof forward === 'number') {
      if (forward > 20) return 0.3
      if (forward > 8) return 0.24
      if (forward < -3) return 0.1
    }
    return 0.16
  }
  return 0.2
}

// Returns { score 0..1, level, color, drivers[], summary, state } or null.
export function computeStakes({
  stage, minute, period, actorTeam, match, liveScore, type, outcome, shotType,
  xg, goalAssist, shotAssist, location, endLocation,
}) {
  if (!match || actorTeam == null) return null
  const st = STAGE[stage] || { w: 0.6, label: stage || 'match', knockout: false }
  const drivers = []
  drivers.push(st.knockout ? `Knockout ${st.label}` : 'Group stage')

  const home = actorTeam === match.home_team
  const me = (home ? liveScore?.home : liveScore?.away) ?? 0
  const them = (home ? liveScore?.away : liveScore?.home) ?? 0
  const margin = me - them
  const state = margin > 0 ? `${actorTeam} lead ${me}-${them}`
    : margin < 0 ? `${actorTeam} trail ${me}-${them}`
      : `level at ${me}-${them}`

  const knockoutOrLate = st.knockout || minute >= 70 || period >= 3
  const occasion = occasionWeight({ stage, st, minute, period, margin, knockoutOrLate, drivers })

  const isPenalty = shotType === 'Penalty'
  const forward = (Array.isArray(location) && Array.isArray(endLocation))
    ? endLocation[0] - location[0] : null
  const swing = momentSwing({ type, isPenalty, xg, goalAssist, shotAssist, forward, location })

  // Stakes = the inherent swing of the action, lifted by how big the occasion is.
  // A penalty or clear chance is always meaningful; the occasion decides whether
  // it is "High" or "Decisive". A routine ball stays low no matter the occasion.
  let score = clamp01(swing + 0.5 * occasion)

  // name the moment so a high or low score reads clearly
  if (type === 'Shot' || isPenalty) drivers.unshift(outcome === 'Goal' ? 'Goal' : 'Goalscoring chance')
  else if (goalAssist) drivers.unshift('Goal assist')
  else if (swing <= 0.18) drivers.push('Low-danger phase')

  const level = score >= 0.80 ? 'Decisive' : score >= 0.60 ? 'High' : score >= 0.40 ? 'Medium' : 'Low'
  const color = score >= 0.80 ? '#ff4d6a' : score >= 0.60 ? '#f0a500' : score >= 0.40 ? '#4a9eff' : '#6e85a8'
  const summary = drivers.join(' · ')
  return { score, level, color, drivers, summary, state }
}

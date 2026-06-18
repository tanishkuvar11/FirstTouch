// FirstTouch ACTION QUALITY engine - 0-100, computed locally from the enriched
// freeze frame. (Formerly "Decision Score".)
//
// Action Quality answers ONE question: "How good was the player's overall
// action?" It is built from three things and THREE ONLY:
//   - Decision Quality : was the chosen action the best available option?
//   - Execution        : how well was it technically performed?
//   - Context Difficulty : how hard was the situation? (context, not a bonus)
//
// It deliberately knows NOTHING about tournament stage, minute, scoreline or
// narrative - those belong exclusively to Stakes. A brilliant action in a dead
// rubber and the same action in a final score the same here. Difficulty never
// "excuses" a poor outcome: a difficult situation only lifts Action Quality when
// the action was actually pulled off (difficulty * execution), so a missed hard
// chance is not rewarded for being hard.
//
// Calibration anchors (WC2022): Kolo Muani saved one-on-one ~70-80; Lautaro
// open miss ~20-35; Messi assist to Molina ~95-100; Richarlison volley ~95+;
// Kane penalty miss ~25-35; Mbappe volley ~97+.

import { computePrimitives, prettyOutcome, defendersBypassed, forwardProgress } from './footballMetrics.js'

export { prettyOutcome }

function buildReasoning(prim, frameData, ev) {
  const { raw, succeeded, isPenalty, isGoal } = prim
  const { type, outcome, xg } = raw
  const pros = []
  const cons = []
  const q = typeof xg === 'number' ? xg : null

  if (isPenalty) {
    if (outcome === 'Goal') pros.push('Penalty converted under maximum pressure')
    else if (outcome === 'Saved' || outcome === 'Saved To Post') cons.push('Penalty saved by the keeper')
    else if (outcome === 'Post') cons.push('Penalty hit the woodwork, no goal')
    else cons.push('Penalty missed the target')
    return { pros, cons }
  }

  if (type === 'Shot') {
    if (isGoal) {
      pros.push('Goal, the chosen action came off')
      if (q != null && q < 0.12) pros.push(`Finished a low-percentage chance (xG ${q.toFixed(2)})`)
      else if (q != null && q >= 0.3) pros.push(`Took a clear chance (xG ${q.toFixed(2)})`)
      if (prim.difficulty >= 0.7) pros.push('A technically difficult finish')
    } else if (outcome === 'Saved' || outcome === 'Saved To Post' || outcome === 'Post') {
      pros.push('Hit the target and forced the save')
      if (q != null && q >= 0.4) cons.push(`A strong chance the keeper denied (xG ${q.toFixed(2)})`)
    } else if (outcome === 'Blocked') {
      cons.push('Shot charged down before it could test the keeper')
    } else {
      cons.push(q != null && q >= 0.4 ? `Missed the target from a clear chance (xG ${q.toFixed(2)})`
        : 'Shot missed the target')
    }
    if (prim.decisionQuality < 0.5) cons.push('A pass looked the better option')
    return { pros, cons }
  }

  if (type === 'Pass') {
    if (ev.goal_assist) pros.push('Assist, directly created a goal')
    else if (ev.shot_assist) pros.push('Key pass, created a shot')
    if (succeeded) {
      const beaten = defendersBypassed(frameData, ev)
      if (beaten >= 2) pros.push(`Took ${beaten} defenders out with one ball`)
      if (ev.pass_technique === 'Through Ball') pros.push('Threaded a through ball')
      const prog = forwardProgress(ev)
      if (prog > 15) pros.push(`Gained ${Math.round(prog)}m up the pitch`)
      if (!pros.length) pros.push('Found a team-mate, kept the move alive')
    } else {
      cons.push('Pass did not find its man')
    }
    return { pros, cons }
  }

  if (type === 'Dribble') {
    if (succeeded) pros.push('Beat his man one-v-one')
    else cons.push('Dribble lost, possession surrendered')
    return { pros, cons }
  }
  if (type === 'Carry') {
    const prog = forwardProgress(ev)
    if (prog > 5) pros.push(`Drove ${Math.round(prog)}m up the pitch`)
    const beaten = defendersBypassed(frameData, ev)
    if (beaten >= 1) pros.push(`Carried past ${beaten} ${beaten === 1 ? 'defender' : 'defenders'}`)
    if (!pros.length) pros.push('Kept possession ticking')
    return { pros, cons }
  }
  if (type === 'Interception') {
    if (succeeded) pros.push('Read the play and won the ball')
    else cons.push('Stepped in but lost the duel')
    return { pros, cons }
  }
  if (type === 'Pressure') { pros.push('Forced the opponent into a rushed decision'); return { pros, cons } }
  if (['Clearance', 'Block', 'Goal Keeper'].includes(type)) { pros.push('Defensive intervention completed'); return { pros, cons } }
  if (type === 'Foul Committed' || type === 'Bad Behaviour') {
    const card = ev.card || ''
    if (card.includes('Red')) cons.push('Sent off, a catastrophic decision')
    else if (card.includes('Second Yellow')) cons.push('Second yellow, down to ten men')
    else if (card.includes('Yellow')) cons.push('Gave away a foul and got booked')
    else cons.push('Conceded a needless foul')
    return { pros, cons }
  }
  return { pros, cons }
}

// Returns { score, label, labelColor, pros, cons, components, primitives } or null.
export function computeDecision(frameData, activeEvent) {
  const prim = computePrimitives(frameData, activeEvent)
  if (!prim) return null

  const { decisionQuality: dq, execution: ex, difficulty: diff, isPenalty, isGoal } = prim

  // Action Quality = decision quality, gated by how well it was executed, with a
  // bonus ONLY for difficulty that was actually overcome (diff * execution), so a
  // hard chance struck superbly can reach the very top while a hard MISS gets no
  // credit for being hard. No stakes term anywhere - this number is
  // stage/minute/scoreline blind by design.
  let aq = dq * (0.2 + 0.8 * ex) + diff * ex * 0.22
  let score = Math.round(Math.max(0.05, Math.min(0.99, aq)) * 100)

  // Outcome guardrails that the blend alone can under/over-shoot:
  if (isPenalty) {
    // converting a penalty is just doing the job (capped); missing one is a
    // costly, self-inflicted failure regardless of how hard it looked.
    score = prim.raw.outcome === 'Goal' ? Math.min(Math.max(score, 70), 82) : Math.min(Math.max(score, 25), 33)
  } else if (isGoal) {
    score = Math.max(score, 85)   // a goal is the action coming off; never mediocre
  }
  score = Math.max(5, Math.min(99, score))

  const { pros, cons } = buildReasoning(prim, frameData, activeEvent)

  const label = score >= 80 ? 'Outstanding' : score >= 65 ? 'Good' : score >= 45 ? 'Reasonable' : 'Poor'
  const labelColor = score >= 80 ? '#00e5a0' : score >= 65 ? '#4a9eff' : score >= 45 ? '#f0a500' : '#ff4d6a'

  return {
    score,
    label,
    labelColor,
    pros,
    cons,
    // sub-scores so the panel can show WHY Action Quality landed where it did
    components: {
      decision: Math.round(dq * 100),
      execution: Math.round(ex * 100),
      difficulty: Math.round(diff * 100),
    },
    // kept for DNA/back-compat (DecisionPanel reads decision.difficulty)
    difficulty: diff,
    primitives: prim,
  }
}

// FirstTouch "Decision DNA" - a 5-axis FINGERPRINT of a moment (not a rating).
//
// Think FIFA attributes, not a score. Each axis answers a different question and
// every axis is a transparent function of REAL StatsBomb numbers. Difficulty and
// Execution are NOT recomputed here: they come from the shared primitives engine
// (footballMetrics.js), so the radar and Action Quality can never disagree.
// Leverage is NOT computed here either: it is read straight off the Stakes score,
// so "Leverage" and "Stakes" are guaranteed to be the same number.
//
//   Difficulty - how hard was the football situation?
//   Vision     - how much perception / awareness was required?
//   Execution  - how well was it technically performed?
//   Risk       - what was the downside if it failed?
//   Leverage   - how much did the moment matter? (= Stakes)

import { computePrimitives, clamp01 } from './footballMetrics.js'

// Returns { axes:[{key,label,value,detail}], spark } or null.
// `decision` is accepted for back-compat but no longer needed (primitives are
// recomputed from the frame, memoised cheaply upstream).
export function computeDNA(frameData, activeEvent, _decision, stakes) {
  const prim = computePrimitives(frameData, activeEvent)
  if (!prim) return null
  const d = prim.details

  const leverage = clamp01(stakes?.score ?? 0.4)
  const leverageDetail = stakes?.summary || 'situational weight'

  const axes = [
    { key: 'difficulty', label: 'Difficulty', value: prim.difficulty, detail: d.difficulty },
    { key: 'vision', label: 'Vision', value: prim.vision, detail: d.vision },
    { key: 'execution', label: 'Execution', value: prim.execution, detail: d.execution },
    { key: 'risk', label: 'Risk', value: prim.risk, detail: d.risk },
    { key: 'leverage', label: 'Leverage', value: leverage, detail: leverageDetail },
  ]

  const spark = axes.reduce((a, b) => (b.value > a.value ? b : a))
  return { axes, spark }
}

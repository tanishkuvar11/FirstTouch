import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { computeDecision, prettyOutcome } from '../decisionScore.js'
import { computeDNA } from '../decisionDNA.js'
import { flagUrl } from '../flags.js'
import { eventColorOf, eventLabel } from '../kitColors.js'
import DecisionRadar from './DecisionRadar.jsx'
import ConsequenceChain from './ConsequenceChain.jsx'
import { useT, useLang, translateDriver, translateReason, translateWhatifLabel, translateDetail } from '../i18n.jsx'
import './DecisionPanel.css'

const photoCache = new Map()

function usePlayerPhoto(playerName) {
  const [photo, setPhoto] = useState(null)
  useEffect(() => {
    setPhoto(null)
    if (!playerName) return
    if (photoCache.has(playerName)) {
      setPhoto(photoCache.get(playerName))
      return
    }
    let cancelled = false
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(playerName.replace(/ /g, '_'))}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const src = d?.thumbnail?.source || null
        photoCache.set(playerName, src)
        if (!cancelled) setPhoto(src)
      })
      .catch(() => {
        photoCache.set(playerName, null)
        if (!cancelled) setPhoto(null)
      })
    return () => { cancelled = true }
  }, [playerName])
  return photo
}

function initials(name) {
  if (!name) return '–'
  const parts = name.trim().split(' ')
  const first = parts[0]?.[0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

// score -> band colour, shared with the deterministic engine's thresholds
function decisionColor(score) {
  return score >= 80 ? '#00e5a0' : score >= 65 ? '#4a9eff' : score >= 45 ? '#f0a500' : '#ff4d6a'
}
function stakesColor(score) {
  return score >= 80 ? '#ff4d6a' : score >= 60 ? '#f0a500' : score >= 40 ? '#4a9eff' : '#6e85a8'
}

// the three things Action Quality is built from, shown so the score is auditable
function ComponentBars({ components }) {
  const tr = useT()
  if (!components) return null
  const rows = [
    { key: 'decision', label: 'Decision', hint: 'Right call?', value: components.decision },
    { key: 'execution', label: 'Execution', hint: 'Struck well?', value: components.execution },
    { key: 'difficulty', label: 'Difficulty', hint: 'How hard?', value: components.difficulty },
  ]
  return (
    <div className="dp-components">
      {rows.map((r) => (
        <div key={r.key} className="dp-comp-row">
          <span className="dp-comp-label">{tr(r.label)}<em>{tr(r.hint)}</em></span>
          <span className="dp-comp-track">
            <span className="dp-comp-fill" style={{ width: `${r.value}%` }} />
          </span>
          <span className="dp-comp-val">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

// Semicircular stakes dial, styled like a precision instrument: a thin graduated
// scale with tick marks, zone tints matching the stakes palette, a slim tapered
// needle and a digital readout. Score is 0..1; zones mirror stakes.js thresholds.
function StakesGauge({ score = 0, level = '', color = '#ff4d6a' }) {
  const t = Math.max(0, Math.min(1, score))
  const cx = 120, cy = 116, R = 94, sw = 6
  const polar = (r, aDeg) => {
    const a = (aDeg - 90) * Math.PI / 180
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }
  const arc = (r, a0, a1) => {
    const s = polar(r, a1), e = polar(r, a0)
    const large = Math.abs(a1 - a0) <= 180 ? 0 : 1
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
  }
  const ang = (f) => -90 + 180 * f          // f is an arc fraction 0..1
  // four zones, each an EQUAL quarter of the dial; the score's real thresholds
  // are remapped so the needle still lands inside the correct zone.
  const bounds = [0, 0.4, 0.6, 0.8, 1.0]
  const segs = [
    { c: '#6e85a8' },   // Low      - slate
    { c: '#4a9eff' },   // Medium   - blue
    { c: '#f0a500' },   // High     - gold
    { c: '#ff4d6a' },   // Decisive - red
  ]
  // remap a 0..1 score onto the equal-quarter arc
  const toArc = (v) => {
    for (let i = 0; i < 4; i++) {
      if (v <= bounds[i + 1] || i === 3) {
        const frac = (v - bounds[i]) / (bounds[i + 1] - bounds[i])
        return (i + Math.max(0, Math.min(1, frac))) / 4
      }
    }
    return 1
  }
  const activeZone = bounds.findIndex((b, i) => i < 4 && t < bounds[i + 1])
  const live = activeZone === -1 ? 3 : activeZone
  // graduation: major ticks at the 5 quarter lines, a minor tick mid-zone
  const majors = [0, 0.25, 0.5, 0.75, 1]
  const minors = [0.125, 0.375, 0.625, 0.875]
  const na = ang(toArc(t))
  const tip = polar(R - 1, na)
  const tail = polar(13, na + 180)
  const bl = polar(5, na - 90)
  const br = polar(5, na + 90)
  return (
    <svg className="dp-gauge" viewBox="0 0 240 144" role="img" aria-label={`Stakes: ${level}`}>
      {/* faint base track */}
      <path d={arc(R, ang(0), ang(1))} stroke="rgba(255,255,255,0.06)" strokeWidth={sw} fill="none" />
      {/* equal-quarter zone scale; the active zone shows at full strength */}
      {segs.map((s, i) => (
        <path
          key={i}
          d={arc(R, ang(i / 4) + (i ? 1 : 0), ang((i + 1) / 4) - (i < 3 ? 1 : 0))}
          stroke={s.c}
          strokeOpacity={i === live ? 0.95 : 0.26}
          strokeWidth={sw}
          fill="none"
        />
      ))}
      {/* graduation marks */}
      {majors.map((v, i) => {
        const a = ang(v), o = polar(R - sw - 2, a), inr = polar(R - sw - 11, a)
        return <line key={`M${i}`} x1={o.x.toFixed(1)} y1={o.y.toFixed(1)} x2={inr.x.toFixed(1)} y2={inr.y.toFixed(1)} stroke="rgba(255,255,255,0.34)" strokeWidth="1.6" />
      })}
      {minors.map((v, i) => {
        const a = ang(v), o = polar(R - sw - 2, a), inr = polar(R - sw - 6, a)
        return <line key={`m${i}`} x1={o.x.toFixed(1)} y1={o.y.toFixed(1)} x2={inr.x.toFixed(1)} y2={inr.y.toFixed(1)} stroke="rgba(255,255,255,0.2)" strokeWidth="0.9" />
      })}
      {/* slim needle with a short counterweight tail */}
      <polygon
        points={`${bl.x.toFixed(1)},${bl.y.toFixed(1)} ${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${br.x.toFixed(1)},${br.y.toFixed(1)} ${tail.x.toFixed(1)},${tail.y.toFixed(1)}`}
        fill={color}
      />
      <circle cx={cx} cy={cy} r="6" fill="var(--surface)" stroke={color} strokeWidth="2" />
    </svg>
  )
}

export default function DecisionPanel({
  activeEvent, frameData, match, stakes, assessment, assessing, loadingFrame,
  whatif, whatifing, activeTab = 'decision', onTabChange, nav, onNavigate,
}) {
  const tr = useT()
  const lang = useLang()
  const photo = usePlayerPhoto(activeEvent?.player)

  // step through the moments shown in the left pane with the arrow keys too
  // (ignored while typing in an input, so the player search still works)
  useEffect(() => {
    if (!onNavigate) return
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' && nav?.prev) onNavigate(nav.prev)
      else if (e.key === 'ArrowRight' && nav?.next) onNavigate(nav.next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav, onNavigate])

  // the deterministic engine is the instant baseline and the fallback
  const localDecision = useMemo(
    () => computeDecision(frameData, activeEvent),
    [frameData, activeEvent]
  )
  const localDna = useMemo(
    () => computeDNA(frameData, activeEvent, localDecision, stakes),
    [frameData, activeEvent, localDecision, stakes]
  )

  // when Granite has reasoned over the moment, its verdict drives the panel;
  // we keep the local engine's audit `detail` strings on the DNA axes (they are
  // real-data facts) and just swap in Granite's magnitudes.
  const ai = assessment?.source === 'granite' ? assessment : null
  // while Granite is still computing we show a "calculating" state rather than
  // the local baseline number, so the score never visibly jumps when AI lands
  const calculating = assessing && !ai
  const decision = ai ? {
    score: ai.decision.score,
    label: ai.decision.label,
    labelColor: decisionColor(ai.decision.score),
    pros: ai.decision.pros.length ? ai.decision.pros : (localDecision?.pros || []),
    cons: ai.decision.cons.length ? ai.decision.cons : (localDecision?.cons || []),
    difficulty: ai.dna.difficulty,
    components: ai.decision.components || localDecision?.components,
  } : localDecision
  // Stakes is ALWAYS the deterministic engine: it is pure context math
  // (stage/minute/scoreline) that Granite rates unreliably, so the model is not
  // trusted for it. The DNA leverage axis is filled from this same stakes value.
  const effStakes = stakes
  const dna = ai && localDna ? {
    // Granite supplies difficulty/execution/vision/risk; leverage has no Granite
    // value, so the merge keeps the local axis (= deterministic stakes score).
    axes: localDna.axes.map((a) => ({ ...a, value: ai.dna[a.key] ?? a.value })),
    spark: localDna.axes
      .map((a) => ({ ...a, value: ai.dna[a.key] ?? a.value }))
      .reduce((m, a) => (a.value > m.value ? a : m)),
  } : localDna

  // provenance chip: solid once Granite's verdict is in, a pulsing "assessing"
  // state while it computes (so the brief local -> Granite settle reads as
  // intentional, not a number changing on its own)
  const isLocalEstimate = assessment?.source === 'local'
  const aiBadge = ai
    ? <span className="dp-ai-badge">⬢ IBM Granite</span>
    : assessing
      ? <span className="dp-ai-badge dp-ai-badge-pending">⬢ {tr('Granite assessing…')}</span>
      : isLocalEstimate
        ? <span className="dp-ai-badge dp-ai-badge-local" title="IBM Granite is unreachable; showing a local estimate">{tr('local estimate')}</span>
        : null

  // shown in place of a metric while Granite is still computing it
  const calcBox = (
    <div className="dp-calc">
      <span className="dp-spinner" /> {tr('IBM Granite is assessing this moment…')}
    </div>
  )

  const ctx = frameData?.context
  // a penalty is one on one with the keeper: lanes, marking and team-mates are
  // irrelevant, so the situation panel shows only pressure, xG and outcome.
  const isPenalty = activeEvent?.shot_type === 'Penalty'
  // a goal is the best possible outcome, so there is no alternative worth weighing
  // in What If — we just say so rather than listing options.
  const isGoal = (activeEvent?.outcome || ctx?.outcome) === 'Goal'
  // a kick-off must be a pass (Laws of the Game): there is no carry/alternative to
  // weigh, so What If states that rather than listing made-up options.
  const isKickoff = activeEvent?.set_piece === 'Kick Off'

  if (!activeEvent) {
    return (
      <div className="decision-panel">
        <div className="dp-placeholder">
          <div className="dp-placeholder-icon" aria-hidden="true">
            <svg width="76" height="76" viewBox="0 0 64 64" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <polygon points="32,5 59,32 32,59 5,32" />
              <polygon points="13.4,13.4 50.6,13.4 50.6,50.6 13.4,50.6" />
              <circle cx="32" cy="32" r="13.5" />
            </svg>
          </div>
          <div className="dp-placeholder-title" lang={lang}>{tr('Decision Intelligence')}</div>
          <p>
            {tr('Go beyond the highlight.')}<br />
            {tr('FirstTouch recreates the tactical reality of any FIFA World Cup 2022™ moment and analyzes the decision that shaped it.')}
          </p>
        </div>
      </div>
    )
  }

  const typeColor = eventColorOf(activeEvent)
  const flag = flagUrl(activeEvent.team)
  const openPips = ctx ? Math.min(ctx.teammate_count, 10) : 0

  // tabbed views: the core "Decision" read (score + reasoning + situation) is the
  // default; the richer lenses live behind their own tabs.
  const tabs = [
    { key: 'decision', label: 'Decision' },
    { key: 'profile', label: 'Profile', show: !!(effStakes || dna) },
    { key: 'chain', label: 'Consequence Chain' },
    { key: 'whatif', label: 'What If' },
  ].filter((t) => t.show !== false)
  const tab = tabs.some((t) => t.key === activeTab) ? activeTab : 'decision'

  return (
    <div className="decision-panel">
      {/* hero */}
      <div className="dp-hero">
        {photo ? (
          <img className="dp-photo" src={photo} alt={activeEvent.player} />
        ) : (
          <div className="dp-avatar">{initials(activeEvent.player)}</div>
        )}
        <div className="dp-hero-info">
          <div className="dp-name">
            {flag && <img className="dp-flag" src={flag} alt="" />}
            <span>{activeEvent.player || 'Unknown'}</span>
          </div>
          <div className="dp-badges">
            <span className="dp-action" style={{ color: typeColor, borderColor: typeColor }}>
              {tr(eventLabel(activeEvent))}
            </span>
            {ctx?.zone && <span className="dp-zone">{tr(ctx.zone)}</span>}
          </div>
        </div>
        <div className="dp-minute">{activeEvent.minute + 1}&prime;</div>
      </div>

      {nav && (nav.prev || nav.next) && (
        <div className="dp-nav">
          <button
            type="button"
            className="dp-nav-btn"
            disabled={!nav.prev}
            onClick={() => nav.prev && onNavigate(nav.prev)}
            title="Previous moment (←)"
          >
            ‹ {tr('Prev')}
          </button>
          {typeof nav.index === 'number' && nav.total > 0 && (
            <span className="dp-nav-count">{nav.index + 1} / {nav.total}</span>
          )}
          <button
            type="button"
            className="dp-nav-btn"
            disabled={!nav.next}
            onClick={() => nav.next && onNavigate(nav.next)}
            title="Next moment (→)"
          >
            {tr('Next')} ›
          </button>
        </div>
      )}

      {loadingFrame && (
        <div className="dp-loading"><span className="dp-spinner" /> {tr('Analyzing frame…')}</div>
      )}

      {!loadingFrame && !frameData && (
        <div className="dp-no-frame">
          {tr('No 360 freeze frame is available for this event. Pick a moment marked at full opacity in the event list.')}
        </div>
      )}

      {decision && (
        <>
          {/* tab bar */}
          <div className="dp-tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`dp-tab ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => onTabChange?.(t.key)}
              >
                {tr(t.label)}
              </button>
            ))}
          </div>

          {/* DECISION: score + reasoning + situation (the original panel) */}
          {tab === 'decision' && (
            <>
              <div className="dp-section">
                <div className="dp-section-title">
                  {tr('ACTION QUALITY')}
                  {aiBadge}
                </div>
                <div className="dp-section-q">{tr('How good was the action? (stage and scoreline aside)')}</div>
                {calculating ? calcBox : (
                  <>
                    <div className="dp-score-row">
                      <span className="dp-score" style={{ color: decision.labelColor }}>
                        {decision.score}
                      </span>
                      <span className="dp-score-label" style={{ color: decision.labelColor }}>
                        {tr(decision.label)}
                      </span>
                    </div>
                    <div className="dp-score-bar">
                      <motion.div
                        className="dp-score-fill"
                        style={{ background: decision.labelColor }}
                        initial={{ width: 0 }}
                        animate={{ width: `${decision.score}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut' }}
                      />
                    </div>
                    <ComponentBars components={decision.components} />
                  </>
                )}
              </div>

              {!calculating && (
                <div className="dp-section">
                  <div className="dp-section-title">{tr('REASONING')}</div>
                  <ul className="dp-checklist">
                    {decision.pros.map((p, i) => (
                      <li key={`p${i}`} className="dp-check dp-check-pro">✓ {translateReason(lang, p)}</li>
                    ))}
                    {decision.cons.map((c, i) => (
                      <li key={`c${i}`} className="dp-check dp-check-con">✗ {translateReason(lang, c)}</li>
                    ))}
                    {decision.pros.length === 0 && decision.cons.length === 0 && (
                      <li className="dp-check dp-check-neutral">{tr('Neutral situation, no strong factors')}</li>
                    )}
                  </ul>
                </div>
              )}

              {!calculating && ai?.reasoning_audit?.note && (
                <div className="dp-section">
                  <div className="dp-section-title">{tr('AI FIELD READ')}</div>
                  <p className="dp-audit-note">{ai.reasoning_audit.note}</p>
                  <div className="dp-audit-tags">
                    <span className="dp-audit-tag">
                      {(ai.reasoning_audit.threats || []).length} {tr((ai.reasoning_audit.threats || []).length === 1 ? 'threat' : 'threats')}
                    </span>
                    <span className="dp-audit-tag">
                      {(ai.reasoning_audit.viable_targets || []).length} {tr((ai.reasoning_audit.viable_targets || []).length === 1 ? 'open target' : 'open targets')}
                    </span>
                    {(ai.reasoning_audit.vetoed_targets || []).length > 0 && (
                      <span className="dp-audit-tag dp-audit-veto">
                        {ai.reasoning_audit.vetoed_targets.length} {tr(ai.reasoning_audit.vetoed_targets.length === 1 ? 'blocked lane' : 'blocked lanes')} {tr('vetoed')}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {ctx && (
                <div className="dp-section dp-section-last">
                  <div className="dp-section-title">{tr('SITUATION')}</div>
                  <div className="dp-stat-row">
                    <span>{tr('Pressure')}</span>
                    <span className={`dp-pressure dp-pressure-${(ctx.pressure || 'low').toLowerCase()}`}>
                      {tr(ctx.pressure)}
                    </span>
                  </div>
                  {!isPenalty && (
                    <div className="dp-stat-row">
                      <span>{tr('Nearest defender')}</span>
                      <span className="dp-stat-val">
                        {typeof ctx.nearest_defender_dist === 'number'
                          ? `${ctx.nearest_defender_dist.toFixed(1)}m` : '-'}
                      </span>
                    </div>
                  )}
                  {!isPenalty && (
                    <div className="dp-stat-row">
                      <span>{tr('Open teammates')}</span>
                      <span className="dp-pips">
                        {Array.from({ length: openPips }).map((_, i) => (
                          <span
                            key={i}
                            className={`dp-pip ${i < ctx.open_teammate_count ? 'dp-pip-open' : ''}`}
                          />
                        ))}
                        <span className="dp-stat-val">{ctx.open_teammate_count}/{ctx.teammate_count}</span>
                      </span>
                    </div>
                  )}
                  {!isPenalty && (
                    <div className="dp-stat-row">
                      <span>{tr('Opponents involved')}</span>
                      <span className="dp-stat-val">{ctx.opponent_count}</span>
                    </div>
                  )}
                  {typeof ctx.xg === 'number' && (
                    <div className="dp-stat-row">
                      <span>{tr('Expected goals')}</span>
                      <span className="dp-stat-val dp-xg">{ctx.xg.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="dp-stat-row">
                    <span>{tr('Outcome')}</span>
                    <span className={`dp-stat-val ${ctx.outcome === 'Goal' ? 'dp-outcome-goal' : ''}`}>
                      {tr(prettyOutcome(ctx.outcome)) || '-'}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* PROFILE: how much the moment mattered (stakes gauge) + the decision's DNA */}
          {tab === 'profile' && (
            <>
              {effStakes && (
                <div className="dp-section">
                  <div className="dp-section-title">
                    {tr('MOMENT STAKES')}
                    <span className="dp-ai-badge dp-ai-badge-ctx" title="Computed from match context: stage, minute, scoreline">⬢ {tr('Context model')}</span>
                  </div>
                  <div className="dp-section-q">{tr('How much could this moment change the result?')}</div>
                  <StakesGauge score={effStakes.score} level={effStakes.level} color={effStakes.color} />
                  <div className="dp-score-row dp-gauge-level">
                    <span className="dp-stakes-level" style={{ color: effStakes.color }}>
                      {tr(effStakes.level)}
                    </span>
                  </div>
                  <div className="dp-stakes-drivers">
                    {effStakes.drivers.map((d, i) => (
                      <span key={i} className="dp-stakes-chip">{translateDriver(lang, d)}</span>
                    ))}
                  </div>
                </div>
              )}

              {dna && (
                <div className="dp-section dp-section-last">
                  <div className="dp-section-title">
                    {tr('DECISION DNA')}
                    {aiBadge}
                  </div>
                  <div className="dp-section-q">{tr('The fingerprint of the action, not a rating')}</div>
                  {calculating ? calcBox : (
                    <div className="dna-wrap">
                      <DecisionRadar axes={dna.axes} color={decision.labelColor} />
                      <div className="dna-spark">
                        {tr('Defined by')} <b>{tr(dna.spark.label).toLowerCase()}</b>: {translateDetail(lang, dna.spark.detail)}.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* WHAT IF */}
          {tab === 'whatif' && (
            <div className="dp-section dp-section-last">
              <div className="dp-section-q">{tr('What were the alternatives, and was this the best call?')}</div>

              {isGoal && (
                <div className="dp-wi-verdict" style={{ borderColor: 'var(--green)' }}>
                  <div className="dp-wi-verdict-top">
                    <span className="dp-wi-badge" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}>{tr('Goal')}</span>
                  </div>
                  <div className="dp-wi-headline">{tr('The best possible outcome')}</div>
                  <p className="dp-wi-detail">{tr('He scored. Nothing beats the back of the net, so there is no better option to weigh here.')}</p>
                </div>
              )}

              {!isGoal && isPenalty && (
                <div className="dp-wi-verdict" style={{ borderColor: 'var(--gold)' }}>
                  <div className="dp-wi-verdict-top">
                    <span className="dp-wi-badge" style={{ color: 'var(--gold)', borderColor: 'var(--gold)' }}>{tr('Penalty')}</span>
                  </div>
                  <div className="dp-wi-headline">{tr('No alternative to weigh')}</div>
                  <p className="dp-wi-detail">{tr('A penalty is one on one with the keeper from the spot. There is no pass or carry to consider, only whether he beats the goalkeeper.')}</p>
                </div>
              )}

              {!isGoal && !isPenalty && isKickoff && (
                <div className="dp-wi-verdict" style={{ borderColor: 'var(--gold)' }}>
                  <div className="dp-wi-verdict-top">
                    <span className="dp-wi-badge" style={{ color: 'var(--gold)', borderColor: 'var(--gold)' }}>{tr('Kick-off')}</span>
                  </div>
                  <div className="dp-wi-headline">{tr('No alternative to weigh')}</div>
                  <p className="dp-wi-detail">{tr('A kick-off must be a pass to a team-mate to restart play. There is no carry or more ambitious option to consider here.')}</p>
                </div>
              )}

              {!isGoal && !isPenalty && !isKickoff && whatifing && !whatif && (
                <div className="dp-loading"><span className="dp-spinner" /> {tr('Weighing every option…')}</div>
              )}

              {!isGoal && !isPenalty && !isKickoff && whatif && (() => {
                const fmtVal = (o) => {
                  const x = o.value
                  if (typeof x !== 'number') return '—'
                  if (o.value_kind === 'xG') return `${x.toFixed(2)} xG`
                  return `${x.toFixed(3)} xT`
                }
                const v = whatif.verdict || {}
                const vClass = v.verdict || whatif.summary?.verdict_class
                const vColor = vClass === 'optimal' ? 'var(--green)'
                  : vClass === 'better_available' ? 'var(--red)' : 'var(--gold)'
                const vLabel = vClass === 'optimal' ? 'Optimal choice'
                  : vClass === 'better_available' ? 'Better option was on'
                  : vClass === 'forced' ? 'Forced choice' : 'Sound choice'
                const granite = v.source === 'granite'
                return (
                  <>
                    <div className="dp-wi-verdict" style={{ borderColor: vColor }}>
                      <div className="dp-wi-verdict-top">
                        <span className="dp-wi-badge" style={{ color: vColor, borderColor: vColor }}>{tr(vLabel)}</span>
                        <span className={`dp-wi-prov ${granite ? 'is-granite' : 'is-local'}`}>
                          {granite ? '⬢ IBM Granite' : tr('local estimate')}
                        </span>
                      </div>
                      {v.headline && <div className="dp-wi-headline">{v.headline}</div>}
                      {v.detail && <p className="dp-wi-detail">{v.detail}</p>}
                    </div>

                    <div className="dp-wi-list">
                      {whatif.options?.map((o, i) => (
                        <div key={i} className={`dp-wi-row ${o.chosen ? 'is-chosen' : ''} ${o.best ? 'is-best' : ''}`}>
                          <span className="dp-wi-val">{fmtVal(o)}</span>
                          <span className="dp-wi-label">{translateWhatifLabel(lang, o.label)}</span>
                          <span className="dp-wi-tags">
                            {o.chosen && <span className="dp-wi-tag is-chosen">{tr('chosen')}</span>}
                            {o.best && <span className="dp-wi-tag is-best">{tr('best')}</span>}
                            {o.blocked && <span className="dp-wi-tag is-blocked">{tr('blocked')}</span>}
                            {o.estimate && <span className="dp-wi-tag">{tr('est')}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="dp-wi-foot">
                      {tr('Options valued by the threat (xT) of the position the ball reaches (real Karun Singh surface); the shot by estimated xG.')}
                    </div>
                  </>
                )
              })()}
            </div>
          )}

          {/* CHAIN */}
          {tab === 'chain' && (
            <div className="dp-section dp-section-last">
              <ConsequenceChain match={match} activeEvent={activeEvent} onSelect={onNavigate} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

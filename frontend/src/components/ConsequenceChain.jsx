// Consequence Chain — the REAL possession sequence the selected decision was
// part of, straight from StatsBomb (no modelling). Shows what the move became:
// the touches in order, the selected event marked, and the real terminal
// outcome (goal / saved shot / lost ball).
import { useEffect, useState } from 'react'
import axios from 'axios'
import { prettyOutcome } from '../decisionScore.js'
import { useT } from '../i18n.jsx'
import './ConsequenceChain.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const TYPE_ABBR = {
  Pass: 'pass', Shot: 'shot', Dribble: 'dribble', Carry: 'carry',
  Pressure: 'press', Interception: 'interception', Clearance: 'clearance',
  Block: 'block', 'Goal Keeper': 'keeper',
}

function lastName(name) {
  if (!name) return '—'
  const parts = name.trim().split(' ')
  return parts[parts.length - 1]
}

export default function ConsequenceChain({ match, activeEvent, onSelect }) {
  const t = useT()
  const [chain, setChain] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!match || !activeEvent || activeEvent.possession == null) {
      setChain(null)
      return
    }
    let cancelled = false
    setLoading(true)
    axios.get(`${API}/matches/${match.match_id}/possession/${activeEvent.possession}`)
      .then((r) => { if (!cancelled) setChain(r.data) })
      .catch(() => { if (!cancelled) setChain(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [match, activeEvent])

  if (!activeEvent) return null
  if (loading) {
    return (
      <div className="cc">
        <div className="cc-title">{t('CONSEQUENCE CHAIN')}</div>
        <div className="cc-loading"><span className="cc-spin" /> {t('Tracing the move…')}</div>
      </div>
    )
  }
  if (!chain || chain.length === 0) return null

  const self = chain.find((e) => e.id === activeEvent.id)
  const corePoss = self?.possession ?? activeEvent.possession

  // Penalties and free kicks are set pieces with no build-up worth chaining, so
  // we show them as a single standalone moment (the strike or the delivery).
  const setPiece = activeEvent.set_piece || activeEvent.shot_type
  const standalone = setPiece === 'Penalty' || setPiece === 'Free Kick'

  let steps, core, terminal
  if (standalone) {
    steps = [self || activeEvent]
    core = steps
    terminal = steps[0]
  } else {
    // The chain is the possession's spell, bracketed by the opponent's touch just
    // before (where the ball was won off them) and just after (where possession
    // changed). Those bracket events have a DIFFERENT possession id, so the team's
    // own move is the events sharing the selected moment's possession.
    core = chain.filter((s) => s.possession === corePoss)
    terminal = core[core.length - 1] || chain[chain.length - 1]
    steps = chain
    // the story ends at the goal — don't trail it with the opponent's kick-off, so
    // drop any trailing bracket touches when the move was finished.
    if (terminal?.type === 'Shot' && terminal?.outcome === 'Goal') {
      let end = chain.length
      while (end > 0 && chain[end - 1].possession !== corePoss) end--
      steps = chain.slice(0, end)
    }
  }

  const passes = core.filter((s) => s.type === 'Pass').length
  const verdict = terminalVerdict(terminal, t)

  // line 1: the shape of the move (touches + passes)
  let caption
  if (core.length <= 1) {
    caption = t('A standalone action; the consequence was immediate.')
  } else {
    caption = t('{n}-touch move').replace('{n}', core.length)
    if (passes) caption += (passes > 1 ? t(', {n} passes') : t(', {n} pass')).replace('{n}', passes)
    caption += '.'
  }
  // line 2: how it ended — a goal, or broken up after the terminal action
  const resolution = resolutionLine(terminal, t)

  return (
    <div className="cc">
      <div className="cc-title">
        {t('CONSEQUENCE CHAIN')}
        <span className="cc-real">· {t('Real possession data')}</span>
      </div>

      <PitchMap
        steps={steps}
        terminal={terminal}
        activeId={activeEvent.id}
        corePoss={corePoss}
        homeTeam={match?.home_team}
        onSelect={onSelect}
        t={t}
      />

      <ol className="cc-list">
        {steps.map((s, i) => {
          const active = s.id === activeEvent.id
          const home = s.team === match?.home_team
          // the opponent's bracketing touches (different possession): the one
          // before is where the ball was won, the one after is where it was lost
          const context = s.possession !== corePoss
          const tag = context && i === 0 ? t('ball won here')
            : context && i === steps.length - 1 ? t('possession changes')
            : null
          return (
            <li key={s.id} className="cc-step-item" style={{ animationDelay: `${Math.min(i * 0.045, 0.5)}s` }}>
              <button
                type="button"
                className={`cc-step ${active ? 'cc-active' : ''} ${context ? 'cc-context' : ''}`}
                onClick={() => onSelect?.(s)}
                title={t('Jump to this moment')}
              >
                <span className={`cc-node ${home ? 'cc-home' : 'cc-away'}`} />
                <span className="cc-type">{t(TYPE_ABBR[s.type] || (s.type || '').toLowerCase())}</span>
                <span className="cc-player">
                  {s.jersey_number != null && <b>{s.jersey_number}</b>} {lastName(s.player)}
                </span>
                {tag && <span className="cc-bracket-tag">{tag}</span>}
                {!tag && s.outcome && s.outcome !== 'Complete' && (
                  <span className="cc-out">{t(prettyOutcome(s.outcome))}</span>
                )}
                {active && <span className="cc-here">{t('you are here')}</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <div className={`cc-verdict cc-${verdict.tone}`}>
        <span className="cc-verdict-dot" />
        <span className="cc-verdict-badge">{verdict.label}</span>
        <span className="cc-caption">{caption}</span>
        {resolution && <span className="cc-resolution">{resolution}</span>}
      </div>
    </div>
  )
}

// A little top-down pitch that plots where every touch in the chain happened and
// traces the move across it. The possession team always attacks toward x=120
// (StatsBomb normalises to this), so the move reads left-to-right. Points are
// clickable, just like the list rows.
function PitchMap({ steps, terminal, activeId, corePoss, homeTeam, onSelect, t }) {
  const [hover, setHover] = useState(null)
  const pts = steps
    .filter((s) => Array.isArray(s.location) && s.location.length >= 2)
    .map((s) => {
      // StatsBomb normalises each event so its OWN possession team attacks +x. The
      // opponent's bracketing touches are in the opposite frame, so mirror them to
      // share the core team's pitch (then they sit right at the won/lost point).
      const context = s.possession !== corePoss
      return {
        x: context ? 120 - s.location[0] : s.location[0],
        y: context ? 80 - s.location[1] : s.location[1],
        home: s.team === homeTeam,
        active: s.id === activeId,
        context,
        step: s,
      }
    })
  if (pts.length < 1) return null
  const path = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const STEP = 0.13   // seconds between each touch appearing

  // a small arrowhead at the midpoint of each segment, rotated to its direction
  const arrows = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    if (Math.hypot(dx, dy) < 4) continue   // skip arrows on very short hops
    arrows.push({
      key: i,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      ang: (Math.atan2(dy, dx) * 180) / Math.PI,
      delay: (i + 0.5) * STEP,
    })
  }

  // if the move ended in a shot, draw the strike itself: from the shot spot to
  // where it ended (the goal, or wide/short), coloured by the outcome.
  let shot = null
  if (terminal && terminal.type === 'Shot'
      && Array.isArray(terminal.location) && Array.isArray(terminal.end_location)) {
    const o = terminal.outcome
    shot = {
      x1: terminal.location[0],
      y1: terminal.location[1],
      x2: Math.max(0, Math.min(120, terminal.end_location[0])),
      y2: Math.max(0, Math.min(80, terminal.end_location[1])),
      tone: o === 'Goal' ? 'goal'
        : ['Saved', 'Saved To Post', 'Blocked', 'Post', 'Saved Off T'].includes(o) ? 'shot'
          : 'off',
      delay: pts.length * STEP,
    }
    shot.ang = (Math.atan2(shot.y2 - shot.y1, shot.x2 - shot.x1) * 180) / Math.PI
  }

  return (
    <div className="cc-pitch">
      <span className="cc-pitch-attack">{t('ATTACK')} &rarr;</span>
      <div className="cc-pitch-stage">
      <svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid meet">
        {/* turf stripes */}
        {[0, 24, 48, 72, 96].map((x) => (
          <rect key={x} x={x} y="0" width="24" height="80"
            fill={(x / 24) % 2 ? 'rgba(255,255,255,0.018)' : 'transparent'} />
        ))}
        {/* markings */}
        <g className="cc-pitch-line">
          <rect x="0.5" y="0.5" width="119" height="79" rx="1.5" />
          <line x1="60" y1="0" x2="60" y2="80" />
          <circle cx="60" cy="40" r="10" />
          <rect x="0.5" y="18" width="17.5" height="44" />
          <rect x="102" y="18" width="17.5" height="44" />
          <rect x="0.5" y="30" width="6" height="20" />
          <rect x="113.5" y="30" width="6" height="20" />
          <line x1="0.5" y1="36" x2="0.5" y2="44" className="cc-pitch-goal" />
          <line x1="119.5" y1="36" x2="119.5" y2="44" className="cc-pitch-goal" />
        </g>
        <circle cx="60" cy="40" r="0.9" className="cc-pitch-spot" />
        <circle cx="12" cy="40" r="0.9" className="cc-pitch-spot" />
        <circle cx="108" cy="40" r="0.9" className="cc-pitch-spot" />
        {/* the move path */}
        {pts.length > 1 && <polyline points={path} className="cc-pitch-path" />}
        {/* directional arrowheads at each segment midpoint */}
        {arrows.map((ar) => (
          <path
            key={ar.key}
            className="cc-pitch-arrow"
            d="M-1.7,-1.5 L1.9,0 L-1.7,1.5 Z"
            transform={`translate(${ar.mx.toFixed(1)} ${ar.my.toFixed(1)}) rotate(${ar.ang.toFixed(0)})`}
            style={{ animationDelay: `${ar.delay.toFixed(2)}s` }}
          />
        ))}
        {/* the shot itself, if the move ended in one */}
        {shot && (
          <g style={{ animationDelay: `${shot.delay.toFixed(2)}s` }} className="cc-shot-g">
            <line
              x1={shot.x1.toFixed(1)} y1={shot.y1.toFixed(1)}
              x2={shot.x2.toFixed(1)} y2={shot.y2.toFixed(1)}
              className={`cc-pitch-shot cc-shot-${shot.tone}`}
            />
            <path
              className={`cc-pitch-shot-head cc-shot-${shot.tone}`}
              d="M-2.4,-2 L2.6,0 L-2.4,2 Z"
              transform={`translate(${shot.x2.toFixed(1)} ${shot.y2.toFixed(1)}) rotate(${shot.ang.toFixed(0)})`}
            />
          </g>
        )}
        {/* the touches — pop in one after another, tracing the move */}
        {pts.map((p, i) => (
          <circle
            key={p.step.id}
            cx={p.x}
            cy={p.y}
            r={p.active ? 3.1 : 2.2}
            className={`cc-pt ${p.home ? 'cc-pt-home' : 'cc-pt-away'}`
              + (p.active ? ' cc-pt-active' : '') + (p.context ? ' cc-pt-context' : '')}
            style={{ animationDelay: `${(i * STEP).toFixed(2)}s` }}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover((h) => (h?.step.id === p.step.id ? null : h))}
            onClick={() => onSelect?.(p.step)}
          />
        ))}
      </svg>

      {hover && (
        <div
          className={'cc-tip'
            + (hover.y < 20 ? ' cc-tip-below' : '')
            + (hover.x > 86 ? ' cc-tip-r' : hover.x < 34 ? ' cc-tip-l' : ' cc-tip-c')}
          style={{
            left: `${(hover.x / 120 * 100).toFixed(1)}%`,
            top: `${(hover.y / 80 * 100).toFixed(1)}%`,
            transform: `translate(${hover.x > 86 ? '-100%' : hover.x < 34 ? '0%' : '-50%'}, `
              + `${hover.y < 20 ? '8px' : 'calc(-100% - 8px)'})`,
          }}
        >
          <span className={`cc-tip-dot ${hover.home ? 'cc-tip-home' : 'cc-tip-away'}`} />
          <span className="cc-tip-type">{t(TYPE_ABBR[hover.step.type] || (hover.step.type || '').toLowerCase())}</span>
          <span className="cc-tip-player">
            {hover.step.jersey_number != null && <b>{hover.step.jersey_number}</b>}{lastName(hover.step.player)}
          </span>
          {hover.step.outcome && hover.step.outcome !== 'Complete' && (
            <span className="cc-tip-out">{t(prettyOutcome(hover.step.outcome))}</span>
          )}
        </div>
      )}
      </div>
    </div>
  )
}

// One plain line on how the move ended: a goal (named), or broken up after the
// terminal action (e.g. "Move broken up after Tagliafico's incomplete pass.").
function resolutionLine(terminal, t) {
  if (!terminal) return ''
  const who = lastName(terminal.player)
  if (terminal.type === 'Shot' && terminal.outcome === 'Goal') {
    return t('Ended in a goal, finished by {name}.').replace('{name}', who)
  }
  // a completed delivery (e.g. a standalone free kick into the box) wasn't broken
  // up, so there's no "broken up after" line to show
  if (terminal.type !== 'Shot' && terminal.outcome === 'Complete') return ''
  let how
  if (terminal.type === 'Shot') {
    const o = terminal.outcome
    how = o === 'Blocked' ? t('blocked shot')
      : ['Saved', 'Saved To Post', 'Saved Off T'].includes(o) ? t('saved shot')
      : t('shot off target')
  } else if (terminal.type === 'Pass') {
    how = t('incomplete pass')
  } else if (terminal.type === 'Dribble' || terminal.type === 'Carry') {
    how = t('lost ball')
  } else {
    how = t(TYPE_ABBR[terminal.type] || (terminal.type || '').toLowerCase())
  }
  return t("Move broken up after {name}'s {how}.").replace('{name}', who).replace('{how}', how)
}

function terminalVerdict(ev, t) {
  if (!ev) return { label: t('OPEN'), tone: 'neutral' }
  if (ev.type === 'Shot') {
    if (ev.outcome === 'Goal') return { label: t('GOAL'), tone: 'goal' }
    if (['Saved', 'Saved To Post', 'Post', 'Saved Off T'].includes(ev.outcome)) return { label: t('SHOT SAVED'), tone: 'shot' }
    if (ev.outcome === 'Blocked') return { label: t('SHOT BLOCKED'), tone: 'shot' }
    return { label: t('SHOT OFF TARGET'), tone: 'lost' }
  }
  const lost = ['Incomplete', 'Out', 'Lost', 'Lost In Play', 'Lost Out', 'Pass Offside']
  if (lost.includes(ev.outcome)) return { label: t('POSSESSION LOST'), tone: 'lost' }
  return { label: t('MOVE BROKEN UP'), tone: 'neutral' }
}

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useT } from '../i18n.jsx'
import './MomentumTimeline.css'

// Karun Singh's published Expected Threat (xT) surface: a 12x8 grid (pitch
// length x width) where each cell is the probability that having the ball there
// leads to a goal within the next few actions. It's symmetric about the centre
// line and rises sharply toward the opponent's goal (the high columns). Because
// StatsBomb normalises every team's events to attack toward x=120, this grid
// applies directly to both sides. Source: karun.in "Introducing Expected Threat".
const XT_GRID = [
  [0.00638303, 0.00779616, 0.00844854, 0.00977659, 0.01126267, 0.01248588, 0.01473348, 0.0174553, 0.02122129, 0.02756312, 0.03485072, 0.0379259],
  [0.00750072, 0.00878589, 0.00942382, 0.0105949, 0.01214719, 0.0138454, 0.01611813, 0.01870347, 0.02401521, 0.02953272, 0.04066992, 0.04647721],
  [0.0088799, 0.00977745, 0.01001304, 0.01110462, 0.01269174, 0.01429128, 0.01685596, 0.01935132, 0.0241224, 0.02855202, 0.05491138, 0.06442595],
  [0.00941056, 0.01082722, 0.01016549, 0.01132376, 0.01262646, 0.01484598, 0.01689528, 0.0199707, 0.02385149, 0.03511326, 0.10805102, 0.25745362],
  [0.00941056, 0.01082722, 0.01016549, 0.01132376, 0.01262646, 0.01484598, 0.01689528, 0.0199707, 0.02385149, 0.03511326, 0.10805102, 0.25745362],
  [0.0088799, 0.00977745, 0.01001304, 0.01110462, 0.01269174, 0.01429128, 0.01685596, 0.01935132, 0.0241224, 0.02855202, 0.05491138, 0.06442595],
  [0.00750072, 0.00878589, 0.00942382, 0.0105949, 0.01214719, 0.0138454, 0.01611813, 0.01870347, 0.02401521, 0.02953272, 0.04066992, 0.04647721],
  [0.00638303, 0.00779616, 0.00844854, 0.00977659, 0.01126267, 0.01248588, 0.01473348, 0.0174553, 0.02122129, 0.02756312, 0.03485072, 0.0379259],
]

// xT value at a StatsBomb location (pitch is 120 x 80)
function xtAt(loc) {
  if (!Array.isArray(loc)) return 0
  const x = loc[0], y = loc[1]
  if (typeof x !== 'number' || typeof y !== 'number') return 0
  const col = Math.max(0, Math.min(11, Math.floor((x / 120) * 12)))
  const row = Math.max(0, Math.min(7, Math.floor((y / 80) * 8)))
  return XT_GRID[row][col]
}

// Threat = how close the ball got to the opponent's goal, valued by Karun
// Singh's xT surface (which rises sharply toward goal). A touch on the edge of
// the box (~0.10-0.25) is worth far more than one in midfield (~0.01). A shot is
// a direct attempt on goal, so it also carries its real xG on top of where it
// was taken — that's what makes a genuine chance (a close-range shot) tower,
// whether it went in, was saved, or missed.
//
// xG is capped (XG_CAP) for the bar height only: a tap-in or a penalty has a
// huge xG (~0.7-0.8), and if that set the scale every other real chance would be
// scaled down to nothing (which is exactly what happened — only goals showed).
// Capping lets the whole cluster of dangerous chances read as "very high", not
// just the ones that went in. The real xG is untouched everywhere else.
const XG_CAP = 0.35
// Midfield possession carries almost no attacking threat, yet a busy minute of it
// is MANY touches — summing their tiny xT used to pile up into a full spike for a
// nothing moment near the halfway line. Subtracting this floor zeroes out every
// touch up to the attacking-third line (xT grid cols 0-7 are all below it), so
// momentum only builds once the ball actually reaches the final third / box.
const XT_FLOOR = 0.02
function locThreat(loc) {
  return Math.max(0, xtAt(loc) - XT_FLOOR)
}
function eventThreat(ev) {
  const t = ev.type
  if (t === 'Shot') {
    const xg = typeof ev.xg === 'number' ? ev.xg : 0.05
    return locThreat(ev.location) + Math.min(xg, XG_CAP)
  }
  if (t === 'Carry') return locThreat(ev.location)
  if ((t === 'Pass' || t === 'Dribble') && ev.outcome === 'Complete') return locThreat(ev.location)
  return 0
}

const CHART_H = 126       // canvas css height
const MARK_TOP = 22       // space above each block for home goal/card markers
const MARK_BOT = 22       // space below each block for away goal/card markers
const PAD_X = 8
const GAP = 8             // px between period blocks (the gap reads as the divider)

// StatsBomb periods we chart, left to right. The shootout (period 5) is not
// open-play momentum, so it's deliberately absent.
const PERIODS = [
  { period: 1, label: '1st' },
  { period: 2, label: '2nd' },
  { period: 3, label: 'ET1' },
  { period: 4, label: 'ET2' },
]

// Lay the per-period blocks out left to right, each given a width proportional
// to how many minutes it spans, with a fixed GAP (the divider) between them.
// Returns [{ seg, x0, w }]. Shared by draw() and onClick() so both agree on
// exactly where every minute sits.
function layout(segments, w) {
  const totalSpan = segments.reduce((a, s) => a + s.span, 0) || 1
  const nGaps = Math.max(0, segments.length - 1)
  const usableW = w - PAD_X * 2 - GAP * nGaps
  let cursorX = PAD_X
  return segments.map(s => {
    const segW = (s.span / totalSpan) * usableW
    const g = { seg: s, x0: cursorX, w: segW }
    cursorX += segW + GAP
    return g
  })
}

// x pixel for an event, found via its PERIOD (not raw minute) so first-half
// stoppage time can't land on top of the second half.
function xForEvent(geom, period, minute) {
  const g = geom.find(x => x.seg.period === period)
  if (!g) return null
  const { minMin, span } = g.seg
  const idx = Math.max(0, Math.min(span - 1, minute - minMin))
  return g.x0 + (idx + 0.5) * (g.w / span)
}

// the football marker drawn at each goal — a real ball, loaded once and reused.
const ballImg = new Image()
ballImg.src = '/ball.png'

export default function MomentumTimeline({ events, match, activeEvent, onSelect }) {
  const tr = useT()
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)

  const model = useMemo(() => {
    if (!match || events.length === 0) return null
    const goals = []
    const cards = []
    const segments = []

    // Build one block per period. Bucketing is by (minute - period's first
    // minute), so each half has its own 0-based timeline — this is what fixes
    // the bug where StatsBomb's overlapping minute numbers collided.
    for (const P of PERIODS) {
      const evs = events.filter(e => (e.period ?? 1) === P.period)
      if (evs.length === 0) continue
      const minMin = Math.min(...evs.map(e => e.minute))
      const maxMin = Math.max(...evs.map(e => e.minute))
      const span = maxMin - minMin + 1
      const home = new Array(span).fill(0)
      const away = new Array(span).fill(0)

      for (const ev of evs) {
        const isHome = ev.team === match.home_team
        const idx = ev.minute - minMin
        const t = eventThreat(ev)
        // accumulate every touch's threat into the minute (territory + chances),
        // so a side camped in the final third builds a sustained wave of bars and
        // a chance spikes on top — the dense broadcast "attack momentum" look,
        // rather than a few isolated goal spikes over a flat line.
        if (isHome) home[idx] += t
        else away[idx] += t
        if (ev.type === 'Shot' && ev.outcome === 'Goal') {
          goals.push({ period: P.period, minute: ev.minute, home: isHome, ev })
        }
        // only red cards matter to momentum (a sending-off changes the game);
        // yellows are noise on this chart, so they're left off.
        if (ev.card?.includes('Red')) {
          cards.push({ period: P.period, minute: ev.minute, home: isHome, card: ev.card })
        }
      }

      // net per minute: + home on top, − away on top. One signed bar per minute.
      const net = home.map((h, i) => h - away[i])
      // light center-weighted smoothing gives the momentum its inertia (runs of
      // one colour, like a wave) without averaging away a minute's own surge.
      const smoothed = net.map((_, i) => {
        const l = net[i - 1] ?? 0, r = net[i + 1] ?? 0
        return l * 0.25 + net[i] * 0.5 + r * 0.25
      })
      segments.push({ ...P, minMin, maxMin, span, net: smoothed })
    }
    if (segments.length === 0) return null

    // scale near the top of the distribution (92nd percentile) so the busy
    // mid-range fills the chart densely and only genuine surges reach full,
    // shared across all periods so extra time is comparable to the first half.
    const mags = segments
      .flatMap(s => s.net.map(Math.abs))
      .filter(v => v > 1e-9)
      .sort((a, b) => a - b)
    const peak = mags.length ? Math.max(mags[Math.floor(mags.length * 0.92)], 1e-6) : 1
    return { segments, peak, goals, cards }
  }, [events, match])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = wrap.clientWidth
    canvas.width = w * dpr
    canvas.height = CHART_H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, CHART_H)

    const midY = CHART_H / 2

    // empty state: just the prompt, with no center line crossing through it
    if (!model) {
      ctx.fillStyle = 'rgba(110, 133, 168, 0.5)'
      ctx.font = '10px "IBM Plex Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(tr('Select a match…'), w / 2, midY + 3)
      return
    }

    const { segments, peak, goals, cards } = model
    const geom = layout(segments, w)
    const blockTop = MARK_TOP
    const blockBot = CHART_H - MARK_BOT
    const halfArea = (blockBot - blockTop) / 2 - 2

    // each period is its own filled block: the top half tinted home-colour, the
    // bottom half away-colour (the "attack momentum" zones), a white top border,
    // and the signed per-minute bars on the shared scale.
    for (const g of geom) {
      const { seg } = g
      // filled team zones
      ctx.fillStyle = 'rgba(74, 158, 255, 0.13)'
      ctx.fillRect(g.x0, blockTop, g.w, midY - blockTop)
      ctx.fillStyle = 'rgba(255, 77, 106, 0.13)'
      ctx.fillRect(g.x0, midY, g.w, blockBot - midY)

      // white top border + faint frame so each half is a clean panel
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(g.x0, blockTop + 0.5)
      ctx.lineTo(g.x0 + g.w, blockTop + 0.5)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)'
      ctx.strokeRect(g.x0 + 0.5, blockTop + 0.5, g.w - 1, blockBot - blockTop - 1)

      // centre line (0 momentum)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.beginPath()
      ctx.moveTo(g.x0, midY)
      ctx.lineTo(g.x0 + g.w, midY)
      ctx.stroke()

      // period label, faint, centred in the home zone
      ctx.fillStyle = 'rgba(220, 230, 245, 0.45)'
      ctx.font = '9px "IBM Plex Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(tr(seg.label), g.x0 + g.w / 2, blockTop + 11)

      // a continuous momentum curve for this period: one smoothed point per
      // minute (sub-linear ^0.75 so the dense mid-range stays readable while real
      // surges reach toward full), filled to the centre line and split-coloured —
      // home above, away below.
      const cellW = g.w / seg.span
      const pts = []
      for (let i = 0; i < seg.span; i++) {
        const r = Math.min(1, Math.abs(seg.net[i]) / peak)
        const h = Math.sign(seg.net[i]) * Math.pow(r, 0.75) * halfArea
        const x = seg.span === 1 ? g.x0 + g.w / 2 : g.x0 + (i + 0.5) * cellW
        pts.push({ x, y: midY - h })
      }
      // anchor the curve to the block edges so the fill spans the full width
      pts.unshift({ x: g.x0, y: pts[0].y })
      pts.push({ x: g.x0 + g.w, y: pts[pts.length - 1].y })

      // smooth curve through the points (quadratic midpoints)
      const trace = () => {
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2
          const my = (pts[i].y + pts[i + 1].y) / 2
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
      }
      // the same curve closed down to the centre line: a fillable area
      const area = () => {
        trace()
        ctx.lineTo(g.x0 + g.w, midY)
        ctx.lineTo(g.x0, midY)
        ctx.closePath()
      }
      // fill + stroke each side, clipped to its half so the colour only shows
      // where the curve is on that team's side of the centre line
      const paint = (top, h, fill, stroke) => {
        ctx.save()
        ctx.beginPath()
        ctx.rect(g.x0, top, g.w, h)
        ctx.clip()
        area()
        ctx.fillStyle = fill
        ctx.fill()
        trace()
        ctx.lineWidth = 1.6
        ctx.lineJoin = 'round'
        ctx.strokeStyle = stroke
        ctx.stroke()
        ctx.restore()
      }
      paint(blockTop, midY - blockTop, 'rgba(74, 158, 255, 0.5)', 'rgba(130, 190, 255, 0.95)')
      paint(midY, blockBot - midY, 'rgba(255, 77, 106, 0.5)', 'rgba(255, 125, 150, 0.95)')
    }

    // active event cursor (placed by its period, not raw minute)
    if (activeEvent) {
      const x = xForEvent(geom, activeEvent.period ?? 1, activeEvent.minute)
      if (x != null) {
        ctx.strokeStyle = '#f0a500'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x, blockTop - 2)
        ctx.lineTo(x, blockBot + 2)
        ctx.stroke()
      }
    }

    // red-card markers (above the block for home, below for away)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ff4d6a'
    for (const card of cards) {
      const x = xForEvent(geom, card.period, card.minute)
      if (x == null) continue
      const y = card.home ? blockTop - 8 : blockBot + 4
      ctx.fillRect(x - 3.5, y, 7, 4)
    }

    // goal markers (above the block for home, below for away): the real football
    // image, with a glow + a faint dashed drop line down to the centre so the
    // goal moment clearly stands out as a highlight.
    const BALL = 18
    for (const goal of goals) {
      const x = xForEvent(geom, goal.period, goal.minute)
      if (x == null) continue
      const gy = goal.home ? blockTop - BALL / 2 : blockBot + BALL / 2

      // drop line connecting the ball to the centre axis
      ctx.save()
      ctx.strokeStyle = goal.home ? 'rgba(74, 158, 255, 0.65)' : 'rgba(255, 77, 106, 0.65)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(x, gy)
      ctx.lineTo(x, midY)
      ctx.stroke()
      ctx.restore()

      // soft glow behind the ball
      const glow = ctx.createRadialGradient(x, gy, 1, x, gy, BALL)
      glow.addColorStop(0, 'rgba(255, 245, 210, 0.55)')
      glow.addColorStop(1, 'rgba(255, 245, 210, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, gy, BALL, 0, Math.PI * 2)
      ctx.fill()

      // the ball itself (falls back to a drawn dot until the image loads)
      if (ballImg.complete && ballImg.naturalWidth) {
        ctx.drawImage(ballImg, x - BALL / 2, gy - BALL / 2, BALL, BALL)
      } else {
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(x, gy, BALL / 2, 0, Math.PI * 2)
        ctx.fill()
      }

      // the goal minute, beside the ball (flips to the left near the right edge)
      const label = `${goal.minute + 1}′`
      ctx.font = 'bold 9px "IBM Plex Mono", monospace'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(label).width
      const rightSide = x + BALL / 2 + 4 + tw < w - 2
      ctx.textAlign = rightSide ? 'left' : 'right'
      const lx = rightSide ? x + BALL / 2 + 3 : x - BALL / 2 - 3
      ctx.fillStyle = 'rgba(8, 12, 18, 0.6)'
      ctx.fillRect(rightSide ? lx - 1 : lx - tw - 1, gy - 6, tw + 2, 12)
      ctx.fillStyle = goal.home ? 'rgba(150, 200, 255, 0.97)' : 'rgba(255, 150, 170, 0.97)'
      ctx.fillText(label, lx, gy)
    }
    ctx.textBaseline = 'alphabetic'   // restore for the next redraw's period labels
  }, [model, activeEvent, tr])

  // redraw once the ball image has loaded
  useEffect(() => {
    if (ballImg.complete) return
    const onLoad = () => draw()
    ballImg.addEventListener('load', onLoad)
    return () => ballImg.removeEventListener('load', onLoad)
  }, [draw])

  useEffect(() => { draw() }, [draw])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw])

  const onClick = useCallback((e) => {
    if (!model || events.length === 0) return
    const rect = canvasRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const geom = layout(model.segments, rect.width)

    // a click on (or right next to) a goal marker snaps straight to that goal —
    // goals are sparse and are exactly what people aim for, so don't let the
    // nearest-event search drift onto a moment a few seconds earlier
    let goalHit = null, goalDx = 13
    for (const g of model.goals) {
      if (!g.ev) continue
      const gx = xForEvent(geom, g.period, g.minute)
      if (gx == null) continue
      const dx = Math.abs(gx - clickX)
      if (dx < goalDx) { goalDx = dx; goalHit = g.ev }
    }
    if (goalHit) { onSelect(goalHit); return }

    // which period block was clicked (nearest one if between blocks)
    let g = geom.find(x => clickX >= x.x0 && clickX <= x.x0 + x.w)
    if (!g) {
      let bestD = Infinity
      for (const x of geom) {
        const d = clickX < x.x0 ? x.x0 - clickX : clickX - (x.x0 + x.w)
        if (d < bestD) { bestD = d; g = x }
      }
    }
    if (!g) return
    const seg = g.seg
    const frac = Math.max(0, Math.min(1, (clickX - g.x0) / g.w))
    const clickedMin = seg.minMin + Math.round(frac * (seg.span - 1))

    // only events we can actually reconstruct (have a freeze frame) are selectable
    const framed = (ev) => ev.has_360 || ev.has_shot_freeze_frame
      || ev.shot_type === 'Penalty' || ev.goal_assist || ev.shot_assist

    // a bar is tall because the team it points to had dangerous-zone presence
    // that minute — so land on THAT team's most threatening action there, not
    // whatever event happened to be closest in time (which could be a defender
    // knocking it about in his own half). Mirror the momentum model: rank by the
    // xT value of where the action happened, with shots boosted.
    const favorsHome = (seg.net[clickedMin - seg.minMin] ?? 0) >= 0
    const dominant = favorsHome ? match?.home_team : match?.away_team
    const pickIn = (lo, hi, team) => {
      let pick = null, pickScore = -Infinity
      for (const ev of events) {
        if ((ev.period ?? 1) !== seg.period) continue
        if (ev.minute < lo || ev.minute > hi) continue
        if (team && ev.team !== team) continue
        if (!framed(ev)) continue
        let s = xtAt(ev.location)
        if (ev.type === 'Shot') s += 0.5
        if (s > pickScore) { pickScore = s; pick = ev }
      }
      return pick
    }
    let best = pickIn(clickedMin, clickedMin, dominant)
      || pickIn(clickedMin - 1, clickedMin + 1, dominant)
      || pickIn(clickedMin - 1, clickedMin + 1, null)

    // last resort: nearest reconstructable event in time, within this period
    if (!best) {
      let bestScore = Infinity
      for (const ev of events) {
        if ((ev.period ?? 1) !== seg.period) continue
        if (!framed(ev)) continue
        const d = Math.abs(ev.minute + (ev.second || 0) / 60 - clickedMin)
        const score = d - (ev.type === 'Shot' ? 0.3 : 0)
        if (score < bestScore) { bestScore = score; best = ev }
      }
    }
    if (best) onSelect(best)
  }, [model, events, onSelect, match])

  return (
    <div className="momentum">
      <div className="momentum-header">
        <span className="momentum-title">{tr('MOMENTUM')}</span>
        {match && (
          <span className="momentum-legend">
            <span className="momentum-key"><span className="momentum-swatch momentum-swatch-home" />{tr(match.home_team)}</span>
            <span className="momentum-key"><span className="momentum-swatch momentum-swatch-away" />{tr(match.away_team)}</span>
          </span>
        )}
      </div>
      <div className="momentum-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: CHART_H }}
          onClick={onClick}
        />
      </div>
    </div>
  )
}

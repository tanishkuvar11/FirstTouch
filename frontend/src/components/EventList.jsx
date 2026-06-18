import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { eventColorOf, eventLabel } from '../kitColors.js'
import { flagUrl } from '../flags.js'
import { positionAbbr } from '../positions.js'
import { useT } from '../i18n.jsx'
import './EventList.css'

const FILTERS = ['All', 'Goals', 'Shot', 'Pass', 'Dribble', 'Defence']

// StatsBomb periods: 1 first half, 2 second half, 3/4 extra time, 5 shootout
const PHASES = [
  { label: 'All', key: 'All' },
  { label: '1st', key: 1 },
  { label: '2nd', key: 2 },
  { label: 'ET1', key: 3 },
  { label: 'ET2', key: 4 },
  { label: 'Pens', key: 5 },
]

const SURNAME_PARTICLES = new Set([
  'di', 'de', 'da', 'dos', 'del', 'della', 'van', 'von', 'der', 'den',
  'la', 'le', 'el', 'al', 'mac', 'ter', 'ten',
])

function surname(name) {
  if (!name) return '-'
  const parts = name.trim().split(' ')
  let i = parts.length - 1
  while (i > 0 && SURNAME_PARTICLES.has(parts[i - 1].toLowerCase())) i--
  return parts.slice(i).join(' ')
}

// an event we can put on the pitch: has a 360 frame, the shot's own freeze
// frame, is a penalty (shooter vs keeper), or is an assist (always worth
// showing — synthesized from the passer and the pass arrow)
function reconstructable(e) {
  return e.has_360 || e.has_shot_freeze_frame || e.shot_type === 'Penalty' ||
    e.goal_assist || e.shot_assist
}

export default function EventList({ events, loading, match, activeEvent, onSelect, onNav }) {
  const t = useT()
  const [filter, setFilter] = useState('All')
  const [phase, setPhase] = useState('All')
  const [player, setPlayer] = useState('All')
  const [playerOpen, setPlayerOpen] = useState(false)
  const [playerQuery, setPlayerQuery] = useState('')
  const listRef = useRef(null)
  const activeRef = useRef(null)
  const playerRef = useRef(null)
  const searchRef = useRef(null)

  // map each player to their team, jersey number and position. Only consider
  // events that have 360 data, since those are the only selectable ones.
  const playerInfo = useMemo(() => {
    const map = new Map()
    for (const e of events) {
      if (!reconstructable(e) || !e.player) continue
      if (!map.has(e.player)) {
        map.set(e.player, { team: e.team, jersey: e.jersey_number, position: e.position })
      }
    }
    return map
  }, [events])

  // players grouped by team so the dropdown reads as a team-by-team roster,
  // each row carrying flag + shirt number + name + position; ordered by squad
  // number (then surname) like a real team sheet
  const playerGroups = useMemo(() => {
    const byTeam = {}
    for (const [name, info] of playerInfo) (byTeam[info.team] ||= []).push({ name, ...info })
    const num = j => (typeof j === 'number' ? j : 999)
    return Object.keys(byTeam).sort().map(team => ({
      team,
      players: byTeam[team].sort((a, b) =>
        num(a.jersey) - num(b.jersey) || surname(a.name).localeCompare(surname(b.name))),
    }))
  }, [playerInfo])

  const selectedInfo = player === 'All' ? null : playerInfo.get(player)

  // live search within the player dropdown (name, team or shirt number)
  const visibleGroups = useMemo(() => {
    const q = playerQuery.trim().toLowerCase()
    if (!q) return playerGroups
    return playerGroups
      .map(g => ({
        team: g.team,
        players: g.players.filter(p =>
          p.name.toLowerCase().includes(q) ||
          g.team.toLowerCase().includes(q) ||
          String(p.jersey ?? '').includes(q)),
      }))
      .filter(g => g.players.length > 0)
  }, [playerGroups, playerQuery])

  // only offer the phases this match actually has (1st/2nd always; ET/Pens only
  // if the game went that far), among selectable 360 events
  const availablePhases = useMemo(() => {
    const periods = new Set()
    for (const e of events) if (reconstructable(e)) periods.add(e.period)
    return PHASES.filter(p => p.key === 'All' || periods.has(p.key))
  }, [events])

  const filtered = useMemo(() => {
    const typeMatch = (e) =>
      filter === 'All' ? true
      : filter === 'Goals' ? (e.type === 'Shot' && e.outcome === 'Goal')
      : filter === 'Defence' ? (e.type === 'Interception')
      : e.type === filter
    return events.filter(e =>
      reconstructable(e) &&
      typeMatch(e) &&
      (phase === 'All' || e.period === phase) &&
      (player === 'All' || e.player === player))
  }, [events, filter, phase, player])

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeEvent?.id])

  // every selectable moment in the match, in chronological order — this is what
  // the right-pane prev/next walk, so they step through the whole match
  // regardless of which filters/phase/player are applied to the list.
  const navList = useMemo(() => events.filter(reconstructable), [events])

  // report the absolute prev/next moment (ignoring filters) for external nav
  useEffect(() => {
    if (!onNav) return
    const idx = navList.findIndex(e => e.id === activeEvent?.id)
    if (idx === -1) { onNav(null); return }
    onNav({
      prev: navList[idx - 1] || null,
      next: navList[idx + 1] || null,
      index: idx,
      total: navList.length,
    })
  }, [navList, activeEvent, onNav])

  useEffect(() => {
    setFilter('All'); setPhase('All'); setPlayer('All'); setPlayerOpen(false); setPlayerQuery('')
  }, [match?.match_id])

  // focus the search box when the dropdown opens
  useEffect(() => {
    if (playerOpen) searchRef.current?.focus()
  }, [playerOpen])

  // close the player dropdown on any outside click
  useEffect(() => {
    if (!playerOpen) return
    const onDoc = (e) => {
      if (playerRef.current && !playerRef.current.contains(e.target)) {
        setPlayerOpen(false); setPlayerQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [playerOpen])

  const choosePlayer = (name) => { setPlayer(name); setPlayerOpen(false); setPlayerQuery('') }

  return (
    <div className="event-list">
      <div className="panel-section-title">
        {t('Events')} {filtered.length > 0 && <span className="el-count">{filtered.length}</span>}
      </div>

      <div className="el-filters">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`el-filter ${filter === f ? 'el-filter-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {t(f)}
          </button>
        ))}
      </div>

      {match && availablePhases.length > 1 && (
        <div className="el-phase">
          {availablePhases.map(p => (
            <button
              key={p.label}
              className={`el-phase-btn ${phase === p.key ? 'el-phase-btn-active' : ''}`}
              onClick={() => setPhase(p.key)}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
      )}

      {match && playerInfo.size > 0 && (
        <div className="el-player-filter" ref={playerRef}>
          <button
            className={`el-player-btn ${player !== 'All' ? 'el-player-btn-active' : ''}`}
            onClick={() => setPlayerOpen(o => !o)}
          >
            <span className="el-player-btn-label">
              {selectedInfo && flagUrl(selectedInfo.team) && (
                <img className="el-flag" src={flagUrl(selectedInfo.team)} alt="" />
              )}
              {selectedInfo?.jersey != null && (
                <span className="el-player-num">{selectedInfo.jersey}</span>
              )}
              <span className="el-player-name">{player === 'All' ? t('All players') : player}</span>
              {selectedInfo?.position && (
                <span className="el-player-pos">{positionAbbr(selectedInfo.position)}</span>
              )}
            </span>
            <span className={`el-player-caret ${playerOpen ? 'el-player-caret-open' : ''}`}>▾</span>
          </button>

          {playerOpen && (
            <div className="el-player-menu">
              <input
                ref={searchRef}
                className="el-player-search"
                placeholder={t('Search players…')}
                value={playerQuery}
                onChange={e => setPlayerQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const first = visibleGroups[0]?.players[0]
                    if (first) choosePlayer(first.name)
                  } else if (e.key === 'Escape') {
                    setPlayerOpen(false); setPlayerQuery('')
                  }
                }}
              />
              {!playerQuery && (
                <button
                  className={`el-player-opt ${player === 'All' ? 'el-player-opt-active' : ''}`}
                  onClick={() => choosePlayer('All')}
                >
                  <span className="el-player-name">{t('All players')}</span>
                </button>
              )}
              {visibleGroups.map(g => {
                const flag = flagUrl(g.team)
                return (
                  <div key={g.team} className="el-player-group">
                    <div className="el-player-group-head">
                      {flag && <img className="el-flag" src={flag} alt="" />}
                      {g.team}
                    </div>
                    {g.players.map(p => (
                      <button
                        key={p.name}
                        className={`el-player-opt ${player === p.name ? 'el-player-opt-active' : ''}`}
                        onClick={() => choosePlayer(p.name)}
                      >
                        {flag && <img className="el-flag" src={flag} alt="" />}
                        {p.jersey != null && <span className="el-player-num">{p.jersey}</span>}
                        <span className="el-player-name">{p.name}</span>
                        {p.position && <span className="el-player-pos">{positionAbbr(p.position)}</span>}
                      </button>
                    ))}
                  </div>
                )
              })}
              {visibleGroups.length === 0 && (
                <div className="el-player-noresult">No players match “{playerQuery}”</div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="el-scroll" ref={listRef}>
        {!match && (
          <div className="el-empty">{t('Select a match to load its events')}</div>
        )}
        {match && loading && (
          <div className="el-empty">
            <span className="el-spinner" />
            {t('Loading events & 360 frames…')}<br />
            <small>{t('First load of a match takes a few seconds')}</small>
          </div>
        )}
        {match && !loading && filtered.length === 0 && events.length > 0 && (
          <div className="el-empty">
            No {filter === 'Goals' ? 'goals' : filter === 'Defence' ? 'defensive actions' : filter === 'All' ? 'events' : `${filter.toLowerCase()} events`}
            {player === 'All' ? ' in this match' : ` for ${surname(player)}`}
          </div>
        )}

        {filtered.map((ev, i) => {
          const isActive = activeEvent?.id === ev.id
          const isGoal = ev.type === 'Shot' && ev.outcome === 'Goal'
          const flag = flagUrl(ev.team)
          // only events at the exact same timestamp (a one-second scramble) are
          // marked as continuations; same minute but different second still
          // shows the minute
          const prev = filtered[i - 1]
          const sameInstant = prev && prev.minute === ev.minute && prev.second === ev.second
          return (
            <motion.button
              key={ev.id}
              ref={isActive ? activeRef : null}
              className={`el-row ${isActive ? 'el-row-active' : ''} ${!ev.has_360 ? 'el-row-no360' : ''}`}
              onClick={() => onSelect(ev)}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i * 0.008, 0.25) }}
            >
              <span className="el-dot" style={{ background: eventColorOf(ev) }} />
              <span className="el-main">
                <span className="el-player">
                  {surname(ev.player)}
                  {isGoal && <span className="el-goal">{t('GOAL')}</span>}
                </span>
                <span className="el-team">
                  {flag && <img className="el-flag" src={flag} alt="" />}
                  {t(ev.team)}
                </span>
              </span>
              <span className="el-right">
                <span className="el-badge" style={{ color: eventColorOf(ev), borderColor: eventColorOf(ev) }}>
                  {t(eventLabel(ev))}
                </span>
                <span className="el-minute">
                  {ev.period === 5 ? (
                    <span className="el-pens">{t('PENS')}</span>
                  ) : sameInstant ? (
                    <span className="el-cont" title="same moment">&#8627;</span>
                  ) : (
                    <>{ev.minute + 1}&prime;</>
                  )}
                </span>
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

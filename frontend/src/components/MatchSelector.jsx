import { useEffect, useMemo, useRef, useState } from 'react'
import { flagUrl } from '../flags.js'
import { useT, prettyStage } from '../i18n.jsx'
import './MatchSelector.css'

const STAGE_ORDER = [
  'Group Stage', 'Round of 16', 'Quarter-finals', 'Semi-finals',
  '3rd Place Final', 'Final',
]

export default function MatchSelector({ matches, error, selectedMatch, onSelect }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)

  useEffect(() => {
    const close = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? matches.filter(m =>
          `${m.home_team} ${m.away_team} ${m.stage}`.toLowerCase().includes(q))
      : matches
    const groups = new Map()
    for (const m of filtered) {
      const stage = m.stage || 'Group Stage'
      if (!groups.has(stage)) groups.set(stage, [])
      groups.get(stage).push(m)
    }
    return [...groups.entries()].sort((a, b) => {
      const ia = STAGE_ORDER.indexOf(a[0])
      const ib = STAGE_ORDER.indexOf(b[0])
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  }, [matches, query])

  return (
    <div className="match-selector" ref={rootRef}>
      <div className="panel-section-title">{t('Match')}</div>

      <button
        className={`ms-trigger ${open ? 'ms-trigger-open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {selectedMatch ? (
          <span className="ms-trigger-label">
            <img className="ms-flag" src={flagUrl(selectedMatch.home_team)} alt="" />
            <span className="ms-trigger-teams">
              {t(selectedMatch.home_team)} {selectedMatch.home_score}&ndash;{selectedMatch.away_score} {t(selectedMatch.away_team)}
            </span>
            <img className="ms-flag" src={flagUrl(selectedMatch.away_team)} alt="" />
          </span>
        ) : (
          <span className="ms-trigger-placeholder">
            {error ? t('API offline') : matches.length ? t('Select a match…') : t('Loading 64 matches…')}
          </span>
        )}
        <span className="ms-caret">{open ? '▴' : '▾'}</span>
      </button>

      {error && <div className="ms-error">{error}</div>}

      {open && (
        <div className="ms-dropdown">
          <input
            className="ms-search"
            placeholder={t('Search team or stage…')}
            value={query}
            autoFocus
            onChange={e => setQuery(e.target.value)}
          />
          <div className="ms-list">
            {grouped.map(([stage, ms]) => (
              <div key={stage}>
                <div className="ms-stage">{prettyStage(t(stage))}</div>
                {ms.map(m => (
                  <button
                    key={m.match_id}
                    className={`ms-item ${selectedMatch?.match_id === m.match_id ? 'ms-item-active' : ''}`}
                    onClick={() => { onSelect(m); setOpen(false); setQuery('') }}
                  >
                    <span className="ms-item-teams">
                      <img className="ms-flag" src={flagUrl(m.home_team)} alt="" />
                      {t(m.home_team)}
                      <span className="ms-item-score">{m.home_score}&ndash;{m.away_score}</span>
                      {t(m.away_team)}
                      <img className="ms-flag" src={flagUrl(m.away_team)} alt="" />
                    </span>
                    <span className="ms-item-date">{m.match_date}</span>
                  </button>
                ))}
              </div>
            ))}
            {grouped.length === 0 && <div className="ms-empty">{t('No matches found')}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

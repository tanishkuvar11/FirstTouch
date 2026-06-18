// Line-ups view: each team's starting formation on a half pitch, the subs (the
// player who came on sits greyed behind the slot he took), goal/assist tallies,
// the manager in the corner, and a short IBM Granite read on the tactics.
import { useEffect, useState } from 'react'
import axios from 'axios'
import { resolveKits, getKit, GK_KIT } from '../kitColors.js'
import { flagUrl } from '../flags.js'
import { useT } from '../i18n.jsx'
import './Formations.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// StatsBomb common names are "FirstName Surname(maybe compound)", so dropping the
// first token gives the right label: "Ángel Di María" -> "Di María", "Lionel
// Messi" -> "Messi", "Rodrigo De Paul" -> "De Paul".
function shortName(name) {
  if (!name) return ''
  const p = name.trim().split(/\s+/)
  return p.length > 1 ? p.slice(1).join(' ') : p[0]
}
function managerShort(name) {
  if (!name) return '—'
  const p = name.trim().split(/\s+/)
  return p.length > 1 ? `${p[0][0]}. ${p[p.length - 1]}` : name
}

// the goalkeeper wears a distinct kit so he stands out from the outfield ten
const GK_SHIRT = { primary: GK_KIT.primary, secondary: '#06343d', number: GK_KIT.number }

// a clean short-sleeve football shirt with the jersey number on it
function Shirt({ kit, number, size = 54 }) {
  return (
    <svg className="fm-shirt" width={size} height={size * 40 / 44} viewBox="0 0 44 40">
      <path
        d="M17 5 Q22 9 27 5 L40 10 L36.5 17 L32 13.5 L32 37 L12 37 L12 13.5 L7.5 17 L4 10 Z"
        fill={kit.primary} stroke={kit.secondary} strokeWidth="1.4" strokeLinejoin="round"
      />
      <text x="22" y="29" textAnchor="middle" fontSize="13.5" fontWeight="800" fill={kit.number}>
        {number}
      </text>
    </svg>
  )
}

// manager / coach figure (a person bust) — not an emoji
function ManagerIcon() {
  return (
    <svg className="fm-manager-ico" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <circle cx="12" cy="7" r="3.5" fill="currentColor" />
      <path d="M4.5 21 C4.5 15.6 7.8 12.8 12 12.8 C16.2 12.8 19.5 15.6 19.5 21 Z" fill="currentColor" />
    </svg>
  )
}

// the real football image (matches the goal marker on the momentum chart)
function Ball({ size = 12 }) {
  return <img className="fm-ball" src="/ball.png" width={size} height={size} alt="" aria-hidden="true" />
}

// red down-arrow (subbed off) / green up-arrow (subbed on) badge for the shirt
function SubBadge({ on }) {
  return (
    <span className={`fm-subbadge ${on ? 'fm-sub-on' : 'fm-sub-off'}`}>
      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
        <path d={on ? 'M5 1.5 L8.5 5.5 L6.2 5.5 L6.2 8.5 L3.8 8.5 L3.8 5.5 L1.5 5.5 Z'
          : 'M5 8.5 L1.5 4.5 L3.8 4.5 L3.8 1.5 L6.2 1.5 L6.2 4.5 L8.5 4.5 Z'} fill="#fff" />
      </svg>
    </span>
  )
}

// goal/assist markers pinned to the shirt's top-left corner (the sub arrow sits
// top-right), so a scorer reads cleanly at a glance: the football for goals, a
// blue "A" for assists, each with a small count when more than one.
function ContribBadge({ g, a, small }) {
  if (!g && !a) return null
  return (
    <span className={`fm-cbs ${small ? 'fm-cbs-sm' : ''}`}>
      {g > 0 && (
        <span className="fm-cb-goal">
          <img src="/ball.png" alt="" />
          {g > 1 && <span>{g}</span>}
        </span>
      )}
      {a > 0 && <span className="fm-cb-assist">A{a > 1 ? a : ''}</span>}
    </span>
  )
}

function contribText(p, t) {
  const bits = []
  if (p.goals > 0) bits.push(`${p.goals} ${t(p.goals > 1 ? 'goals' : 'goal')}`)
  if (p.assists > 0) bits.push(`${p.assists} ${t(p.assists > 1 ? 'assists' : 'assist')}`)
  return bits.join(', ')
}

export default function Formations({ match, lang }) {
  const t = useT()
  const [sheet, setSheet] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!match) { setSheet(null); return }
    let cancelled = false
    setLoading(true)
    axios.get(`${API}/matches/${match.match_id}/teamsheet`)
      .then((r) => { if (!cancelled) setSheet(r.data) })
      .catch(() => { if (!cancelled) setSheet(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [match])

  if (!match) {
    return (
      <div className="fm-empty">
        <div className="fm-empty-icon"><Ball size={42} /></div>
        {t('Select a match to see the line-ups.')}
      </div>
    )
  }
  if (loading || !sheet) {
    return <div className="fm-loading"><span className="fm-spin" /> {t('Loading the team sheets…')}</div>
  }

  const kits = resolveKits(sheet.home_team, sheet.away_team)
  const kitOf = (tm) => kits[tm] || getKit(tm)

  return (
    <div className="fm">
      {[sheet.home_team, sheet.away_team].map((team) => (
        <TeamColumn key={team} team={team} info={sheet.teams?.[team]}
          kit={kitOf(team)} matchId={match.match_id} lang={lang} t={t} />
      ))}
    </div>
  )
}

function TeamColumn({ team, info, kit, matchId, lang, t }) {
  const [tactics, setTactics] = useState(null)
  const [loadingProse, setLoadingProse] = useState(false)

  useEffect(() => {
    if (!info) return
    let cancelled = false
    setLoadingProse(true)
    setTactics(null)
    axios.post(`${API}/manager-tactics`, { match_id: matchId, team, lang })
      .then((r) => { if (!cancelled) setTactics(r.data) })
      .catch(() => { if (!cancelled) setTactics(null) })
      .finally(() => { if (!cancelled) setLoadingProse(false) })
    return () => { cancelled = true }
  }, [matchId, team, lang, info])

  if (!info) return null
  const slotCount = {}

  return (
    <div className="fm-team">
      <div className="fm-team-head">
        {flagUrl(team) && <img className="fm-flag" src={flagUrl(team)} alt="" />}
        <span className="fm-team-name">{t(team)}</span>
        {info.formation && <span className="fm-formation">{info.formation}</span>}
      </div>

      <div className="fm-pitch">
        {/* turf + markings live in a clipped layer; players sit ABOVE it so their
            hover tooltips are never cut off by the pitch edge */}
        <div className="fm-turf">
          <div className="fm-arc" />
          <div className="fm-box" />
          <div className="fm-six" />
          <div className="fm-spot" />
          <div className="fm-goal" />
        </div>

        {/* subs: greyed ghosts sitting just behind the slot they took */}
        {info.subs.map((s, i) => {
          const k = `${s.on.x},${s.on.y}`
          const n = (slotCount[k] = (slotCount[k] || 0) + 1)
          const off = `${8 + n * 8}px`
          return (
            <div key={`sub-${i}`} className={`fm-player fm-ghost ${100 - s.on.x < 26 ? 'fm-flip' : ''}`}
              style={{ left: `${s.on.y}%`, top: `${100 - s.on.x}%`, marginLeft: off, marginTop: `-${off}` }}>
              <span className="fm-shirt-wrap">
                <Shirt kit={s.on.position === 'Goalkeeper' ? GK_SHIRT : kit} number={s.on.jersey} size={36} />
                <SubBadge on />
                <ContribBadge g={s.on.goals} a={s.on.assists} small />
              </span>
              <span className="fm-pname">{shortName(s.on.name)}</span>
              <div className="fm-tip">
                <b>{s.on.name}</b>
                <span>{t('On')} {s.minute}{'′'} · {t('for')} {shortName(s.off.name)}</span>
                {contribText(s.on, t) && <span className="fm-tip-c">{contribText(s.on, t)}</span>}
              </div>
            </div>
          )
        })}

        {/* starting XI */}
        {info.starting.map((p) => {
          const offFor = info.subs.find((s) => s.off.player_id === p.player_id)
          return (
            <div key={p.player_id} className={`fm-player ${100 - p.x < 26 ? 'fm-flip' : ''}`}
              style={{ left: `${p.y}%`, top: `${100 - p.x}%` }}>
              <span className="fm-shirt-wrap">
                <Shirt kit={p.position === 'Goalkeeper' ? GK_SHIRT : kit} number={p.jersey} size={48} />
                {offFor && <SubBadge on={false} />}
                <ContribBadge g={p.goals} a={p.assists} />
              </span>
              <span className="fm-pname">{shortName(p.name)}</span>
              <div className="fm-tip">
                <b>{p.name}</b>
                <span>{t(p.position)}{offFor ? ` · ${t('Off')} ${offFor.minute}′` : ''}</span>
                {contribText(p, t) && <span className="fm-tip-c">{contribText(p, t)}</span>}
              </div>
            </div>
          )
        })}

        {/* manager, on the touchline (bottom-right corner of the pitch) */}
        <div className="fm-manager" title={info.manager || ''}>
          <ManagerIcon />
          <span className="fm-manager-txt">
            <small>{t('MANAGER')}</small>
            <b>{managerShort(info.manager)}</b>
          </span>
        </div>
      </div>

      <div className="fm-tactics">
        <div className="fm-tactics-head">
          {t('TACTICAL READ')}
          <span className="fm-granite">{'⬢'} IBM Granite</span>
        </div>
        {loadingProse ? (
          <div className="fm-prose-loading"><span className="fm-spin" /> {t('Reading the tactics…')}</div>
        ) : (
          <p className="fm-prose">{tactics?.prose || '—'}</p>
        )}
      </div>
    </div>
  )
}

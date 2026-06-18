import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import MatchSelector from './components/MatchSelector.jsx'
import EventList from './components/EventList.jsx'
import ThreePitch from './components/ThreePitch.jsx'
import MomentumTimeline from './components/MomentumTimeline.jsx'
import DecisionPanel from './components/DecisionPanel.jsx'
import Formations from './components/Formations.jsx'
import LanguageSelect from './components/LanguageSelect.jsx'
import { LangContext, translate, prettyStage } from './i18n.jsx'
import { flagUrl } from './flags.js'
import { computeStakes } from './stakes.js'
import { computeDecision } from './decisionScore.js'
import { defendersBypassed } from './footballMetrics.js'
import { getAnalyst, DEFAULT_LANG } from './analyst.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// the project's public repo, shown in the footer (override via VITE_GITHUB_URL)
const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || 'https://github.com/tanishkuvar11/FirstTouch'

// once Granite has assessed a moment, keep it so re-clicking the same event is
// instant (no spinner, no refetch). Keyed by match + event id; survives navigation.
const assessCache = new Map()
// same idea for the what-if verdict + option table
const whatifCache = new Map()

export default function App() {
  const [matches, setMatches] = useState([])
  const [matchesError, setMatchesError] = useState(null)
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [events, setEvents] = useState([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [activeEvent, setActiveEvent] = useState(null)
  const [frameData, setFrameData] = useState(null)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const [explanation, setExplanation] = useState(null)
  const [explaining, setExplaining] = useState(false)
  // show an official-tournament badge image if one is dropped in
  // (frontend/public/wc2022-badge.png); otherwise fall back to the text badge
  const [badgeImg, setBadgeImg] = useState(true)
  const [panelTab, setPanelTab] = useState('decision')
  const [assessment, setAssessment] = useState(null)
  const [assessing, setAssessing] = useState(false)
  const [whatif, setWhatif] = useState(null)
  const [whatifing, setWhatifing] = useState(false)
  const [nav, setNav] = useState(null)   // {prev,next,index,total} within the filtered list
  const [view, setView] = useState('analysis')   // 'analysis' (the 3D screen) | 'lineups'
  // analyst language / persona (Nathan EN / Valeria ES / Claire FR / Felix DE)
  const [lang, setLang] = useState(() => localStorage.getItem('ft-lang') || DEFAULT_LANG)
  useEffect(() => { localStorage.setItem('ft-lang', lang) }, [lang])
  const t = (s) => translate(lang, s)
  const streamCtrl = useRef(null)
  const assessCtrl = useRef(null)
  const whatifCtrl = useRef(null)

  useEffect(() => {
    axios.get(`${API}/matches`)
      .then(r => setMatches(r.data))
      .catch(() => setMatchesError('Cannot reach the FirstTouch API. Is the backend running on port 8000?'))
  }, [])

  const selectMatch = useCallback((match) => {
    setSelectedMatch(match)
    setEvents([])
    setActiveEvent(null)
    setFrameData(null)
    setExplanation(null)
    setAssessment(null)
    setLoadingEvents(true)
    axios.get(`${API}/matches/${match.match_id}/events`)
      .then(r => setEvents(r.data))
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false))
  }, [])

  // hard reset: back to the initial "pick a match" state (keeps the match list)
  const resetAll = useCallback(() => {
    streamCtrl.current?.abort()
    assessCtrl.current?.abort()
    whatifCtrl.current?.abort()
    setSelectedMatch(null)
    setEvents([])
    setActiveEvent(null)
    setFrameData(null)
    setExplanation(null)
    setAssessment(null)
    setWhatif(null)
    setExplaining(false)
    setAssessing(false)
    setWhatifing(false)
    setLoadingEvents(false)
    setLoadingFrame(false)
    setPanelTab('decision')
  }, [])

  const selectEvent = useCallback((event) => {
    if (!selectedMatch) return
    streamCtrl.current?.abort()
    assessCtrl.current?.abort()
    whatifCtrl.current?.abort()
    setActiveEvent(event)
    setExplanation(null)
    setWhatif(null)
    // use a cached assessment instantly; otherwise enter "calculating" right away
    // so the panel never flashes the local baseline number before Granite lands
    const cacheKey = `${selectedMatch.match_id}:${event.id}`
    if (assessCache.has(cacheKey)) {
      setAssessment(assessCache.get(cacheKey))
      setAssessing(false)
    } else {
      setAssessment(null)
      setAssessing(true)
    }
    setLoadingFrame(true)
    axios.get(`${API}/matches/${selectedMatch.match_id}/frames/${event.id}`)
      .then(r => setFrameData(r.data))
      .catch(() => setFrameData(null))
      .finally(() => setLoadingFrame(false))
  }, [selectedMatch])

  // running score at the selected moment: goals scored up to and including the
  // active event (excludes the shootout, period 5), so the scorebug reflects the
  // scoreline as it stood when the player made this decision
  const liveScore = useMemo(() => {
    if (!selectedMatch) return { home: 0, away: 0 }
    const cutoff = activeEvent?.index ?? Infinity
    let home = 0, away = 0
    for (const e of events) {
      if ((e.index ?? 0) > cutoff) break
      if (e.type === 'Shot' && e.outcome === 'Goal' && (e.period ?? 1) < 5) {
        if (e.team === selectedMatch.home_team) home++
        else if (e.team === selectedMatch.away_team) away++
      }
    }
    return { home, away }
  }, [events, activeEvent, selectedMatch])

  // the scoreline the player actually faced: goals scored strictly BEFORE this
  // event, so a goal's own outcome isn't baked into the situation it was made in
  // (e.g. an equaliser was taken while still trailing, not while "level").
  const preScore = useMemo(() => {
    if (!selectedMatch) return { home: 0, away: 0 }
    const cutoff = activeEvent?.index ?? Infinity
    let home = 0, away = 0
    for (const e of events) {
      if ((e.index ?? 0) >= cutoff) break
      if (e.type === 'Shot' && e.outcome === 'Goal' && (e.period ?? 1) < 5) {
        if (e.team === selectedMatch.home_team) home++
        else if (e.team === selectedMatch.away_team) away++
      }
    }
    return { home, away }
  }, [events, activeEvent, selectedMatch])

  // situational stakes for the selected moment (game state, not execution).
  // Uses the pre-event score: the decision was made before the ball went in.
  const stakes = useMemo(() => {
    if (!activeEvent || !selectedMatch) return null
    return computeStakes({
      stage: selectedMatch.stage,
      minute: activeEvent.minute,
      period: activeEvent.period,
      actorTeam: activeEvent.team,
      match: selectedMatch,
      liveScore: preScore,
      type: activeEvent.type,
      outcome: activeEvent.outcome,
      shotType: activeEvent.shot_type,
      xg: activeEvent.xg,
      goalAssist: activeEvent.goal_assist,
      shotAssist: activeEvent.shot_assist,
      location: activeEvent.location,
      endLocation: activeEvent.end_location,
    })
  }, [activeEvent, selectedMatch, preScore])

  // Stream the explanation token-by-token straight from Granite. Fires
  // automatically when a frame loads (no button); aborts any in-flight stream
  // so rapid event clicks don't interleave.
  const explainDecision = useCallback(async () => {
    if (!frameData || !activeEvent || !selectedMatch) return
    streamCtrl.current?.abort()
    const ctrl = new AbortController()
    streamCtrl.current = ctrl

    const ctx = frameData.context || {}
    const decision = computeDecision(frameData, activeEvent)

    // Spell out exactly what a goal did to the score so the model never has to
    // guess (scoring while level means going ahead, not "equalising").
    let goalEffect = null
    if (activeEvent.outcome === 'Goal' && activeEvent.period !== 5) {
      const home = activeEvent.team === selectedMatch.home_team
      const me = home ? preScore.home : preScore.away
      const them = home ? preScore.away : preScore.home
      const margin = me - them
      const postHome = preScore.home + (home ? 1 : 0)
      const postAway = preScore.away + (home ? 0 : 1)
      const final = `${postHome}-${postAway}`
      if (margin === 0) goalEffect = `put ${activeEvent.team} ahead ${final}`
      else if (margin > 0) goalEffect = `extended ${activeEvent.team}'s lead to ${final}`
      else if (me + 1 === them) goalEffect = `levelled the match at ${final}`
      else goalEffect = `pulled one back to make it ${final}, still behind`
    }

    // for a kick-off, tell the model EXACTLY which restart it is so it never guesses
    // the wrong half. A goal earlier in the same period means it's a post-goal restart.
    let kickoffLabel = null
    if (activeEvent.set_piece === 'Kick Off') {
      const per = activeEvent.period
      const goalBefore = events.some((e) =>
        e.period === per && (e.index ?? 0) < (activeEvent.index ?? 0)
        && e.type === 'Shot' && e.outcome === 'Goal')
      kickoffLabel = goalBefore ? 'the kick-off restarting play after a goal'
        : per === 1 ? 'the opening kick-off of the match'
        : per === 2 ? 'the kick-off to start the second half'
        : per === 3 ? 'the kick-off to start extra time'
        : per === 4 ? 'the kick-off to start the second period of extra time'
        : 'the kick-off'
    }

    setExplaining(true)
    setExplanation({ explanation: '', source: 'granite', via: '' })

    try {
      const resp = await fetch(`${API}/explain/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          frame: {
            match_id: selectedMatch.match_id,
            event_id: activeEvent.id,
            lang,
            player_name: activeEvent.player,
            team: activeEvent.team,
            home_team: selectedMatch.home_team,
            away_team: selectedMatch.away_team,
            stage: selectedMatch.stage,
            minute: activeEvent.minute + 1,
            action_type: activeEvent.type,
            shot_type: activeEvent.shot_type,
            is_penalty: activeEvent.shot_type === 'Penalty',
            is_kickoff: activeEvent.set_piece === 'Kick Off',
            kickoff_label: kickoffLabel,
            is_shootout: activeEvent.period === 5,
            zone: ctx.zone,
            pressure: ctx.pressure,
            nearest_defender_dist: ctx.nearest_defender_dist,
            open_teammate_count: ctx.open_teammate_count,
            teammate_count: ctx.teammate_count,
            opponent_count: ctx.opponent_count,
            outcome: ctx.outcome,
            xg: ctx.xg,
            tactical: frameData.tactical,
            // situational context (the AI weighs the moment, not just the action)
            scoreline: `${selectedMatch.home_team} ${preScore.home}-${preScore.away} ${selectedMatch.away_team}`,
            goal_effect: goalEffect,
            game_state: stakes?.state,
            stakes_level: stakes?.level,
            stakes_drivers: stakes?.drivers,
            // execution verdict for the model to explain
            decision_score: decision?.score,
            decision_label: decision?.label,
            decision_pros: decision?.pros,
            decision_cons: decision?.cons,
          },
        }),
      })
      if (!resp.ok || !resp.body) throw new Error('stream failed')
      const source = resp.headers.get('X-Granite-Source') || 'granite'
      const via = resp.headers.get('X-Granite-Via') || ''
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setExplanation({ explanation: acc, source, via })
      }
    } catch (err) {
      if (err?.name === 'AbortError') return
      setExplanation({
        explanation: 'The analysis service is unreachable right now. Try again in a moment.',
        source: 'error',
      })
    } finally {
      if (streamCtrl.current === ctrl) setExplaining(false)
    }
  }, [frameData, activeEvent, selectedMatch, preScore, stakes, lang, events])

  // auto-explain on every event: kick the stream off as soon as the frame loads,
  // and re-narrate when the analyst language changes. explainDecision() aborts any
  // in-flight stream first, so switching language mid-generation cleanly cancels
  // the old-language read and starts the new one.
  useEffect(() => {
    if (frameData && activeEvent && selectedMatch) explainDecision()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameData, lang])

  // ask Granite to ASSESS the moment (stakes, decision score, DNA) from the real
  // tracking numbers. The panel uses these when source === 'granite' and falls
  // back to its deterministic engine otherwise, so it is always responsive.
  useEffect(() => {
    if (!frameData || !activeEvent || !selectedMatch) return
    const cacheKey = `${selectedMatch.match_id}:${activeEvent.id}:${lang}`
    if (assessCache.has(cacheKey)) {
      setAssessment(assessCache.get(cacheKey))
      setAssessing(false)
      return
    }
    assessCtrl.current?.abort()
    const ctrl = new AbortController()
    assessCtrl.current = ctrl
    const ctx = frameData.context || {}

    let goalEffect = null
    if (activeEvent.outcome === 'Goal' && activeEvent.period !== 5) {
      const home = activeEvent.team === selectedMatch.home_team
      const me = home ? preScore.home : preScore.away
      const them = home ? preScore.away : preScore.home
      const margin = me - them
      const final = `${preScore.home + (home ? 1 : 0)}-${preScore.away + (home ? 0 : 1)}`
      if (margin === 0) goalEffect = `put ${activeEvent.team} ahead ${final}`
      else if (margin > 0) goalEffect = `extended ${activeEvent.team}'s lead to ${final}`
      else if (me + 1 === them) goalEffect = `levelled the match at ${final}`
      else goalEffect = `pulled one back to make it ${final}, still behind`
    }
    const fp = (activeEvent.location && activeEvent.end_location)
      ? activeEvent.end_location[0] - activeEvent.location[0] : null
    // the facts that decide whether a pass is elite: did it create a goal/shot,
    // how many defenders it took out, and whether it was a through ball. Without
    // these Granite judges a defence-splitting assist as a routine completed pass.
    const bypassed = defendersBypassed(frameData, activeEvent)

    setAssessing(true)
    fetch(`${API}/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        frame: {
          match_id: selectedMatch.match_id, event_id: activeEvent.id, lang,
          player_name: activeEvent.player, team: activeEvent.team, stage: selectedMatch.stage,
          minute: activeEvent.minute + 1, action_type: activeEvent.type, shot_type: activeEvent.shot_type,
          is_penalty: activeEvent.shot_type === 'Penalty', is_shootout: activeEvent.period === 5,
          is_kickoff: activeEvent.set_piece === 'Kick Off',
          zone: ctx.zone, pressure: ctx.pressure, nearest_defender_dist: ctx.nearest_defender_dist,
          open_teammate_count: ctx.open_teammate_count, teammate_count: ctx.teammate_count,
          opponent_count: ctx.opponent_count, outcome: ctx.outcome, xg: ctx.xg,
          scoreline: `${selectedMatch.home_team} ${preScore.home}-${preScore.away} ${selectedMatch.away_team}`,
          goal_effect: goalEffect, game_state: stakes?.state, forward_progress: fp,
          goal_assist: activeEvent.goal_assist, shot_assist: activeEvent.shot_assist,
          defenders_bypassed: bypassed, pass_technique: activeEvent.pass_technique,
        },
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setAssessment(d)
          // only cache a real Granite verdict, so a 'local' fallback (model down)
          // is retried — and re-rolled correctly — once Granite is back
          if (d.source === 'granite') assessCache.set(cacheKey, d)
        }
      })
      .catch((err) => { if (err?.name !== 'AbortError') setAssessment(null) })
      .finally(() => { if (assessCtrl.current === ctrl) setAssessing(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameData, lang])

  // ask the What-If engine to value every option the player had (real xT) and
  // have Granite judge the choice. Fires on frame load, cached per moment.
  useEffect(() => {
    if (!frameData || !activeEvent || !selectedMatch) return
    const cacheKey = `${selectedMatch.match_id}:${activeEvent.id}:${lang}`
    if (whatifCache.has(cacheKey)) {
      setWhatif(whatifCache.get(cacheKey))
      setWhatifing(false)
      return
    }
    whatifCtrl.current?.abort()
    const ctrl = new AbortController()
    whatifCtrl.current = ctrl
    setWhatif(null)
    setWhatifing(true)
    fetch(`${API}/whatif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        frame: { ...frameData, match_id: selectedMatch.match_id, event_id: activeEvent.id, lang },
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setWhatif(d)
          if (d.verdict?.source === 'granite') whatifCache.set(cacheKey, d)
        }
      })
      .catch((err) => { if (err?.name !== 'AbortError') setWhatif(null) })
      .finally(() => { if (whatifCtrl.current === ctrl) setWhatifing(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameData, lang])

  // analyst mood: each analyst supports their own national team, so the portrait
  // reacts with allegiance. Their nation scoring (or the opponent missing) makes
  // them happy; their nation conceding (or missing a big chance) makes them sad.
  // For matches their nation is not in, they simply enjoy goals and wince at poor
  // decisions. Drives the analyst portrait on the interactive screen.
  const analystMood = useMemo(() => {
    if (!frameData || !activeEvent) return 'neutral'
    // a kick-off is a neutral restart, not a good or bad decision: keep it calm
    if (activeEvent.set_piece === 'Kick Off') return 'neutral'
    const ctx = frameData.context || {}
    const outcome = ctx.outcome || activeEvent.outcome
    const evTeam = activeEvent.team
    const home = selectedMatch?.home_team
    const away = selectedMatch?.away_team
    const NATION = { en: 'England', es: 'Spain', fr: 'France', de: 'Germany' }
    const myTeam = NATION[lang]
    const involved = myTeam && (myTeam === home || myTeam === away)
    const myOpponent = involved ? (myTeam === home ? away : home) : null

    const isGoal = outcome === 'Goal' || activeEvent.goal_assist
    const FAILED = ['Saved', 'Saved To Post', 'Post', 'Off T', 'Wayward', 'Blocked', 'Saved Off T']
    const failedAttempt = activeEvent.type === 'Shot' &&
      (FAILED.includes(outcome) || (activeEvent.shot_type === 'Penalty' && outcome !== 'Goal'))

    if (involved) {
      if (isGoal) return evTeam === myTeam ? 'happy' : 'sad'
      if (failedAttempt) {
        if (evTeam === myTeam) return 'sad'          // our chance went begging
        if (evTeam === myOpponent) return 'happy'    // they let us off the hook
      }
    } else if (isGoal) {
      return 'happy'   // neutral match: still love a goal
    }
    // otherwise judge by the quality of the decision itself
    const d = computeDecision(frameData, activeEvent)
    if (d && d.score < 45) return 'sad'
    if (isGoal) return 'happy'
    return 'neutral'
  }, [frameData, activeEvent, selectedMatch, lang])

  const matchDate = useMemo(() => {
    if (!selectedMatch?.match_date) return ''
    const d = new Date(selectedMatch.match_date + 'T12:00:00')
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }, [selectedMatch])

  return (
    <LangContext.Provider value={lang}>
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">
          <span className="logo-mark">⟡</span>
          <span className="logo-text">FIRST<em>TOUCH</em></span>
        </div>


        {selectedMatch ? (
          <div className="topbar-match">
            <span className="topbar-team">
              {flagUrl(selectedMatch.home_team) && (
                <img className="topbar-flag" src={flagUrl(selectedMatch.home_team)} alt="" />
              )}
              {t(selectedMatch.home_team)}
            </span>
            <span className="topbar-score">
              {selectedMatch.home_score}&ndash;{selectedMatch.away_score}
            </span>
            <span className="topbar-team">
              {t(selectedMatch.away_team)}
              {flagUrl(selectedMatch.away_team) && (
                <img className="topbar-flag" src={flagUrl(selectedMatch.away_team)} alt="" />
              )}
            </span>
            <span className="topbar-meta">{prettyStage(t(selectedMatch.stage))} · {matchDate}</span>
          </div>
        ) : (
          <div className="topbar-match topbar-match-empty">
            {t('Beyond Highlights, Into Insights')}
          </div>
        )}

        {selectedMatch && (
          <button className="topbar-reset" onClick={resetAll} title="Reset everything">
            <span className="topbar-reset-icon">↺</span> {t('Reset')}
          </button>
        )}

        <LanguageSelect value={lang} onChange={setLang} />

        {badgeImg ? (
          <div className="topbar-wc">
            <img
              className="topbar-wc-emblem"
              src="/wc2022-emblem.png"
              alt=""
              onError={() => setBadgeImg(false)}
            />
            <img
              className="topbar-wc-word"
              src="/wc2022-wordmark.png"
              alt="FIFA World Cup Qatar 2022"
            />
          </div>
        ) : (
          <div className="topbar-badge">FIFA WORLD CUP 2022</div>
        )}
      </header>

      <div className="app-body">
        <aside className="panel-left">
          <MatchSelector
            matches={matches}
            error={matchesError}
            selectedMatch={selectedMatch}
            onSelect={selectMatch}
          />
          {selectedMatch && (
            <button
              className={`lineups-entry ${view === 'lineups' ? 'is-back' : ''}`}
              onClick={() => setView(view === 'lineups' ? 'analysis' : 'lineups')}
            >
              {view === 'lineups' ? (
                <><span className="lineups-entry-ico">←</span> {t('Back to Analysis')}</>
              ) : (
                <>
                  <svg className="lineups-entry-ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="3.5" y="2.5" width="17" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="3.5" y1="12" x2="20.5" y2="12" stroke="currentColor" strokeWidth="1.1" />
                    <circle cx="12" cy="12" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
                    <circle cx="12" cy="5.4" r="1.35" fill="currentColor" />
                    <circle cx="7" cy="8.6" r="1.35" fill="currentColor" />
                    <circle cx="17" cy="8.6" r="1.35" fill="currentColor" />
                    <circle cx="7" cy="15.6" r="1.35" fill="currentColor" />
                    <circle cx="17" cy="15.6" r="1.35" fill="currentColor" />
                    <circle cx="12" cy="18.8" r="1.35" fill="currentColor" />
                  </svg>
                  <span className="lineups-entry-txt"><b>{t('Lineups and Tactics')}</b></span>
                  <span className="lineups-entry-arrow">›</span>
                </>
              )}
            </button>
          )}
          {view === 'analysis' && (
            <EventList
              events={events}
              loading={loadingEvents}
              match={selectedMatch}
              activeEvent={activeEvent}
              onSelect={selectEvent}
              onNav={setNav}
            />
          )}
        </aside>

        {view === 'lineups' ? (
          <main className="panel-formations">
            <Formations match={selectedMatch} lang={lang} />
          </main>
        ) : (
        <>
        <main className="panel-center">
          <ThreePitch
            frameData={frameData}
            activeEvent={activeEvent}
            match={selectedMatch}
            liveScore={liveScore}
            loading={loadingFrame}
            analyst={getAnalyst(lang)}
            explanation={explanation}
            explaining={explaining}
            analystMood={analystMood}
            whatIf={whatif}
            showWhatIf={panelTab === 'whatif'}
          />
          <MomentumTimeline
            events={events}
            match={selectedMatch}
            activeEvent={activeEvent}
            onSelect={selectEvent}
          />
        </main>

        <aside className="panel-right">
          <DecisionPanel
            activeEvent={activeEvent}
            frameData={frameData}
            match={selectedMatch}
            stakes={stakes}
            assessment={assessment}
            assessing={assessing}
            whatif={whatif}
            whatifing={whatifing}
            loadingFrame={loadingFrame}
            activeTab={panelTab}
            onTabChange={setPanelTab}
            nav={nav}
            onNavigate={selectEvent}
          />
        </aside>
        </>
        )}
      </div>

      <footer className="app-footer">
        <div className="app-footer-brand">
          <span className="app-footer-mark">FIRST<em>TOUCH</em></span>
          <span className="app-footer-sub">· {t('Beyond Highlights, Into Insights')}</span>
        </div>
        <div className="app-footer-center">{t('IBM Granite and watsonx.ai showcase')}</div>
        <a className="app-footer-gh" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          {t('GitHub')}
          <span className="app-footer-gh-arrow">↗</span>
        </a>
      </footer>
    </div>
    </LangContext.Provider>
  )
}

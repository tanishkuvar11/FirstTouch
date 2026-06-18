// The AI analyst, always present in the top-right of the interactive screen.
// Petra's live read streams/types out here (moved out of the right panel).
import { useEffect, useState } from 'react'
import AnalystAvatar from './AnalystAvatar.jsx'
import { useT } from '../i18n.jsx'
import './AnalystBox.css'

export default function AnalystBox({ analyst, explanation, explaining, activeEvent, mood = 'neutral' }) {
  const tr = useT()
  const fullText = explanation?.explanation || ''
  const [typed, setTyped] = useState('')
  useEffect(() => { setTyped('') }, [activeEvent])
  useEffect(() => {
    if (typed.length >= fullText.length) {
      if (typed.length > fullText.length) setTyped(fullText)
      return
    }
    const id = setTimeout(() => setTyped(fullText.slice(0, typed.length + 2)), 12)
    return () => clearTimeout(id)
  }, [typed, fullText])
  const typing = explaining || typed.length < fullText.length

  // hold a neutral face until Victor's read is actually ready and begins typing,
  // so his expression changes in sync with delivering the verdict, not on click
  const shownMood = typed.length > 0 ? mood : 'neutral'

  const [open, setOpen] = useState(true)

  return (
    <div className={`tp-analyst-box ${open ? '' : 'is-collapsed'}`}>
      <button
        type="button"
        className="tp-analyst-toggle"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Hide notes' : 'Show notes'}
      >
        <span className={`tp-analyst-chev ${open ? '' : 'is-closed'}`}>▾</span>
      </button>
      <div className="tp-analyst-head">
        <AnalystAvatar size={60} mood={shownMood} busy={explaining} face={analyst.face} name={analyst.name} />
        <div className="tp-analyst-id">
          <div className="tp-analyst-name">{analyst.name}</div>
          <div className="tp-analyst-meta">
            <span className="tp-analyst-role">{analyst.role}</span>
            <span className="tp-analyst-powered">⬢ {tr('Powered by')} {analyst.model}</span>
          </div>
        </div>
      </div>
      {open && (
        <div className="tp-analyst-body">
          {!activeEvent ? (
            <span className="tp-analyst-idle">{tr("Pick a moment and I'll break down the decision.")}</span>
          ) : explaining && !typed ? (
            <span className="tp-analyst-idle">{tr('Reading the moment…')}</span>
          ) : (
            <p>{typed}{typing && <span className="tp-analyst-caret" />}</p>
          )}
        </div>
      )}
    </div>
  )
}

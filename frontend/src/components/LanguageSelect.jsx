// Analyst language / persona picker. Sits in the top bar; switching it changes
// who is talking (Nathan / Valeria / Claire / Felix) and the language they speak.
import { useEffect, useRef, useState } from 'react'
import { ANALYSTS, LANGS, flagSrc } from '../analyst.js'
import './LanguageSelect.css'

export default function LanguageSelect({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = ANALYSTS[value] || ANALYSTS[LANGS[0]]

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="lang-select" ref={ref}>
      <button
        type="button"
        className="lang-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Change analyst / language"
      >
        <img className="lang-flag" src={flagSrc(value)} alt="" />
        <span className="lang-trigger-text">
          <span className="lang-name">{current.name}</span>
          <span className="lang-lang">{current.language}</span>
        </span>
        <span className={`lang-chev ${open ? 'is-open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="lang-menu">
          {LANGS.map((code) => {
            const a = ANALYSTS[code]
            return (
              <button
                key={code}
                type="button"
                className={`lang-option ${code === value ? 'is-active' : ''}`}
                onClick={() => { onChange(code); setOpen(false) }}
              >
                <img className="lang-flag" src={flagSrc(code)} alt="" />
                <span className="lang-trigger-text">
                  <span className="lang-name">{a.name}</span>
                  <span className="lang-lang">{a.language}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

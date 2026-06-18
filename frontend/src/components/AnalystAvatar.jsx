// Portrait avatar for the AI analyst. Each persona has three mood portraits
// (neutral / happy / sad) in /public/avatars/<name>-<mood>.png, stacked and
// cross-faded by opacity so the mood change is a smooth dissolve. `busy` pulses
// the status dot while Granite is generating. Falls back to a monogram if the
// images for a persona aren't present yet.
import { useState, useEffect } from 'react'
import './AnalystAvatar.css'

const MOODS = ['neutral', 'happy', 'sad']
// bump when the portrait files are replaced, so browsers refetch instead of
// serving a stale cached image under the same filename
const AVATAR_VERSION = 3

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

export default function AnalystAvatar({ size = 56, mood = 'neutral', busy = false, face, name }) {
  // track which mood images failed to load (so we can fall back to a monogram)
  const [failed, setFailed] = useState({})
  useEffect(() => { setFailed({}) }, [face])

  const active = MOODS.includes(mood) ? mood : 'neutral'
  const activeFailed = !face || failed[active]

  return (
    <span className="analyst-avatar" style={{ width: size, height: size }}>
      {face && MOODS.map((m) => (
        <img
          key={m}
          src={`${face}-${m}.png?v=${AVATAR_VERSION}`}
          alt={m === active ? (name || '') : ''}
          className="analyst-face"
          style={{ opacity: m === active && !failed[m] ? 1 : 0 }}
          draggable={false}
          onError={() => setFailed((f) => ({ ...f, [m]: true }))}
        />
      ))}
      {activeFailed && (
        <span className="analyst-monogram" style={{ fontSize: size * 0.38 }}>
          {initials(name)}
        </span>
      )}
      <span className={`analyst-dot ${busy ? 'is-busy' : ''}`} />
    </span>
  )
}

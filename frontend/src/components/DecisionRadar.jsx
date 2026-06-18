// Pentagon radar for the Decision DNA. Pure SVG so there's no charting
// dependency. Axes and values come from decisionDNA.js (all real data).
//
// The viewBox is wider than the radar itself so the axis labels (EXECUTION,
// LEVERAGE ...) have horizontal room and never clip; width:100% then scales the
// whole thing to the panel.
import { motion } from 'framer-motion'
import { useT } from '../i18n.jsx'

const clamp01 = (v) => Math.max(0, Math.min(1, v))

// viewBox geometry: generous horizontal margin for the side labels
const VBW = 300
const VBH = 196
const CX = VBW / 2
const CY = 94
const R = 60          // radar radius
const LABEL_R = 78    // label ring radius

export default function DecisionRadar({ axes, color = '#00e5a0' }) {
  const tr = useT()
  if (!axes || axes.length < 3) return null
  const n = axes.length

  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const at = (i, rad) => [CX + Math.cos(angle(i)) * rad, CY + Math.sin(angle(i)) * rad]
  const ring = (v) => axes.map((_, i) => at(i, R * v).join(',')).join(' ')
  const dataPts = axes.map((a, i) => at(i, R * clamp01(a.value)))
  const dataPoly = dataPts.map((p) => p.join(',')).join(' ')

  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} className="dna-radar" preserveAspectRatio="xMidYMid meet">
      {/* concentric grid rings */}
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <polygon key={v} points={ring(v)} className="dna-ring" />
      ))}
      {/* spokes */}
      {axes.map((_, i) => {
        const [x, y] = at(i, R)
        return <line key={i} x1={CX} y1={CY} x2={x} y2={y} className="dna-spoke" />
      })}
      {/* data polygon */}
      <motion.polygon
        points={dataPoly}
        fill={color}
        fillOpacity={0.22}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{ transformOrigin: `${CX}px ${CY}px` }}
      />
      {/* vertex dots */}
      {dataPts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={2.6} fill={color} />
      ))}
      {/* axis labels */}
      {axes.map((a, i) => {
        const c = Math.cos(angle(i))
        const [lx, ly] = at(i, LABEL_R)
        const anchor = Math.abs(c) < 0.25 ? 'middle' : c > 0 ? 'start' : 'end'
        return (
          <text key={i} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="dna-label">
            {tr(a.label)}
            <tspan className="dna-val" dx={4}>{Math.round(a.value * 100)}</tspan>
          </text>
        )
      })}
    </svg>
  )
}

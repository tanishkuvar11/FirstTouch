import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { getKit, GK_KIT, eventColor, eventColorOf, eventLabel, resolveKits } from '../kitColors.js'
import { prettyOutcome } from '../decisionScore.js'
import { flagUrl, teamAbbr } from '../flags.js'
import AnalystBox from './AnalystBox.jsx'
import { useT } from '../i18n.jsx'
import './ThreePitch.css'

// StatsBomb pitch (120 x 80) -> Three.js: x-60, z = y-40, ground plane y=0
const sbToThree = (loc, y = 0) => new THREE.Vector3(loc[0] - 60, y, loc[1] - 40)

// keep in sync with backend tactical_analysis.LANE_BLOCK_RADIUS (pass-lane block)
const LANE_BLOCK_RADIUS = 1.0
const UP = new THREE.Vector3(0, 1, 0)

function distToSegment(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z
  const lenSq = abx * abx + abz * abz
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.z - a.z)
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * abx), p.z - (a.z + t * abz))
}

// a defender this close to the PASSER is pressure, to the RECEIVER is marking;
// neither cuts the lane, so only mid-lane defenders block it
const PASSER_PRESSURE_BUFFER = 1.5
const RECEIVER_MARK_BUFFER = 1.5
// a defender this tight to the receiver is draped over him and contests the
// reception, so he still closes the lane (NOT trimmed away as mere marking)
const RECEIVER_MARK_RADIUS = 1.3

// smallest perpendicular distance from any opponent to the passing CORRIDOR (the
// lane minus the pressure zone at the passer and the marking zone at the receiver).
// Mirrors backend tactical_analysis.lane_clearance so the painted lanes match scoring.
function laneClearance(opponents, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z
  const len = Math.hypot(dx, dz)
  if (len === 0) return Infinity
  const ux = dx / len, uz = dz / len
  let lo = PASSER_PRESSURE_BUFFER, hi = len - RECEIVER_MARK_BUFFER
  if (hi <= lo) { const mid = len / 2; lo = Math.max(0, mid - 0.75); hi = Math.min(len, mid + 0.75) }
  let best = Infinity
  for (const o of opponents) {
    const tightMark = Math.hypot(o.x - end.x, o.z - end.z) <= RECEIVER_MARK_RADIUS
    const along = (o.x - start.x) * ux + (o.z - start.z) * uz
    if ((along < lo || along > hi) && !tightMark) continue
    const perp = Math.abs((o.x - start.x) * uz - (o.z - start.z) * ux)
    if (perp < best) best = perp
  }
  return best
}

// Procedural textures (no external assets needed — always works)

// Entire playing surface baked into one high-res texture: grass, mowing
// stripes, grain, wear, and bold floodlit-white markings. Far crisper than
// THREE.Line (always 1px in WebGL) and reads correctly at grazing angles
// thanks to anisotropic filtering.
function makePitchTexture(maxAniso) {
  const W = 4096, H = 2856                       // covers 132 x 92 units (grass runoff included)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  const S = W / 132
  const SZ = H / 92
  const X = u => (u + 66) * S
  const Z = v => (v + 46) * SZ

  // base grass — deep floodlit green, slightly brighter at center
  const base = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.62)
  base.addColorStop(0, '#2c6e32')
  base.addColorStop(0.65, '#27602c')
  base.addColorStop(1, '#1b4720')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)

  // mowing stripes
  for (let i = 0, x = -66; x < 66; i++, x += 12) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.08)'
    ctx.fillRect(X(x), 0, 12 * S, H)
  }
  // faint cross-mow for a checkerboard sheen
  for (let i = 0, z = -46; z < 46; i++, z += 12) {
    if (i % 2 === 0) continue
    ctx.fillStyle = 'rgba(255,255,255,0.022)'
    ctx.fillRect(0, Z(z), W, 12 * SZ)
  }

  // grass grain
  for (let i = 0; i < 90000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)'
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2)
  }

  // worn patches — center circle, goalmouths, penalty spots
  const wear = (u, v, r, alpha) => {
    const g = ctx.createRadialGradient(X(u), Z(v), 2, X(u), Z(v), r * S)
    g.addColorStop(0, `rgba(122,104,58,${alpha})`)
    g.addColorStop(1, 'rgba(122,104,58,0)')
    ctx.fillStyle = g
    ctx.fillRect(X(u) - r * S, Z(v) - r * S, 2 * r * S, 2 * r * S)
  }
  wear(0, 0, 7, 0.15)
  wear(-57, 0, 8, 0.18)
  wear(57, 0, 8, 0.18)
  wear(-48, 0, 4, 0.12)
  wear(48, 0, 4, 0.12)

  // markings — clean hard-edged white, no glow (blur reads as smudge up close)
  ctx.strokeStyle = 'rgba(255,255,255,0.94)'
  ctx.fillStyle = 'rgba(255,255,255,0.94)'
  ctx.lineWidth = 0.2 * S

  // boundary + halfway
  ctx.strokeRect(X(-60), Z(-40), 120 * S, 80 * SZ)
  ctx.beginPath()
  ctx.moveTo(X(0), Z(-40))
  ctx.lineTo(X(0), Z(40))
  ctx.stroke()

  // center circle + spot
  ctx.beginPath()
  ctx.arc(X(0), Z(0), 10 * S, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(X(0), Z(0), 0.45 * S, 0, Math.PI * 2)
  ctx.fill()

  for (const side of [-1, 1]) {
    const gx = 60 * side
    const boxX = side === -1 ? X(-60) : X(42)
    const sixX = side === -1 ? X(-60) : X(54)
    // 18-yard box (18 deep, 44 wide)
    ctx.strokeRect(boxX, Z(-22), 18 * S, Z(22) - Z(-22))
    // 6-yard box (6 deep, 20 wide)
    ctx.strokeRect(sixX, Z(-10), 6 * S, Z(10) - Z(-10))
    // penalty spot
    ctx.beginPath()
    ctx.arc(X(48 * side), Z(0), 0.4 * S, 0, Math.PI * 2)
    ctx.fill()
    // penalty arc (portion of r=10 circle outside the box)
    const half = Math.acos(0.6)                  // box edge is 6 units from the spot
    ctx.beginPath()
    if (side === -1) ctx.arc(X(-48), Z(0), 10 * S, -half, half)
    else ctx.arc(X(48), Z(0), 10 * S, Math.PI - half, Math.PI + half)
    ctx.stroke()
    // corner arcs
    for (const cz of [-40, 40]) {
      const a0 = gx < 0 ? (cz < 0 ? 0 : 1.5 * Math.PI) : (cz < 0 ? 0.5 * Math.PI : Math.PI)
      ctx.beginPath()
      ctx.arc(X(gx), Z(cz), 1.5 * S, a0, a0 + Math.PI / 2)
      ctx.stroke()
    }
  }

  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = maxAniso
  tex.encoding = THREE.sRGBEncoding
  return tex
}

// transparent grid tile for goal nets
function makeNetTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  ctx.strokeStyle = 'rgba(250,250,250,0.95)'
  ctx.lineWidth = 2.4
  for (let i = 0; i <= 4; i++) {
    const p = i * 16
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 64); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(64, p); ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function makeCrowdTexture() {
  const c = document.createElement('canvas')
  const W = 2048, H = 640
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  // dark stand backdrop, a touch warmer toward the front rows
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0e1525')
  bg.addColorStop(1, '#1b2742')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // supporter "sections" lean toward a colour; shirts, skin and hair give each
  // spectator a head + torso so the crowd reads as people, not noise
  const SECTION = ['#5f78c0', '#c6d4f2', '#b05656', '#d6d9e2', '#5aa0c6',
    '#caa066', '#74879f', '#5e9070', '#9a6f9a', '#3f567f']
  const SHIRTS = ['#8195bd', '#c6d8f8', '#b86060', '#dde2ee', '#6fa088',
    '#cba874', '#8c7fa6', '#84acca', '#9d6f6f', '#5b6b88', '#cdbb8e', '#e8edf8']
  const SKIN = ['#ecc6a2', '#d4a276', '#a87040', '#7c4c2c', '#f2d8ba', '#c89262']
  const HAIR = ['#191715', '#241e1a', '#3a2a1c', '#0d0d0f', '#5a4a3a', '#8a7a64']
  const sectionW = 168
  const pick = (a) => a[(Math.random() * a.length) | 0]

  const rows = 72
  const top = 20
  const rowH = (H - top - 16) / rows
  for (let r = 0; r < rows; r++) {
    const y = top + r * rowH
    const s = 0.78 + (r / rows) * 0.55          // fake depth: smaller at the back
    // faint seat-row shadow band
    ctx.fillStyle = 'rgba(0,0,0,0.16)'
    ctx.fillRect(0, y + rowH * 0.72, W, Math.max(1, rowH * 0.2))
    const offset = (r % 2) * 2.6                 // stagger alternate rows
    for (let x = offset; x < W; x += 5) {
      if (Math.random() > 0.93) continue         // the odd empty seat
      const tint = SECTION[Math.floor(x / sectionW) % SECTION.length]
      const shirt = Math.random() < 0.55 ? tint : pick(SHIRTS)
      const jx = x + Math.random() * 1.4
      ctx.globalAlpha = 0.72 + Math.random() * 0.28
      ctx.fillStyle = shirt                       // torso
      ctx.fillRect(jx, y + 2.4 * s, 3.3 * s, 4.4 * s)
      ctx.fillStyle = Math.random() < 0.82 ? pick(SKIN) : pick(HAIR)   // head
      ctx.fillRect(jx + 0.55 * s, y, 2.3 * s, 2.5 * s)
    }
  }
  ctx.globalAlpha = 1

  // vertical aisles between sections
  ctx.fillStyle = 'rgba(6,9,15,0.5)'
  for (let x = sectionW; x < W; x += sectionW) ctx.fillRect(x - 3, top - 2, 6, H - top - 14)

  // phone-camera flashes with a soft glow
  for (let i = 0; i < 150; i++) {
    const fx = Math.random() * W, fy = top + Math.random() * (H - top - 40)
    ctx.globalAlpha = 0.1
    ctx.fillStyle = 'rgba(255,250,235,1)'
    ctx.fillRect(fx - 1.5, fy - 1.5, 5, 5)
    ctx.globalAlpha = 0.35 + Math.random() * 0.45
    ctx.fillRect(fx, fy, 2.2, 2.2)
  }
  ctx.globalAlpha = 1

  // roof shadow at the top of the tier (canvas top = top of stand)
  const shade = ctx.createLinearGradient(0, 0, 0, H * 0.45)
  shade.addColorStop(0, 'rgba(0,0,0,0.5)')
  shade.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, W, H * 0.45)

  // parapet wall at the foot of the tier
  ctx.fillStyle = '#0b111e'
  ctx.fillRect(0, H - 16, W, 16)
  ctx.fillStyle = 'rgba(150,170,200,0.3)'
  ctx.fillRect(0, H - 16, W, 2)

  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.encoding = THREE.sRGBEncoding
  tex.anisotropy = 8
  return tex
}

function makeAdBoardTexture() {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 128
  const ctx = c.getContext('2d')
  const bg = ctx.createLinearGradient(0, 0, 0, 128)
  bg.addColorStop(0, '#0c1a3a')
  bg.addColorStop(1, '#081126')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 2048, 128)

  ctx.textBaseline = 'middle'
  ctx.font = '800 70px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
  ctx.fillStyle = '#19c8ff'
  ctx.shadowColor = '#19c8ff'
  ctx.shadowBlur = 16
  ctx.fillText('FIRSTTOUCH', 48, 68)

  ctx.font = '600 44px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
  ctx.fillStyle = '#f0a500'
  ctx.shadowColor = '#f0a500'
  ctx.fillText('DECISION INTELLIGENCE', 560, 68)

  ctx.font = '800 56px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
  ctx.fillStyle = '#e8eaf0'
  ctx.shadowColor = '#ffffff'
  ctx.shadowBlur = 10
  ctx.fillText('QATAR 2022', 1180, 68)

  ctx.font = '600 44px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
  ctx.fillStyle = '#19c8ff'
  ctx.shadowColor = '#19c8ff'
  ctx.fillText('SEE WHAT THE PLAYER SAW', 1560, 68)
  ctx.shadowBlur = 0

  // glass gloss along the top
  const gloss = ctx.createLinearGradient(0, 0, 0, 50)
  gloss.addColorStop(0, 'rgba(255,255,255,0.14)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gloss
  ctx.fillRect(0, 0, 2048, 50)

  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.encoding = THREE.sRGBEncoding
  return tex
}

function makeLightBankTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 160
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#0a0f18'
  ctx.fillRect(0, 0, 256, 160)
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 7; i++) {
      const x = 24 + i * 35, y = 22 + r * 39
      const g = ctx.createRadialGradient(x, y, 1, x, y, 16)
      g.addColorStop(0, 'rgba(255,250,235,1)')
      g.addColorStop(0.45, 'rgba(255,244,210,0.85)')
      g.addColorStop(1, 'rgba(255,244,210,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - 16, y - 16, 32, 32)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.encoding = THREE.sRGBEncoding
  return tex
}

// classic black-pentagon football wrap (equirectangular)
function makeBallTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#f5f5f3'
  ctx.fillRect(0, 0, 512, 256)

  const pentPath = (cx, cy, r, rot) => {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }

  // two staggered rows of pentagons; wraps seamlessly (512/5 spacing)
  const row1 = [], row2 = []
  for (let i = 0; i < 5; i++) {
    row1.push([i * 102.4 + 30, 86])
    row2.push([i * 102.4 + 81, 170])
  }
  // stitching seams between panels (drawn first, under the pentagons)
  ctx.strokeStyle = 'rgba(20,20,20,0.22)'
  ctx.lineWidth = 2.5
  for (let i = 0; i < 5; i++) {
    const a = row1[i], an = row1[(i + 1) % 5]
    const b = row2[i], bp = row2[(i + 4) % 5]
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] < an[0] ? an[0] : an[0] + 512, an[1]); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] > bp[0] ? bp[0] : bp[0] - 512, bp[1]); ctx.stroke()
  }
  ctx.fillStyle = '#16161a'
  for (const [x, y] of row1) { pentPath(x, y, 27, 0.25); ctx.fill() }
  for (const [x, y] of row2) { pentPath(x, y, 27, 0.95); ctx.fill() }
  // partial pentagons at the poles so top/down views aren't blank white
  ctx.beginPath(); ctx.arc(256, 0, 22, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(256, 256, 22, 0, Math.PI * 2); ctx.fill()

  const tex = new THREE.CanvasTexture(c)
  tex.encoding = THREE.sRGBEncoding
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,245,224,1)')
  g.addColorStop(0.3, 'rgba(255,245,224,0.35)')
  g.addColorStop(1, 'rgba(255,245,224,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function makeNumberTexture(number, color, bg) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  ctx.beginPath()
  ctx.arc(64, 64, 58, 0, Math.PI * 2)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke()
  ctx.fillStyle = color
  ctx.font = '800 64px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(number ?? '?'), 64, 70)
  const tex = new THREE.CanvasTexture(c)
  tex.encoding = THREE.sRGBEncoding
  return tex
}

// Static scene: pitch, goals, ad boards, stadium bowl, floodlights

function buildPitch(scene, renderer) {
  const pitchTex = makePitchTexture(renderer.capabilities.getMaxAnisotropy())
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(132, 92),
    new THREE.MeshLambertMaterial({ map: pitchTex })
  )
  grass.rotation.x = -Math.PI / 2
  grass.receiveShadow = true
  scene.add(grass)
}

function buildGoals(scene) {
  const netTex = makeNetTexture()
  const netMat = new THREE.MeshBasicMaterial({
    map: netTex, transparent: true, opacity: 0.65,
    side: THREE.DoubleSide, depthWrite: false,
  })
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x777777 })

  const H = 3.4           // crossbar height (oversized to match the chunky markers)
  const D = 2.8           // net depth at the ground
  const BH = 2.4          // height of the back of the net

  // textured quad with explicit UV scale so the net mesh stays ~25cm
  const netQuad = (corners, uw, vh) => {
    const tris = [[0, 1, 2], [0, 2, 3]]
    const uvs = [[0, 0], [uw, 0], [uw, vh], [0, vh]]
    const pos = [], uv = []
    for (const t of tris) {
      for (const i of t) {
        pos.push(corners[i].x, corners[i].y, corners[i].z)
        uv.push(uvs[i][0], uvs[i][1])   // 1 tile per unit -> 25cm net cells
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    scene.add(new THREE.Mesh(geo, netMat))
  }

  const tube = (from, to, r) => {
    const dir = to.clone().sub(from)
    const len = dir.length()
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), frameMat)
    m.position.copy(from).add(to).multiplyScalar(0.5)
    m.quaternion.setFromUnitVectors(UP, dir.normalize())
    m.castShadow = true
    scene.add(m)
  }

  for (const side of [-1, 1]) {
    const gx = 60 * side
    const bx = gx + D * side                     // back of the net
    const V = (x, y, z) => new THREE.Vector3(x, y, z)

    // frame
    tube(V(gx, 0, -4), V(gx, H, -4), 0.12)
    tube(V(gx, 0, 4), V(gx, H, 4), 0.12)
    tube(V(gx, H, -4), V(gx, H, 4), 0.12)
    // stanchions + back frame
    tube(V(gx, H, -4), V(bx, BH, -4), 0.05)
    tube(V(gx, H, 4), V(bx, BH, 4), 0.05)
    tube(V(bx, BH, -4), V(bx, 0.05, -4), 0.05)
    tube(V(bx, BH, 4), V(bx, 0.05, 4), 0.05)
    tube(V(bx, 0.06, -4), V(bx, 0.06, 4), 0.05)

    // net panels: back, roof, two sides
    netQuad([V(bx, 0, -4), V(bx, 0, 4), V(bx, BH, 4), V(bx, BH, -4)], 8, BH)
    netQuad([V(gx, H, -4), V(gx, H, 4), V(bx, BH, 4), V(bx, BH, -4)], 8, 3)
    netQuad([V(gx, 0, -4), V(bx, 0, -4), V(bx, BH, -4), V(gx, H, -4)], 2.8, 3.4)
    netQuad([V(gx, 0, 4), V(bx, 0, 4), V(bx, BH, 4), V(gx, H, 4)], 2.8, 3.4)
  }
}

function buildAdBoards(scene) {
  const adTex = makeAdBoardTexture()
  const place = (len, x, z) => {
    const tex = adTex.clone()
    tex.needsUpdate = true
    tex.repeat.set(len / 34, 1)
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(len, 1.2),
      // toneMapped:false keeps the LED panels punchy under filmic tone mapping;
      // DoubleSide so the board is still visible from behind the goal line
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide })
    )
    board.position.set(x, 0.6, z)
    board.lookAt(0, 0.6, 0)
    board.rotateX(-0.1)
    scene.add(board)
  }
  place(124, 0, -44.5)
  place(124, 0, 44.5)
  place(84, -64.5, 0)
  place(84, 64.5, 0)
}

// grass-toned pitch-side surround so the perimeter reads as turf runoff, not an
// unrendered black void. Fades from pitch green (inner) to a darker shade near
// the stands. (v == 0 is the inner ring, on the pitch side.)
function makeSurroundTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 64
  const ctx = c.getContext('2d')
  const grad = ctx.createLinearGradient(0, 0, 0, 64)
  grad.addColorStop(0, '#2a6330')      // pitch side: matches the grass
  grad.addColorStop(1, '#173a1d')      // stand side: deeper shaded turf
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 64)
  // grass grain
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.10)'
    ctx.fillRect(Math.random() * 512, Math.random() * 64, 2, 2)
  }
  // faint white perimeter line on the pitch side
  ctx.fillStyle = 'rgba(220,228,235,0.20)'
  ctx.fillRect(0, 3, 512, 2)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.encoding = THREE.sRGBEncoding
  return tex
}

// a crouched pitch-side photographer with a big white lens aimed at the play
function addPhotographer(scene, x, z) {
  const BIBS = [0xffd23f, 0xff7a3d, 0x39d98a, 0x4f9dff, 0xe8eaf0]
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.rotation.y = Math.atan2(-x, -z)        // local +Z faces pitch centre

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.8, 0.85),
    new THREE.MeshLambertMaterial({ color: 0x1a2230 })
  )
  body.position.y = 0.45
  body.castShadow = true
  g.add(body)

  const bib = new THREE.Mesh(
    new THREE.BoxGeometry(0.88, 0.3, 0.88),
    new THREE.MeshLambertMaterial({
      color: BIBS[(Math.random() * BIBS.length) | 0], emissive: 0x14130c,
    })
  )
  bib.position.y = 0.62
  g.add(bib)

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0x2a2320 })
  )
  head.position.set(0, 1.0, 0.05)
  g.add(head)

  // long white telephoto lens pointing at the pitch
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.75, 12),
    new THREE.MeshLambertMaterial({ color: 0xe8eaf0 })
  )
  lens.rotation.x = Math.PI / 2
  lens.position.set(0, 0.78, 0.55)
  g.add(lens)

  const glint = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 12),
    new THREE.MeshBasicMaterial({ color: 0x1b2b3a })
  )
  glint.position.set(0, 0.78, 0.93)
  g.add(glint)

  scene.add(g)
}

// a broadcast TV camera on a tripod with a red tally light
function addBroadcastCamera(scene, x, z) {
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  g.rotation.y = Math.atan2(-x, -z)

  const tripod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.16, 1.8, 8),
    new THREE.MeshLambertMaterial({ color: 0x10151d })
  )
  tripod.position.y = 0.9
  g.add(tripod)

  const cam = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 1.0),
    new THREE.MeshLambertMaterial({ color: 0x05080c })
  )
  cam.position.set(0, 1.9, 0.0)
  cam.castShadow = true
  g.add(cam)

  const hood = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.22, 0.5, 12),
    new THREE.MeshLambertMaterial({ color: 0x181818 })
  )
  hood.rotation.x = Math.PI / 2
  hood.position.set(0, 1.9, 0.7)
  g.add(hood)

  const tally = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a })
  )
  tally.position.set(0.18, 2.12, 0.4)
  g.add(tally)

  scene.add(g)
}

// Fill the flat perimeter "moat" between pitch and stands: a textured track
// ring, photographers ringing the touchlines (denser behind each goal), and a
// handful of broadcast cameras. Turns the bare grey gap into a real touchline.
function buildPitchSurround(scene) {
  // flat textured ground ring from the grass runoff out to the stand base
  const tex = makeSurroundTexture()
  const inner = roundedRectRing(65, 45, 12, 0.01)
  const outer = roundedRectRing(71, 51, 16, 0.01)
  const band = bandMesh(inner, outer, new THREE.MeshLambertMaterial({
    map: tex, side: THREE.DoubleSide,
  }), 44)
  band.receiveShadow = true
  scene.add(band)

  // photographers along the whole perimeter, just outside the boards
  const placed = []
  const tooClose = (x, z) => placed.some(p => Math.hypot(p[0] - x, p[1] - z) < 2.4)
  const add = (x, z) => { if (!tooClose(x, z)) { placed.push([x, z]); addPhotographer(scene, x, z) } }

  // dense rows behind both goals (classic photo positions), out beyond the
  // goal-line boards so they sit in the moat, not on the pitch
  for (const sx of [-1, 1]) {
    for (let zz = -22; zz <= 22; zz += 2.6) {
      add(sx * (66.5 + Math.random() * 2.2), zz + (Math.random() - 0.5))
    }
  }
  // sparser line along the two touchlines
  for (const sz of [-1, 1]) {
    for (let xx = -52; xx <= 52; xx += 6) {
      if (Math.random() < 0.7) add(xx + (Math.random() - 0.5), sz * (47.5 + Math.random() * 2.2))
    }
  }

  // broadcast cameras: behind each goal, at midline, and the four corners
  addBroadcastCamera(scene, -68, 0)
  addBroadcastCamera(scene, 68, 0)
  addBroadcastCamera(scene, 0, -49)
  addBroadcastCamera(scene, 0, 49)
  for (const cx of [-67, 67]) for (const cz of [-49, 49]) addBroadcastCamera(scene, cx, cz)
}

// rounded-rectangle ring of points (CCW seen from above), closed for seamless UVs
function roundedRectRing(hw, hh, r, y, segs = 10) {
  const pts = []
  const corners = [
    [hw - r, hh - r, 0],
    [-(hw - r), hh - r, Math.PI / 2],
    [-(hw - r), -(hh - r), Math.PI],
    [hw - r, -(hh - r), Math.PI * 1.5],
  ]
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2)
      pts.push(new THREE.Vector3(cx + r * Math.cos(a), y, cz + r * Math.sin(a)))
    }
  }
  pts.push(pts[0].clone())
  return pts
}

// surface strip between two rings (equal length), inward-facing
function bandMesh(ringA, ringB, material, uRepeat) {
  const n = ringA.length
  const pos = [], uv = [], idx = []
  for (let i = 0; i < n; i++) {
    pos.push(ringA[i].x, ringA[i].y, ringA[i].z, ringB[i].x, ringB[i].y, ringB[i].z)
    const u = (i / (n - 1)) * uRepeat
    uv.push(u, 0, u, 1)
  }
  for (let i = 0; i < n - 1; i++) {
    const a = 2 * i, b = a + 1, c = a + 2, d = a + 3
    idx.push(a, c, b, b, c, d)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, material)
}

function buildStadium(scene) {
  // dark concourse under the stands
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.MeshLambertMaterial({ color: 0x10161f })
  )
  apron.rotation.x = -Math.PI / 2
  apron.position.y = -0.06
  scene.add(apron)

  // two-tier rounded-rectangle bowl hugging the pitch (no dead moat)
  const crowdMat = () => new THREE.MeshBasicMaterial({ map: makeCrowdTexture() })
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x0c1119 })
  const rrr = roundedRectRing

  scene.add(bandMesh(rrr(70, 50, 16, 0), rrr(102, 82, 48, 24), crowdMat(), 10))     // lower tier
  scene.add(bandMesh(rrr(102, 82, 48, 24), rrr(105, 85, 51, 26.5), darkMat, 10))    // walkway
  scene.add(bandMesh(rrr(105, 85, 51, 26.5), rrr(135, 115, 81, 52), crowdMat(), 13)) // upper tier
  scene.add(bandMesh(rrr(135, 115, 81, 52), rrr(137, 117, 83, 58), darkMat, 13))    // rim wall
  scene.add(bandMesh(                                                               // roof ring
    rrr(112, 92, 58, 59.5), rrr(143, 123, 89, 59.5),
    new THREE.MeshLambertMaterial({ color: 0x10151f, side: THREE.DoubleSide }), 13))

  // night sky
  const starPos = []
  for (let i = 0; i < 700; i++) {
    const a = Math.random() * Math.PI * 2
    const e = 0.18 + Math.random() * (Math.PI / 2 - 0.18)
    starPos.push(
      330 * Math.cos(e) * Math.cos(a),
      330 * Math.sin(e),
      330 * Math.cos(e) * Math.sin(a)
    )
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xdfe8ff, size: 1.6, sizeAttenuation: false,
    transparent: true, opacity: 0.75, fog: false, depthWrite: false,
  })))
}

function buildLighting(scene) {
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1c3a1f, 0.5))

  const key = new THREE.DirectionalLight(0xfff2dd, 0.8)
  key.position.set(50, 90, 35)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -80
  key.shadow.camera.right = 80
  key.shadow.camera.top = 60
  key.shadow.camera.bottom = -60
  key.shadow.camera.near = 10
  key.shadow.camera.far = 250
  key.shadow.bias = -0.0005
  scene.add(key)

  // four corner floodlight towers — visible masts, lamp banks, halos, beams
  const bankTex = makeLightBankTexture()
  const glowTex = makeGlowTexture()
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x141b28 })
  for (const [x, z] of [[-98, -72], [98, -72], [-98, 72], [98, 72]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.2, 50, 10), poleMat)
    pole.position.set(x, 31, z)
    scene.add(pole)

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(12, 7, 1),
      new THREE.MeshBasicMaterial({ map: bankTex, toneMapped: false })
    )
    head.position.set(x, 56, z)
    head.lookAt(x * 0.1, 0, z * 0.1)
    scene.add(head)

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xfff5e0, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    halo.position.set(x, 56, z)
    halo.scale.set(36, 36, 1)
    scene.add(halo)

    const spot = new THREE.SpotLight(0xfff3da, 0.4, 0, 0.55, 0.5, 1)
    spot.position.set(x, 56, z)
    spot.target.position.set(x * 0.18, 0, z * 0.18)
    scene.add(spot)
    scene.add(spot.target)
  }
}

// Per-frame meshes: ribbons (bold flat lines), player discs, ball

// flat ground ribbon between two points — replaces 1px THREE.Line
function ribbonMesh(start, end, width, material) {
  const dx = end.x - start.x, dz = end.z - start.z
  const len = Math.hypot(dx, dz)
  const geo = new THREE.PlaneGeometry(Math.max(len, 0.01), width)
  geo.rotateX(-Math.PI / 2)
  const m = new THREE.Mesh(geo, material)
  m.position.set((start.x + end.x) / 2, start.y, (start.z + end.z) / 2)
  m.rotation.y = -Math.atan2(dz, dx)
  return m
}

function makePlayerDisc(player, kit, isActor, hoverTargets, idx) {
  // Smaller footprints: a packed six-yard box has players within 1-2m of each
  // other, so oversized discs turn to mush. Keep the actor clearly the largest.
  const radius = isActor ? 1.35 : player.keeper ? 1.1 : 0.9
  const fill = player.keeper ? GK_KIT.primary : kit.primary
  const numberColor = player.keeper ? GK_KIT.number : kit.number
  const ringColor = player.keeper ? kit.primary : kit.secondary
  const opacity = player.identity_confidence === 'inferred' ? 0.85 : 1.0
  // tiny per-player lift so overlapping coins never share a plane (coplanar top
  // faces z-fight in clusters). The actor gets the largest lift so it always
  // sits on top of a teammate or keeper standing right behind it.
  const lift = isActor ? 0.16 : idx * 0.006

  const group = new THREE.Group()
  const pos = sbToThree(player.location)
  // nudge goalmouth markers clear of the goal frame (posts at x=±60, z=±4)
  // so the post never slices through a keeper's disc
  if (Math.abs(pos.x) > 58.4 && Math.abs(pos.z) < 5.5) pos.x = Math.sign(pos.x) * 58.4
  group.position.copy(pos)

  // flat contact shadow — a dark disc on the grass, NOT a projected shadow.
  // Projected shadows smear sideways and pool into a dark blob in clusters;
  // a tight flat circle just darkens the grass directly under each player.
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.05, 24),
    new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
    })
  )
  contact.rotation.x = -Math.PI / 2
  contact.position.y = 0.02
  group.add(contact)

  // Bordered "coin": a ring-coloured base plate with the fill disc set proud on
  // top, so the border is the solid rim of one object. A separate floating ring
  // detaches at low angles and tangles with neighbours when players overlap;
  // this stacks with proper depth and always reads as a clean bordered puck.
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.16, 32),
    new THREE.MeshLambertMaterial({ color: ringColor, transparent: opacity < 1, opacity })
  )
  base.position.y = 0.20 + lift
  group.add(base)

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.82, radius * 0.82, 0.24, 32),
    new THREE.MeshLambertMaterial({ color: fill, transparent: opacity < 1, opacity })
  )
  disc.position.y = 0.24 + lift
  disc.userData.player = player
  group.add(disc)
  hoverTargets.push(disc)

  // ground halo — actor only; on every disc it just pools into mush in clusters
  if (isActor) {
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 1.45, 32),
      new THREE.MeshBasicMaterial({
        color: 0xf0a500, transparent: true, opacity: 0.2, depthWrite: false,
      })
    )
    halo.rotation.x = -Math.PI / 2
    halo.position.y = 0.04
    group.add(halo)
  }

  // actor pulse ring (animated in the render loop)
  if (isActor) {
    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.25, radius * 1.45, 40),
      new THREE.MeshBasicMaterial({
        color: 0xf0a500, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false,
      })
    )
    pulse.rotation.x = -Math.PI / 2
    pulse.position.y = 0.06
    pulse.userData.isPulse = true
    group.add(pulse)
  }

  // jersey number — billboard sprite hugging the disc, always camera-facing.
  // Kept low (just above the puck) so it reads as the player's marker, not a
  // floating balloon; depthTest off so it's never hidden behind another disc.
  const numTex = makeNumberTexture(player.jersey_number, numberColor, fill)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: numTex, transparent: true, opacity, depthWrite: false, depthTest: false,
  }))
  const s = isActor ? 1.9 : 1.35
  sprite.scale.set(s, s, 1)
  sprite.position.y = 0.5 + s * 0.5
  sprite.renderOrder = isActor ? 22 : 11
  group.add(sprite)

  return group
}

// shot outcome helpers (colour + label for the trajectory)
function shotOutcomeColor(o) {
  if (o === 'Goal') return 0x00e5a0
  if (o === 'Saved' || o === 'Saved To Post' || o === 'Post') return 0xf0a500
  return 0xff4d6a   // off target, wayward, blocked, saved off target
}

function shotOutcomeLabel(o) {
  if (o === 'Goal') return 'GOAL'
  if (o === 'Saved' || o === 'Saved To Post') return 'SAVED'
  if (o === 'Post') return 'WOODWORK'
  if (o === 'Blocked') return 'BLOCKED'
  return 'OFF TARGET'
}

// short cylinder between two 3D points (one dash of the trajectory)
function dashSegment3D(a, b, radius, mat) {
  const dir = b.clone().sub(a)
  const len = dir.length()
  if (len < 1e-4) return null
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat)
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(UP, dir.normalize())
  return m
}

// floating broadcast-style outcome tag (e.g. "OFF TARGET") at the arrow head
function makeLabelSprite(text, colorHex) {
  const css = '#' + colorHex.toString(16).padStart(6, '0')
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 72
  const ctx = c.getContext('2d')
  // no box: just clean floating text, with a dark outline + soft shadow so it
  // stays readable over the pitch
  ctx.font = '800 36px "Saira Condensed", "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = 8
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(8,12,20,0.9)'
  ctx.strokeText(text, 128, 39)
  ctx.shadowBlur = 0
  ctx.fillStyle = css
  ctx.fillText(text, 128, 39)
  const tex = new THREE.CanvasTexture(c)
  tex.encoding = THREE.sRGBEncoding
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }))
  spr.scale.set(5.6, 1.6, 1)
  spr.renderOrder = 30
  return spr
}

// rounded-rect path helper for canvas backgrounds
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Floating banner that hangs above the goal a team is attacking, so the viewer
// can always read who is shooting which way. Faces the camera (a sprite).
function makeAttackBanner(teamName, colorHex) {
  const css = '#' + colorHex.toString(16).padStart(6, '0')
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 132
  const ctx = c.getContext('2d')
  // no box: clean floating text only, with a dark outline + shadow so it stays
  // readable over the crowd
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = 8
  const outline = (text, y) => {
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(8,12,20,0.92)'
    ctx.strokeText(text, 256, y)
  }
  // eyebrow
  ctx.font = '700 26px "IBM Plex Mono", monospace'
  outline('ATTACKING ↓', 38)
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(230,238,250,0.95)'
  ctx.fillText('ATTACKING ↓', 256, 38)
  // team name
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = 8
  ctx.font = '800 56px "Saira Condensed", "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'
  outline(teamName.toUpperCase(), 88)
  ctx.shadowBlur = 0
  ctx.fillStyle = css
  ctx.fillText(teamName.toUpperCase(), 256, 88)
  const tex = new THREE.CanvasTexture(c)
  tex.encoding = THREE.sRGBEncoding
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }))
  spr.scale.set(17, 4.4, 1)
  spr.renderOrder = 31
  return spr
}

// Ground chevrons marching toward +x (the attacking goal), coloured by kit, so
// the direction of play is unambiguous in 3D even as the camera orbits. The
// caller flips the parent group by PI for the team attacking -x.
function makeAttackChevrons(colorHex) {
  const grp = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex, transparent: true, opacity: 0.5,
    depthWrite: false, toneMapped: false,
  })
  const a = 3.2, b = 3.4              // chevron depth and half-spread
  const len = Math.hypot(a, b)
  const ang = Math.atan2(-b, -a)      // arm angle for the +z side (−z is its mirror)
  for (const x0 of [0, 5.4, 10.8]) {  // three chevrons pointing the way
    for (const s of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 1.0), mat)
      arm.position.set(x0 - a / 2, 0.08, s * b / 2)
      arm.rotation.y = s * ang
      grp.add(arm)
    }
  }
  return grp
}

// Component

export default function ThreePitch({ frameData, activeEvent, match, liveScore, loading, analyst, explanation, explaining, analystMood, whatIf, showWhatIf }) {
  const tr = useT()
  const mountRef = useRef(null)
  const ctxRef = useRef(null)   // scene context (camera, groups, orbit state…)
  const [tooltip, setTooltip] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // keep the toggle's icon in sync with the actual fullscreen state (also covers
  // the user pressing Esc). The ResizeObserver already rescales the canvas.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === mountRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    const el = mountRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen?.()
    else el.requestFullscreen?.()
  }

  // one-time scene setup
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x060c18)
    scene.fog = new THREE.FogExp2(0x060c18, 0.002)

    const camera = new THREE.PerspectiveCamera(
      45, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 700
    )

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputEncoding = THREE.sRGBEncoding
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.95
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    buildLighting(scene)
    buildStadium(scene)
    buildPitch(scene, renderer)
    buildGoals(scene)
    buildAdBoards(scene)
    buildPitchSurround(scene)

    const dynamic = new THREE.Group()   // players + lanes + arrow, per frame
    scene.add(dynamic)
    const ghost = new THREE.Group()     // what-if best-alternative arrow overlay
    scene.add(ghost)

    // orbit state (manual — no OrbitControls in r128 via npm)
    const orbit = {
      theta: -Math.PI / 2, phi: 0.9, radius: 95,
      targetTheta: -Math.PI / 2, targetPhi: 0.9, targetRadius: 95,
      target: new THREE.Vector3(0, 0, 0),
      desiredTarget: new THREE.Vector3(0, 0, 0),
      dragging: false, panning: false, lastX: 0, lastY: 0,
      vTheta: 0, vPhi: 0,                // inertia after release
      pinchDist: 0, pinchMidX: 0, pinchMidY: 0,
      autoRotate: true,
    }

    const ctx = {
      scene, camera, renderer, dynamic, ghost, orbit,
      flip: false,   // whether the per-event scene is point-reflected (away team)
      hoverTargets: [], raycaster: new THREE.Raycaster(),
      mouse: new THREE.Vector2(), disposed: false,
      hovered: null,
      home: { theta: -Math.PI / 2, phi: 0.9, radius: 95, target: new THREE.Vector3(0, 0, 0) },
    }
    ctxRef.current = ctx

    // interaction
    const el = renderer.domElement
    el.style.touchAction = 'none'

    const clampPhi = (p) => Math.max(0.12, Math.min(1.45, p))
    const clampRadius = (r) => Math.max(12, Math.min(125, r))

    const panBy = (dx, dy) => {
      const k = orbit.radius * 0.0014
      const fwd = new THREE.Vector3()
      camera.getWorldDirection(fwd)
      fwd.y = 0
      if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0)
      fwd.normalize()
      const right = new THREE.Vector3().crossVectors(fwd, UP)
      orbit.desiredTarget.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k)
      orbit.desiredTarget.x = Math.max(-58, Math.min(58, orbit.desiredTarget.x))
      orbit.desiredTarget.z = Math.max(-42, Math.min(42, orbit.desiredTarget.z))
      orbit.desiredTarget.y = 0
    }

    const setHover = (disc) => {
      if (ctx.hovered === disc) return
      if (ctx.hovered) ctx.hovered.material.emissive.setHex(0x000000)
      ctx.hovered = disc
      if (disc) disc.material.emissive.setHex(0x333333)
      el.style.cursor = disc ? 'pointer' : ''
    }

    const onMouseDown = (e) => {
      orbit.autoRotate = false
      orbit.vTheta = orbit.vPhi = 0
      if (e.button === 2 || e.button === 1) orbit.panning = true
      else orbit.dragging = true
      orbit.lastX = e.clientX
      orbit.lastY = e.clientY
    }
    const onMouseUp = () => { orbit.dragging = false; orbit.panning = false }
    const onMouseMove = (e) => {
      const dx = e.clientX - orbit.lastX
      const dy = e.clientY - orbit.lastY
      if (orbit.dragging) {
        orbit.targetTheta -= dx * 0.005
        orbit.targetPhi = clampPhi(orbit.targetPhi - dy * 0.004)
        orbit.vTheta = -dx * 0.003          // remembered for inertia on release
        orbit.vPhi = -dy * 0.0024
        orbit.lastX = e.clientX
        orbit.lastY = e.clientY
        setTooltip(null)
        return
      }
      if (orbit.panning) {
        panBy(dx, dy)
        orbit.lastX = e.clientX
        orbit.lastY = e.clientY
        setTooltip(null)
        return
      }
      // hover tooltip + highlight
      const rect = el.getBoundingClientRect()
      ctx.mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      ctx.raycaster.setFromCamera(ctx.mouse, camera)
      const hits = ctx.raycaster.intersectObjects(ctx.hoverTargets, false)
      if (hits.length > 0) {
        setHover(hits[0].object)
        const p = hits[0].object.userData.player
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          name: p.player_name || 'Unknown player',
          jersey: p.jersey_number,
          position: p.position,
          confidence: p.identity_confidence,
        })
      } else {
        setHover(null)
        setTooltip(null)
      }
    }
    const onWheel = (e) => {
      e.preventDefault()
      orbit.targetRadius = clampRadius(orbit.targetRadius + e.deltaY * 0.06)
    }
    const onDblClick = () => {
      const h = ctx.home
      // unwind accumulated rotations so the reset doesn't spin the long way round
      orbit.targetTheta = h.theta + Math.round((orbit.theta - h.theta) / (2 * Math.PI)) * 2 * Math.PI
      orbit.targetPhi = h.phi
      orbit.targetRadius = h.radius
      orbit.desiredTarget.copy(h.target)
      orbit.vTheta = orbit.vPhi = 0
    }
    const onContextMenu = (e) => e.preventDefault()

    const onTouchStart = (e) => {
      orbit.autoRotate = false
      orbit.vTheta = orbit.vPhi = 0
      if (e.touches.length === 1) {
        orbit.dragging = true
        orbit.lastX = e.touches[0].clientX
        orbit.lastY = e.touches[0].clientY
      } else if (e.touches.length === 2) {
        orbit.dragging = false
        orbit.pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        orbit.pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        orbit.pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      }
    }
    const onTouchMove = (e) => {
      e.preventDefault()
      if (e.touches.length === 1 && orbit.dragging) {
        const dx = e.touches[0].clientX - orbit.lastX
        const dy = e.touches[0].clientY - orbit.lastY
        orbit.targetTheta -= dx * 0.006
        orbit.targetPhi = clampPhi(orbit.targetPhi - dy * 0.005)
        orbit.vTheta = -dx * 0.0036
        orbit.vPhi = -dy * 0.003
        orbit.lastX = e.touches[0].clientX
        orbit.lastY = e.touches[0].clientY
      } else if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        orbit.targetRadius = clampRadius(orbit.targetRadius + (orbit.pinchDist - d) * 0.25)
        orbit.pinchDist = d
        // two-finger drag pans
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
        panBy(midX - orbit.pinchMidX, midY - orbit.pinchMidY)
        orbit.pinchMidX = midX
        orbit.pinchMidY = midY
      }
    }
    const onTouchEnd = () => { orbit.dragging = false }
    const onMouseLeave = () => { setHover(null); setTooltip(null) }

    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    el.addEventListener('mousemove', onMouseMove)
    el.addEventListener('mouseleave', onMouseLeave)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('dblclick', onDblClick)
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)

    // resize
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = Math.max(1, mount.clientHeight)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(mount)

    // render loop
    const clock = new THREE.Clock()
    let raf
    const animate = () => {
      if (ctx.disposed) return
      raf = requestAnimationFrame(animate)
      const t = clock.getElapsedTime()

      if (orbit.autoRotate && !orbit.dragging) orbit.targetTheta += 0.0012

      // inertia after the user lets go
      if (!orbit.dragging && (Math.abs(orbit.vTheta) > 1e-5 || Math.abs(orbit.vPhi) > 1e-5)) {
        orbit.targetTheta += orbit.vTheta
        orbit.targetPhi = Math.max(0.12, Math.min(1.45, orbit.targetPhi + orbit.vPhi))
        orbit.vTheta *= 0.9
        orbit.vPhi *= 0.9
      }

      orbit.theta += (orbit.targetTheta - orbit.theta) * 0.1
      orbit.phi += (orbit.targetPhi - orbit.phi) * 0.1
      orbit.radius += (orbit.targetRadius - orbit.radius) * 0.1
      orbit.target.lerp(orbit.desiredTarget, 0.08)

      camera.position.set(
        orbit.target.x + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
        orbit.target.y + orbit.radius * Math.cos(orbit.phi),
        orbit.target.z + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta)
      )
      camera.lookAt(orbit.target)

      // actor pulse animation
      dynamic.traverse(obj => {
        if (obj.userData.isPulse) {
          const k = 1 + 0.22 * Math.sin(t * 3.2)
          obj.scale.set(k, k, 1)
          obj.material.opacity = 0.45 + 0.35 * Math.sin(t * 3.2 + Math.PI / 2)
        }
      })

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      ctx.disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('mouseleave', onMouseLeave)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('dblclick', onDblClick)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  // per-frame content: players, lanes, arrow, ball, camera target
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { dynamic, orbit } = ctx

    // clear previous frame
    while (dynamic.children.length) {
      const child = dynamic.children[0]
      child.traverse(o => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          if (o.material.map) o.material.map.dispose()
          o.material.dispose()
        }
      })
      dynamic.remove(child)
    }
    ctx.hoverTargets.length = 0
    ctx.hovered = null
    setTooltip(null)

    if (!frameData || !frameData.players) {
      // empty stadium — slow cinematic auto-rotate
      orbit.autoRotate = true
      orbit.desiredTarget.set(0, 0, 0)
      orbit.targetRadius = 95
      orbit.targetPhi = 0.9
      ctx.home = { theta: -Math.PI / 2, phi: 0.9, radius: 95, target: new THREE.Vector3(0, 0, 0) }
      return
    }

    orbit.autoRotate = false
    const { players, event, teams } = frameData
    // Read EVERYTHING that drives orientation from frameData (the frame we are
    // actually rendering), never from activeEvent: activeEvent updates instantly
    // on click while frameData loads async, and mixing the new event's team/period
    // with the old frame's players is what flipped the pitch the wrong way.
    const actorTeam = teams?.actor_team || event?.team
    const opponentTeam = teams?.opponent_team

    const actor = players.find(p => p.actor)
    const actorPos = actor ? sbToThree(actor.location) : sbToThree(event.location || [60, 40])

    // StatsBomb normalises every event so the team on the ball attacks +x. Left
    // as-is, the whole pitch flips end-for-end whenever possession changes
    // between two consecutive events. Pin a stable orientation instead, matching
    // the real broadcast: in the 1st half the home team attacks +x and the away
    // team -x; at half-time both sides switch ends, and they switch again each
    // extra-time period. We render the frame in normalised space (actor attacks
    // +x) and rotate the entire per-event group 180° about the pitch centre when
    // the actor should be attacking -x. A point-reflection preserves all internal
    // geometry (distances, lanes, arrows) exactly, so only the on-screen
    // direction changes — the metric math upstream still sees the untouched
    // normalised coordinates.
    const period = event?.period || activeEvent?.period || 1
    const endsSwitched = period === 2 || period === 4   // 2nd half / ET2 -> swapped
    const awaySide = !!(actorTeam && match?.away_team && actorTeam === match.away_team)
    const flip = awaySide !== endsSwitched              // XOR
    dynamic.rotation.y = flip ? Math.PI : 0

    // Which team attacks the world +x goal is FIXED for the whole half (home in the
    // 1st half & ET1, the away team in the 2nd half & ET2, because ends switch at
    // each break). Label the banners by this, not by who currently has the ball,
    // so the "ATTACKING" sign is stable through a half and only flips at HT / ET.
    const periodA = period === 1 || period === 3
    const teamPlusX = (periodA ? match?.home_team : match?.away_team)
      || (flip ? opponentTeam : actorTeam)
    const teamMinusX = (periodA ? match?.away_team : match?.home_team)
      || (flip ? actorTeam : opponentTeam)
    ctx.flip = flip   // so the what-if ghost arrow matches the scene orientation

    // player discs — resolve kits so clashing teams (e.g. USA & Iran, both
    // white) don't render identically; the away side gets a contrasting kit
    const kits = resolveKits(match?.home_team, match?.away_team)
    const kitOf = (t) => kits[t] || getKit(t)
    players.forEach((p, idx) => {
      const kit = kitOf(p.teammate ? actorTeam : opponentTeam)
      dynamic.add(makePlayerDisc(p, kit, !!p.actor, ctx.hoverTargets, idx))
    })

    // direction of play: a banner over each goal naming the team attacking it,
    // plus ground chevrons pointing the way they attack. Banners are labelled by
    // WORLD side (teamPlusX / teamMinusX) so the sign stays put through a half;
    // they sit inside the flipped group, so place them in local space that lands
    // on the right world goal after the flip (local +60 -> world -60 when flipped).
    const toHex = (cssHex) => new THREE.Color(cssHex).getHex()
    const plusXLocal = flip ? -60 : 60
    if (teamPlusX) {
      const banner = makeAttackBanner(teamPlusX, toHex(kitOf(teamPlusX).primary))
      banner.position.set(plusXLocal, 9, 0)
      dynamic.add(banner)
    }
    if (teamMinusX) {
      const banner = makeAttackBanner(teamMinusX, toHex(kitOf(teamMinusX).primary))
      banner.position.set(-plusXLocal, 9, 0)
      dynamic.add(banner)
    }
    // chevrons stay tied to the normalised attack: the actor always attacks local
    // +x, the opponent local -x (coloured by team), consistent with the banners.
    if (actorTeam) {
      const chev = makeAttackChevrons(toHex(kitOf(actorTeam).primary))
      chev.position.set(34, 0, -32)   // along the near touchline, clear of play
      dynamic.add(chev)
    }
    if (opponentTeam) {
      const chev = makeAttackChevrons(toHex(kitOf(opponentTeam).primary))
      chev.position.set(-34, 0, -32)
      chev.rotation.y = Math.PI       // flip so the chevrons point toward -x
      dynamic.add(chev)
    }

    // passing lanes (actor -> each outfield teammate) as bold ground ribbons
    const opponents = players.filter(p => !p.teammate).map(p => sbToThree(p.location))
    for (const tm of players.filter(p => p.teammate && !p.actor)) {
      const end = sbToThree(tm.location, 0.12)
      const start = actorPos.clone().setY(0.12)
      const blocked = laneClearance(opponents, start, end) < LANE_BLOCK_RADIUS
      const mat = blocked
        ? new THREE.MeshBasicMaterial({
            color: 0xff2d55, transparent: true, opacity: 0.45,
            depthWrite: false, toneMapped: false,
          })
        : new THREE.MeshBasicMaterial({
            color: 0x00e5a0, transparent: true, opacity: 0.3,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
          })
      dynamic.add(ribbonMesh(start, end, 0.22, mat))
    }

    // action arrow to end_location. Shots arc up to their real height (z) and
    // are coloured + tagged by outcome, so an off-target shot visibly sails over
    // and reads as a miss instead of looking on goal. Ground actions stay flat.
    if (event.end_location) {
      const isShot = event.type === 'Shot'
      const outcome = frameData.context?.outcome || event.outcome
      const colHex = isShot ? shotOutcomeColor(outcome) : eventColor(event.type)
      const color = new THREE.Color(colHex)

      const start = actorPos.clone().setY(0.4)
      const endZ = isShot && event.end_location.length > 2 ? event.end_location[2] : 0
      const end = sbToThree(event.end_location, Math.max(0.3, endZ))
      const flatDir = end.clone().setY(start.y).sub(start)
      const total = flatDir.length()

      if (total > 0.5) {
        // a quadratic arc; shots loft, ground actions keep a flat line
        const mid = start.clone().lerp(end, 0.5)
        if (isShot) mid.y = Math.max(start.y, end.y) + 0.8 + total * 0.06
        const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
        const L = curve.getLength()

        const dashMat = new THREE.MeshBasicMaterial({ color, toneMapped: false })
        const dashLen = 1.2, gap = 0.8, step = dashLen + gap
        for (let d = 0; d < L - 1.0; d += step) {
          const a = curve.getPoint(Math.min(d / L, 1))
          const b = curve.getPoint(Math.min((d + dashLen) / L, (L - 0.9) / L))
          const seg = dashSegment3D(a, b, 0.14, dashMat)
          if (seg) dynamic.add(seg)
        }

        const head = new THREE.Mesh(
          new THREE.ConeGeometry(0.5, 1.5, 12),
          new THREE.MeshBasicMaterial({ color, toneMapped: false })
        )
        head.position.copy(end)
        head.quaternion.setFromUnitVectors(UP, curve.getTangent(1).normalize())
        dynamic.add(head)
      }

      // match ball at the actor's feet, nudged toward the action
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 32, 24),
        new THREE.MeshLambertMaterial({ map: makeBallTexture(), emissive: 0x1c1c1c })
      )
      ball.castShadow = true
      ball.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI * 2, 0)
      ball.position.copy(actorPos).setY(0.45)
      if (total > 0.5) ball.position.addScaledVector(flatDir.clone().normalize(), 1.6)
      dynamic.add(ball)
    }

    // camera: a FIXED broadcast viewpoint for the whole match. The scene is
    // point-reflected per possession (keeping the world stable: home attacks +x in
    // the 1st half/ET1, -x in the 2nd half/ET2) and worldActor is reflected to
    // match. Because the camera angle never changes, it never spins on a turnover,
    // and the world's end-switch becomes VISIBLE: the teams swap attacking
    // direction on screen at half-time and at extra-time half-time, like a real
    // broadcast, while staying stable within each half.
    const worldActor = flip
      ? new THREE.Vector3(-actorPos.x, actorPos.y, -actorPos.z)
      : actorPos
    orbit.desiredTarget.copy(worldActor)
    const offset = new THREE.Vector3(-22, 14, 7)   // behind & above, slight angle
    const sph = new THREE.Spherical().setFromVector3(offset)
    // keep theta continuous so the camera takes the short way round
    orbit.targetTheta = sph.theta + Math.round((orbit.theta - sph.theta) / (2 * Math.PI)) * 2 * Math.PI
    orbit.targetPhi = sph.phi
    orbit.targetRadius = sph.radius
    ctx.home = {
      theta: orbit.targetTheta, phi: sph.phi, radius: sph.radius,
      target: worldActor.clone(),
    }
  }, [frameData])

  // what-if ghost arrow: the best alternative, drawn over the live scene
  // A separate effect so toggling the What-If tab (or the verdict arriving async)
  // never rebuilds the whole frame. Honours the scene's flip so the arrow points
  // to the right end of the pitch.
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const ghost = ctx.ghost
    while (ghost.children.length) {
      const c = ghost.children[0]
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose() } })
      ghost.remove(c)
    }
    const s = whatIf?.summary
    if (!showWhatIf || !s || !Array.isArray(whatIf.origin) || !Array.isArray(s.best_target)) return

    const toWorld = (loc, y = 0.55) => {
      const x = loc[0] - 60, z = loc[1] - 40
      return ctx.flip ? new THREE.Vector3(-x, y, -z) : new THREE.Vector3(x, y, z)
    }
    const start = toWorld(whatIf.origin)
    const end = toWorld(s.best_target)
    const GHOST = 0x2fe0a6
    if (start.distanceTo(end) > 1) {
      // dashed ground line from the ball to the best option
      const mat = new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.85, toneMapped: false })
      const dir = end.clone().sub(start)
      const L = dir.length()
      dir.normalize()
      const dashLen = 1.3, gap = 0.9, step = dashLen + gap
      for (let d = 0; d < L - 0.8; d += step) {
        const a = start.clone().addScaledVector(dir, d)
        const b = start.clone().addScaledVector(dir, Math.min(d + dashLen, L))
        const seg = dashSegment3D(a, b, 0.16, mat)
        if (seg) ghost.add(seg)
      }
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.6, 1.7, 12),
        new THREE.MeshBasicMaterial({ color: GHOST, toneMapped: false })
      )
      head.position.copy(end)
      head.quaternion.setFromUnitVectors(UP, dir)
      ghost.add(head)
    }
    // the best option is named (with its xT value) in the What-If panel, so the
    // green arrow alone marks the direction here — no floating tag needed
  }, [whatIf, showWhatIf, frameData])

  // HUD data
  const ctxData = frameData?.context
  const pressureColor = ctxData?.pressure === 'HIGH' ? 'var(--red)'
    : ctxData?.pressure === 'MEDIUM' ? 'var(--amber)' : 'var(--green)'
  const pressureWidth = ctxData?.pressure === 'HIGH' ? '90%'
    : ctxData?.pressure === 'MEDIUM' ? '55%' : '22%'
  const actorTeam = frameData?.teams?.actor_team
  const opponentTeam = frameData?.teams?.opponent_team
  const legendKits = resolveKits(match?.home_team, match?.away_team)
  const legendKitOf = (t) => legendKits[t] || getKit(t)
  const isShotEvent = activeEvent?.type === 'Shot'
  // a penalty is one on one with the keeper, so the open-team-mate and
  // nearest-defender read-outs are meaningless; the HUD shows only outcome.
  const isPenaltyEvent = activeEvent?.shot_type === 'Penalty'
  const titleCase = (s) => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
  const arrowLegendColor = isShotEvent
    ? `#${shotOutcomeColor(ctxData?.outcome).toString(16).padStart(6, '0')}`
    : eventColor(activeEvent?.type)
  const arrowLegendLabel = isShotEvent
    ? `Shot ${titleCase(shotOutcomeLabel(ctxData?.outcome))}`
    : `${activeEvent?.type || 'Action'} Made`

  return (
    <div className="three-pitch" ref={mountRef}>
      {/* AI analyst, always present in the top-right of the screen */}
      {analyst && match && (
        <AnalystBox
          analyst={analyst}
          explanation={explanation}
          explaining={explaining}
          activeEvent={activeEvent}
          mood={analystMood}
        />
      )}

      {/* empty state */}
      {!match && !frameData && (
        <div className="tp-empty">
          <div className="tp-empty-eyebrow">{tr('Welcome to FirstTouch')}</div>
          <div className="tp-empty-title">{tr('SELECT MATCH')}</div>
          <div className="tp-empty-sub">{tr('FIFA World Cup 2022™ · 64 matches · Full 360° freeze-frame coverage')}</div>
        </div>
      )}
      {match && !frameData && !loading && (
        <div className="tp-empty">
          <div className="tp-empty-title">{tr('PICK A MOMENT')}</div>
          <div className="tp-empty-sub">{tr('Choose an event from the list to reconstruct what the player saw')}</div>
        </div>
      )}
      {loading && (
        <div className="tp-loading">
          <span className="tp-loading-spinner" />
          Reconstructing freeze frame…
        </div>
      )}

      {/* HUD — only with a live frame */}
      {frameData && activeEvent && (
        <>
          {match && (
            <div className="tp-hud tp-hud-tl">
              <div className="tp-scorebug">
                <div className="tp-sb-clock">
                  {activeEvent.minute}:{String(activeEvent.second ?? 0).padStart(2, '0')}
                </div>
                <div className="tp-sb-main">
                  <span className="tp-sb-team">
                    {flagUrl(match.home_team) && (
                      <img className="tp-sb-flag" src={flagUrl(match.home_team)} alt="" />
                    )}
                    <span className="tp-sb-code">{teamAbbr(match.home_team)}</span>
                  </span>
                  <span className="tp-sb-score">
                    {liveScore?.home ?? 0}<span className="tp-sb-sep">-</span>{liveScore?.away ?? 0}
                  </span>
                  <span className="tp-sb-team">
                    <span className="tp-sb-code">{teamAbbr(match.away_team)}</span>
                    {flagUrl(match.away_team) && (
                      <img className="tp-sb-flag" src={flagUrl(match.away_team)} alt="" />
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="tp-hud tp-hud-bl">
            <div className="tp-hud-label">{tr('PRESSURE')}</div>
            <div className="tp-pressure-value" style={{ color: pressureColor }}>
              {ctxData?.pressure ? tr(ctxData.pressure) : '-'}
            </div>
            <div className="tp-pressure-bar">
              <div className="tp-pressure-fill" style={{ width: pressureWidth, background: pressureColor }} />
            </div>
          </div>

          <div className="tp-hud tp-hud-br">
            {!isPenaltyEvent && (
              <div className="tp-stat">
                <span className="tp-hud-label">{tr('OPEN')}</span>
                <span className="tp-stat-val">{ctxData?.open_teammate_count ?? '-'}/{ctxData?.teammate_count ?? '-'}</span>
              </div>
            )}
            {!isPenaltyEvent && (
              <div className="tp-stat">
                <span className="tp-hud-label">{tr('NEAREST DEF')}</span>
                <span className="tp-stat-val">
                  {typeof ctxData?.nearest_defender_dist === 'number' ? `${ctxData.nearest_defender_dist.toFixed(1)}m` : '-'}
                </span>
              </div>
            )}
            <div className="tp-stat">
              <span className="tp-hud-label">{tr('OUTCOME')}</span>
              <span className="tp-stat-val">{tr(prettyOutcome(ctxData?.outcome)) || '-'}</span>
            </div>
          </div>

          <div className="tp-hud tp-hud-legend">
            {actorTeam && (
              <span className="tp-legend-item">
                <span className="tp-legend-dot" style={{ background: legendKitOf(actorTeam).primary }} />
                {tr(actorTeam)}
              </span>
            )}
            {opponentTeam && (
              <span className="tp-legend-item">
                <span className="tp-legend-dot" style={{ background: legendKitOf(opponentTeam).primary }} />
                {tr(opponentTeam)}
              </span>
            )}
            <span className="tp-legend-item">
              <span className="tp-legend-line" style={{ background: 'var(--green)' }} />
              {tr('Open Lane')}
            </span>
            <span className="tp-legend-item">
              <span className="tp-legend-line" style={{ background: 'var(--red)' }} />
              {tr('Blocked')}
            </span>
            <span className="tp-legend-item">
              <span
                className="tp-legend-arrow"
                style={{ color: arrowLegendColor }}
              />
              {tr(arrowLegendLabel)}
            </span>
          </div>
        </>
      )}

      <div className="tp-hud tp-hud-hint">{tr('🖱 Drag rotate · Right-drag pan · Scroll zoom · Double-click recenter')}</div>

      <button
        className="tp-fullscreen"
        onClick={toggleFullscreen}
        title={isFullscreen ? tr('Exit full screen') : tr('Full screen')}
        aria-label={isFullscreen ? tr('Exit full screen') : tr('Full screen')}
      >
        {isFullscreen ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        )}
      </button>

      {/* hover tooltip */}
      {tooltip && (
        <div className="tp-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 10 }}>
          <span className="tp-tooltip-name">
            {tooltip.jersey != null && <strong>#{tooltip.jersey}</strong>} {tooltip.name}
          </span>
          {tooltip.position && <span className="tp-tooltip-pos">{tooltip.position}</span>}
          <span className={`tp-tooltip-conf tp-conf-${tooltip.confidence}`}>
            {tooltip.confidence === 'exact' ? '● identity exact'
              : tooltip.confidence === 'inferred' ? '◐ identity inferred' : '○ identity unknown'}
          </span>
        </div>
      )}
    </div>
  )
}

#!/usr/bin/env node
'use strict'

// Generates build/icon.png (512x512) used by electron-builder for the
// Windows icon (electron-builder converts the PNG into .ico automatically).
// Self-contained: uses `pngjs`, already a transitive dependency of `qrcode`.
// Run with: npm run make-icon

const fs = require('node:fs')
const path = require('node:path')
const { PNG } = require('pngjs')

const SIZE = 512
const png = new PNG({ width: SIZE, height: SIZE })

// --- helpers -----------------------------------------------------------
function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const idx = (SIZE * y + x) << 2
  png.data[idx] = r
  png.data[idx + 1] = g
  png.data[idx + 2] = b
  png.data[idx + 3] = a
}

function fillCircle(cx, cy, radius, r, g, b, a = 255) {
  const r2 = radius * radius
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r2) setPixel(x, y, r, g, b, a)
    }
  }
}

function drawLine(x0, y0, x1, y1, r, g, b, width = 10, a = 255) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps
    const x = Math.round(x0 + (x1 - x0) * t)
    const y = Math.round(y0 + (y1 - y0) * t)
    fillCircle(x, y, width / 2, r, g, b, a)
  }
}

// --- background: rounded square with vertical gradient -----------------
const bgTop = [99, 102, 241]    // #6366f1
const bgBottom = [139, 92, 246] // #8b5cf6
const radius = 96
function inRoundedRect(x, y, r) {
  const left = r
  const right = SIZE - r
  const top = r
  const bottom = SIZE - r
  if (x < left || x > right || y < top || y > bottom) {
    const cx = x < left ? left : (x > right ? right : x)
    const cy = y < top ? top : (y > bottom ? bottom : y)
    const dx = x - cx
    const dy = y - cy
    return dx * dx + dy * dy <= r * r
  }
  return true
}
for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1)
  const r = Math.round(bgTop[0] + (bgBottom[0] - bgTop[0]) * t)
  const g = Math.round(bgTop[1] + (bgBottom[1] - bgTop[1]) * t)
  const b = Math.round(bgTop[2] + (bgBottom[2] - bgTop[2]) * t)
  for (let x = 0; x < SIZE; x++) {
    if (inRoundedRect(x, y, radius)) setPixel(x, y, r, g, b)
  }
}

// --- network motif: center + 4 satellites, linked (P2P nodes) ----------
const white = [236, 232, 222] // --paper
const cx = SIZE / 2
const cy = SIZE / 2
const dist = 132
const nodes = [
  [cx, cy],             // center
  [cx, cy - dist],      // north
  [cx + dist, cy],      // east
  [cx, cy + dist],      // south
  [cx - dist, cy]       // west
]
const nodeRadius = 34
const centerRadius = 46

// center -> satellites
for (const n of nodes.slice(1)) {
  drawLine(cx, cy, n[0], n[1], white[0], white[1], white[2], 10)
}
// diamond ring between adjacent satellites
drawLine(nodes[1][0], nodes[1][1], nodes[2][0], nodes[2][1], white[0], white[1], white[2], 10)
drawLine(nodes[2][0], nodes[2][1], nodes[3][0], nodes[3][1], white[0], white[1], white[2], 10)
drawLine(nodes[3][0], nodes[3][1], nodes[4][0], nodes[4][1], white[0], white[1], white[2], 10)
drawLine(nodes[4][0], nodes[4][1], nodes[1][0], nodes[1][1], white[0], white[1], white[2], 10)
// node discs
for (const n of nodes) {
  fillCircle(n[0], n[1], nodeRadius, white[0], white[1], white[2])
}
fillCircle(cx, cy, centerRadius, white[0], white[1], white[2])

// --- save --------------------------------------------------------------
const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'icon.png')
fs.writeFileSync(outFile, PNG.sync.write(png))
console.log('Icon written to', outFile, '(' + SIZE + 'x' + SIZE + ')')

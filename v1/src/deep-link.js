'use strict'

// Deep-link support for the Coherence desktop app (Windows).
//
// Handles `coherence://` URLs:
//   coherence://profile/<64-hex-public-key>
//   coherence://post/<64-hex-public-key>/<seq>
//
// The app can run several accounts in parallel (one process per account, no
// single-instance lock). To route a clicked link to any already-open window we
// use a machine-wide registry (small JSON files in %TEMP%/coherence-deeplink)
// plus a loopback TCP server per account. The process launched by the OS for
// the link reads the registry, picks the most recently seen instance and sends
// the URL to its loopback port; if nothing is running it returns false so the
// app boots normally and applies the link after an account is chosen.
//
// This module is pure Node (no Electron) so it can be unit-tested with plain
// `node` like the rest of the v1/test suite.

const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

const SCHEME = 'coherence://'
const HEX64 = /^[0-9a-f]{64}$/i
const PORT_BASE = 32000
const PORT_RANGE = 1000
const PORT_COLLISION_TRIES = 24
const STALE_MS = 60 * 1000 // registry entries older than this are considered dead
const HEARTBEAT_MS = 15 * 1000
const SEND_TIMEOUT_MS = 800

/**
 * Directory that holds the machine-wide registry of running instances.
 * A `dir` override is used by the tests to keep the temp dir isolated.
 */
function registryDir(dir) {
  return dir || path.join(os.tmpdir(), 'coherence-deeplink')
}

/** Deterministic loopback port for an account key ('welcome' or a hex folder). */
function instancePort(accountKey) {
  const hash = crypto.createHash('sha1').update(String(accountKey)).digest()
  return PORT_BASE + (hash.readUInt32BE(0) % PORT_RANGE)
}

/**
 * Returns the first argv element that looks like a coherence:// URL, or null.
 * On Windows the OS passes the clicked link as a command-line argument.
 */
function extractCoherenceUrl(argv = process.argv) {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.trim().toLowerCase().startsWith(SCHEME)) {
      return arg.trim()
    }
  }
  return null
}

/**
 * Parses and validates a coherence:// URL.
 * @param {string} url
 * @returns {{route: 'profile'|'post', key: string, seq?: number}|null}
 */
function parseCoherenceUrl(url) {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed.toLowerCase().startsWith(SCHEME)) return null

  // Drop query/hash and trailing slashes, then split the path segments.
  const withoutQuery = trimmed.slice(SCHEME.length).split(/[?#]/, 1)[0]
  const segments = withoutQuery.replace(/\/+$/, '').split('/').filter(Boolean)
  const [route, key, seqRaw] = segments
  if (!route || !key) return null

  const normalizedKey = key.toLowerCase()
  if (!HEX64.test(normalizedKey)) return null

  if (route.toLowerCase() === 'profile') {
    if (segments.length > 2) return null
    return { route: 'profile', key: normalizedKey }
  }

  if (route.toLowerCase() === 'post') {
    if (segments.length > 3) return null
    if (seqRaw === undefined || seqRaw === '') return null
    const seq = Number(seqRaw)
    if (!Number.isInteger(seq) || seq < 1) return null
    return { route: 'post', key: normalizedKey, seq }
  }

  return null
}

/**
 * Registers this process in the machine-wide registry and refreshes a
 * heartbeat until `unregister()` is called (used on app quit).
 * @returns {() => void} unregister function
 */
function registerInstance({ accountKey, port, dir } = {}) {
  const root = registryDir(dir)
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, String(accountKey) + '.json')
  const entry = { accountKey, port, pid: process.pid, lastSeen: Date.now() }
  const write = () => {
    try {
      entry.lastSeen = Date.now()
      fs.writeFileSync(file, JSON.stringify(entry))
    } catch {
      // Best effort — the registry is only a routing hint.
    }
  }
  write()
  const heartbeat = setInterval(write, HEARTBEAT_MS)
  if (heartbeat.unref) heartbeat.unref()
  return function unregister() {
    clearInterval(heartbeat)
    try {
      fs.rmSync(file, { force: true })
    } catch {
      // Best effort.
    }
  }
}

/**
 * Finds the most recently seen running instance from the registry.
 * Stale entries (no heartbeat for > STALE_MS) are ignored.
 * @returns {{accountKey: string, port: number, lastSeen: number}|null}
 */
function findActiveInstance({ dir } = {}) {
  const root = registryDir(dir)
  let names = []
  try {
    names = fs.readdirSync(root)
  } catch {
    return null
  }
  const now = Date.now()
  let best = null
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const data = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
      if (!data || typeof data.port !== 'number') continue
      if (now - (data.lastSeen || 0) > STALE_MS) continue
      if (!best || (data.lastSeen || 0) > (best.lastSeen || 0)) {
        best = data
      }
    } catch {
      // Unreadable/corrupt entry — ignore.
    }
  }
  return best
    ? { accountKey: best.accountKey, port: best.port, lastSeen: best.lastSeen }
    : null
}

/**
 * Sends a coherence:// URL to a running instance's loopback server and waits
 * for its `{ ok: true }` acknowledgement.
 * @returns {Promise<boolean>} true when an instance acknowledged the link
 */
function sendDeepLinkTo(port, url, timeoutMs = SEND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false
    let buffer = ''

    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(ok)
    }

    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setEncoding('utf8')
    const timer = setTimeout(() => finish(false), timeoutMs)
    if (timer.unref) timer.unref()

    socket.on('connect', () => {
      socket.write(JSON.stringify({ type: 'deeplink', url }) + '\n')
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const idx = buffer.indexOf('\n')
      if (idx >= 0) {
        try {
          const msg = JSON.parse(buffer.slice(0, idx))
          finish(!!(msg && msg.ok))
        } catch {
          finish(false)
        }
      }
    })
    socket.on('error', () => finish(false))
    socket.on('close', () => finish(false))
  })
}

/**
 * Starts the loopback deep-link server for this account. If the port is taken
 * (another process already owns this account), retries a few offsets and then
 * gives up — the existing owner will receive the links.
 *
 * @param {string} accountKey - 'welcome' or the account folder basename
 * @param {(url: string) => void} onDeepLink - called for each received link
 * @returns {Promise<{port: number, close: () => void}|null>}
 */
async function startDeepLinkServer(accountKey, onDeepLink, { dir, basePort } = {}) {
  const base = typeof basePort === 'number' ? basePort : instancePort(accountKey)

  const handleSocket = (socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        let msg = null
        try {
          msg = JSON.parse(line)
        } catch {
          // Malformed — ignore.
        }
        if (msg && msg.type === 'deeplink') {
          if (typeof onDeepLink === 'function') {
            try {
              onDeepLink(msg.url)
            } catch {
              // Keep serving even if a handler throws.
            }
          }
          socket.write(JSON.stringify({ ok: true }) + '\n')
        }
      }
    })
    socket.on('error', () => {})
  }

  for (let i = 0; i < PORT_COLLISION_TRIES; i++) {
    const port = base + i
    const server = net.createServer(handleSocket)
    server.on('error', () => {})
    const bound = await new Promise((resolve) => {
      server.once('listening', () => resolve(true))
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1')
    })
    if (bound) {
      return { port, close: () => server.close() }
    }
    server.close()
  }
  return null
}

module.exports = {
  SCHEME,
  HEX64,
  registryDir,
  instancePort,
  extractCoherenceUrl,
  parseCoherenceUrl,
  registerInstance,
  findActiveInstance,
  sendDeepLinkTo,
  startDeepLinkServer
}

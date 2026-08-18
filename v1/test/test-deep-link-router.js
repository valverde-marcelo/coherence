'use strict'

// =====================================================================
// UNIT TESTS for the deep-link router + registry (src/deep-link.js).
// Pure Node (no Electron) — uses an isolated temp registry dir.
//
//   - registerInstance / findActiveInstance: machine-wide registry.
//   - startDeepLinkServer / sendDeepLinkTo: loopback URL delivery.
//
// Usage: node test/test-deep-link-router.js
// =====================================================================

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const {
  instancePort,
  registerInstance,
  findActiveInstance,
  sendDeepLinkTo,
  startDeepLinkServer
} = require('../src/deep-link')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coherence-deeplink-test-'))
const URL = 'coherence://profile/' + 'ab'.repeat(32)

;(async () => {
  const checks = []
  const push = (label, pass) => checks.push([label, pass])

  // --- empty registry ---
  push('findActiveInstance returns null on empty registry',
    findActiveInstance({ dir: tmp }) === null)

  // --- single registration ---
  const unregA = registerInstance({ accountKey: 'accountA', port: 31111, dir: tmp })
  const found1 = findActiveInstance({ dir: tmp })
  push('findActiveInstance finds a registered instance',
    !!found1 && found1.port === 31111)

  // --- most recent wins (delay so lastSeen differs) ---
  await new Promise((r) => setTimeout(r, 40))
  const unregB = registerInstance({ accountKey: 'accountB', port: 31112, dir: tmp })
  const found2 = findActiveInstance({ dir: tmp })
  push('findActiveInstance returns the most recently seen instance',
    !!found2 && found2.accountKey === 'accountB')

  // --- unregister removes ---
  unregB()
  const found3 = findActiveInstance({ dir: tmp })
  push('unregister removes the instance from the registry',
    !!found3 && found3.accountKey === 'accountA')

  // --- stale entries ignored ---
  fs.writeFileSync(
    path.join(tmp, 'stale.json'),
    JSON.stringify({ accountKey: 'stale', port: 31113, lastSeen: Date.now() - 120000 })
  )
  const found4 = findActiveInstance({ dir: tmp })
  push('stale registry entries are ignored',
    !!found4 && found4.accountKey === 'accountA')
  fs.rmSync(path.join(tmp, 'stale.json'))

  // --- server + send round-trip ---
  let received = null
  const server = await startDeepLinkServer('welcome', (url) => { received = url }, { dir: tmp, basePort: 31200 })
  push('startDeepLinkServer binds a loopback port',
    !!server && typeof server.port === 'number')

  const acked = await sendDeepLinkTo(server.port, URL)
  push('sendDeepLinkTo delivers the URL and gets an ack',
    acked === true && received === URL)

  // --- second server on the same base retries to a free port ---
  const server2 = await startDeepLinkServer('other', () => {}, { dir: tmp, basePort: 31200 })
  push('second server retries to a free port',
    !!server2 && server2.port !== server.port)

  // --- send to a dead port returns false ---
  const dead = await sendDeepLinkTo(31999, URL)
  push('sendDeepLinkTo returns false when nothing is listening', dead === false)

  // --- instancePort is deterministic and within range ---
  const p1 = instancePort('welcome')
  const p2 = instancePort('welcome')
  push('instancePort is deterministic and within range',
    p1 === p2 && p1 >= 32000 && p1 < 33000)

  // --- cleanup ---
  if (server) server.close()
  if (server2) server2.close()
  unregA()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }

  const ok = checks.every(([, pass]) => pass)
  for (const [label, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}`)
  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  process.exit(1)
})

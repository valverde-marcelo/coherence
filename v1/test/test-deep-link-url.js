'use strict'

// =====================================================================
// UNIT TESTS for the coherence:// URL parser (src/deep-link.js).
//
//   - extractCoherenceUrl: finds the link among command-line args.
//   - parseCoherenceUrl: validates and normalizes profile/post links.
//
// Usage: node test/test-deep-link-url.js
// =====================================================================

const {
  extractCoherenceUrl,
  parseCoherenceUrl
} = require('../src/deep-link')

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const KEY_UPPER = KEY.toUpperCase()

;(async () => {
  const checks = []
  const eq = (label, actual, expected) => {
    checks.push([label, JSON.stringify(actual) === JSON.stringify(expected)])
  }

  // --- extractCoherenceUrl ---
  eq('extractCoherenceUrl finds the link in argv',
    extractCoherenceUrl(['C:\\app.exe', `coherence://profile/${KEY}`]),
    `coherence://profile/${KEY}`)
  eq('extractCoherenceUrl is case-insensitive on the scheme',
    extractCoherenceUrl(['x', `COHERENCE://post/${KEY}/2`]),
    `COHERENCE://post/${KEY}/2`)
  eq('extractCoherenceUrl returns null without a link',
    extractCoherenceUrl(['--user-key', KEY]),
    null)

  // --- profile ---
  eq('profile: valid key',
    parseCoherenceUrl(`coherence://profile/${KEY}`),
    { route: 'profile', key: KEY })
  eq('profile: accepts trailing slash',
    parseCoherenceUrl(`coherence://profile/${KEY}/`),
    { route: 'profile', key: KEY })
  eq('profile: accepts query string',
    parseCoherenceUrl(`coherence://profile/${KEY}?utm=1`),
    { route: 'profile', key: KEY })
  eq('profile: normalizes uppercase key',
    parseCoherenceUrl(`coherence://profile/${KEY_UPPER}`),
    { route: 'profile', key: KEY })
  eq('profile: rejects short key',
    parseCoherenceUrl('coherence://profile/abcd'),
    null)
  eq('profile: rejects invalid chars',
    parseCoherenceUrl(`coherence://profile/${KEY.slice(0, 63)}z`),
    null)
  eq('profile: rejects extra segment',
    parseCoherenceUrl(`coherence://profile/${KEY}/extra`),
    null)

  // --- post ---
  eq('post: valid seq',
    parseCoherenceUrl(`coherence://post/${KEY}/3`),
    { route: 'post', key: KEY, seq: 3 })
  eq('post: large seq',
    parseCoherenceUrl(`coherence://post/${KEY}/123456`),
    { route: 'post', key: KEY, seq: 123456 })
  eq('post: rejects seq 0',
    parseCoherenceUrl(`coherence://post/${KEY}/0`),
    null)
  eq('post: rejects negative seq',
    parseCoherenceUrl(`coherence://post/${KEY}/-1`),
    null)
  eq('post: rejects non-numeric seq',
    parseCoherenceUrl(`coherence://post/${KEY}/abc`),
    null)
  eq('post: rejects float seq',
    parseCoherenceUrl(`coherence://post/${KEY}/1.5`),
    null)
  eq('post: rejects missing seq',
    parseCoherenceUrl(`coherence://post/${KEY}`),
    null)

  // --- misc invalid ---
  eq('rejects unknown route',
    parseCoherenceUrl(`coherence://user/${KEY}`),
    null)
  eq('rejects http',
    parseCoherenceUrl('http://example.com'),
    null)
  eq('rejects non-string',
    parseCoherenceUrl(42),
    null)

  const ok = checks.every(([, pass]) => pass)
  for (const [label, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}`)
  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})

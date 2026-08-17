'use strict'

// =====================================================================
// VALIDATES the hardcoded Coherence official/suggested-users constants
// (src/coherence-official.js).
//
//   - OFFICIAL_COHERENCE_KEY: must be '' (disabled) or a 64-char hex key.
//   - SUGGESTED_USERS: must be an array and every entry must pass the
//     shared validator (valid 64-char hex key + non-empty name + unique).
//
// Usage: node test/test-suggested-users.js
// =====================================================================

const {
  OFFICIAL_COHERENCE_KEY,
  SUGGESTED_USERS,
  validateSuggestedUsers
} = require('../src/coherence-official')

const HEX64 = /^[0-9a-f]{64}$/i

;(async () => {
  const checks = []

  // OFFICIAL_COHERENCE_KEY
  const keyOk = typeof OFFICIAL_COHERENCE_KEY === 'string' &&
    (OFFICIAL_COHERENCE_KEY === '' || HEX64.test(OFFICIAL_COHERENCE_KEY))
  checks.push(['OFFICIAL_COHERENCE_KEY is a string (empty or 64-hex)', keyOk])
  console.log(`OFFICIAL_COHERENCE_KEY: ${OFFICIAL_COHERENCE_KEY || '(empty — auto-follow disabled)'}`)

  // SUGGESTED_USERS shape
  const isArray = Array.isArray(SUGGESTED_USERS)
  checks.push(['SUGGESTED_USERS is an array', isArray])

  const errors = validateSuggestedUsers(SUGGESTED_USERS)
  checks.push(['SUGGESTED_USERS passes validateSuggestedUsers', errors.length === 0])
  if (errors.length) console.log('  validation errors:', errors.join(' | '))
  console.log(`SUGGESTED_USERS entries: ${SUGGESTED_USERS.length}`)

  // Sanity check: the validator itself must reject a clearly invalid list.
  const bad = [{ key: 'not-hex', nome: '' }, { key: 'ab'.repeat(32), nome: 'ok' }]
  const badErrors = validateSuggestedUsers(bad)
  checks.push(['validator rejects invalid entries', badErrors.length > 0])

  // Sanity check: the validator must accept a well-formed list.
  const good = [{ key: 'ab'.repeat(32), nome: 'Sponsored', bio: 'x', label: '★ sponsor' }]
  const goodErrors = validateSuggestedUsers(good)
  checks.push(['validator accepts valid entries', goodErrors.length === 0])

  const ok = checks.every(([, pass]) => pass)
  for (const [label, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}`)
  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('TEST ERROR:', err)
  process.exit(1)
})

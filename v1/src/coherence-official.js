'use strict'

// ====================================================================
// Official Coherence user + suggested users directory
// ====================================================================
//
// This module holds the hardcoded identity of the official "Coherence"
// account and the fixed list of suggested users shown at the top of the
// user search screen.
//
// These are app-level constants (no Electron dependency) so they can be
// unit-tested and shared between the main process (auto-follow + IPC) and
// tests.
// ====================================================================

/**
 * Public key (hex, 64 chars) of the official "Coherence" user.
 *
 * Every NEW user automatically follows this identity on first run (see
 * P2PNode's `autoFollowKey` option). Users can unfollow it later, just like
 * any other user.
 *
 * HOW TO FILL THIS IN:
 *   1. Create the official account with the app (or the CLI) and keep it
 *      running so it can be reached by the network.
 *   2. Copy its shareable public key (the one you would paste to follow it —
 *      it is also printed at startup: "P2P node ready. Public key: <hex>").
 *   3. Paste it below (lowercase, 64 hex chars). Leave `''` to disable the
 *      auto-follow feature entirely.
 *
 * NOTE: while this key is empty the auto-follow is inactive and the app
 * behaves exactly as before. When filled, new accounts follow the official
 * immediately (even if it is offline — they will show "syncing" until the
 * official is reachable).
 */
const OFFICIAL_COHERENCE_KEY = '376794989497e1c5d2661b7b32384135dafd146091abd178dd1d5f441200b089'

/**
 * Fixed list of suggested users shown at the TOP of the user search screen
 * (always visible, even without a query).
 *
 * Each entry:
 *   {
 *     key:  '<64 hex chars — the user's shareable public key>', // required
 *     nome: 'Display name',                                     // required
 *     bio:  'Optional short bio shown under the name',          // optional
 *     label:'Optional tag shown in the meta line, e.g. "★ sponsor"' // optional
 *   }
 *
 * Sponsors/featured accounts can be placed here so they always appear at the
 * top of searches. The list ships with the app (hardcoded) — updating it
 * requires a new release.
 */
const SUGGESTED_USERS = [
  // Example entry (remove the comment to activate):
   {
     key: '376794989497e1c5d2661b7b32384135dafd146091abd178dd1d5f441200b089',
     nome: 'Coherence Oficial',
     bio: 'Updates about the app, releases and community.',
     label: '★ official'
   }
]

const HEX64 = /^[0-9a-f]{64}$/i

/**
 * Validates the suggested-users list. Returns an array of human-readable
 * error strings (empty array = valid).
 * @param {Array<{key?:string, nome?:string, bio?:string, label?:string}>} users
 * @returns {string[]}
 */
function validateSuggestedUsers(users) {
  const errors = []
  if (!Array.isArray(users)) return ['SUGGESTED_USERS must be an array']
  const seen = new Set()
  for (let i = 0; i < users.length; i++) {
    const u = users[i]
    const where = `SUGGESTED_USERS[${i}]`
    if (!u || typeof u !== 'object') {
      errors.push(`${where} must be an object`)
      continue
    }
    if (typeof u.key !== 'string' || !HEX64.test(u.key)) {
      errors.push(`${where}.key must be a 64-char hex public key`)
    } else if (seen.has(u.key)) {
      errors.push(`${where}.key is duplicated (${u.key})`)
    } else {
      seen.add(u.key)
    }
    if (typeof u.nome !== 'string' || u.nome.trim() === '') {
      errors.push(`${where}.nome is required and must be a non-empty string`)
    }
  }
  return errors
}

module.exports = {
  OFFICIAL_COHERENCE_KEY,
  SUGGESTED_USERS,
  validateSuggestedUsers
}

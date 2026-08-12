'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function identityKeyHexFromIdentity(identity) {
  const publicKey = crypto.createPublicKey(identity.publicKey)
  return publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
}

/**
 * Chave pública canônica do usuário: o coreKey (chave do Hypercore, que é a
 * chave compartilhável/replicada — igual a `myPublicKeyHex`) quando presente;
 * antes do core existir (usuário novo / importação sem coreKey), cai para a
 * chave de identidade (Ed25519), que é o que nomeia a pasta na criação.
 */
function publicKeyHexFromIdentity(identity) {
  if (typeof identity.coreKey === 'string' && /^[0-9a-f]{64}$/i.test(identity.coreKey)) {
    return identity.coreKey.toLowerCase()
  }
  return identityKeyHexFromIdentity(identity)
}

/**
 * Verifica se uma identidade corresponde a uma chave passada em --user-key.
 * A pasta de um usuário pode ter sido nomeada de duas formas legítimas:
 *   1. pela chave de identidade (Ed25519) — usuário criado localmente, ou
 *      importado antes do coreKey existir no arquivo;
 *   2. pelo coreKey — identidade importada cujo arquivo já trazia coreKey.
 * Aceita qualquer um dos dois, para não rejeitar pastas existentes.
 */
function identityMatchesKey(identity, requestedKey) {
  if (!identity) return false
  if (publicKeyHexFromIdentity(identity) === requestedKey) return true
  try {
    return identityKeyHexFromIdentity(identity) === requestedKey
  } catch {
    return false
  }
}

function readIdentity(identityFile) {
  try {
    return JSON.parse(fs.readFileSync(identityFile, 'utf8'))
  } catch {
    return null
  }
}

function userDataDir(dataRoot, publicKeyHex) {
  return path.join(dataRoot, publicKeyHex)
}

function recoveredMarkerFile(dataDir) {
  return path.join(dataDir, 'recovered.json')
}

/**
 * Um usuário só é considerado "estabelecido/recuperado" quando este marcador existe.
 * Ele é gravado APENAS depois que a identidade importada foi de fato recuperada da
 * rede (ou quando um usuário novo/normal é criado). Sem o marcador, uma pasta
 * `corestore` órfã (ex.: de uma recuperação interrompida/cancelada) NUNCA pode ser
 * promovida a "usuário" — a aplicação volta para o fluxo de recuperação.
 */
function isRecovered(dataDir) {
  return fs.existsSync(recoveredMarkerFile(dataDir))
}

function writeRecoveredMarker(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(recoveredMarkerFile(dataDir), JSON.stringify({ recoveredAt: Date.now() }, null, 2))
}

function listUserKeys(dataRoot) {
  if (!fs.existsSync(dataRoot)) return []
  return fs.readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f]{64}$/i.test(entry.name))
    .map((entry) => entry.name.toLowerCase())
}

function parseUserKeyArg(argv = process.argv, env = process.env) {
  const index = argv.indexOf('--user-key')
  const value = index >= 0
    ? argv[index + 1]
    : argv.find((arg) => arg.startsWith('--user-key='))?.slice(11) || env.npm_config_user_key
  if (value === undefined) return null
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('--user-key precisa ser uma chave pública hexadecimal de 64 caracteres.')
  return value.toLowerCase()
}

module.exports = {
  publicKeyHexFromIdentity,
  identityKeyHexFromIdentity,
  identityMatchesKey,
  readIdentity,
  userDataDir,
  recoveredMarkerFile,
  isRecovered,
  writeRecoveredMarker,
  listUserKeys,
  parseUserKeyArg
}
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

/**
 * Migra um usuário legado (identity.json + corestore na RAÍZ do dataRoot,
 * layout da versão pré multi-usuário) para uma pasta própria, nomeada pela
 * chave pública canônica.
 *
 * Regras:
 *  - Só move os arquivos legados da raiz (identity.json, corestore, settings
 *    etc.). NUNCA move pastas de outros usuários locais (pastas com nome de
 *    chave hex de 64 caracteres) — senão elas seriam "engolidas" e os demais
 *    usuários sumiriam da listagem.
 *  - Se o usuário legado tem corestore local íntegro, grava o marcador
 *    `recovered.json`. Sem ele, o app trataria a conta como importação
 *    pendente e entraria em "recuperação", ignorando os dados locais e
 *    ficando eternamente em "buscando seeders na rede".
 */
function migrateLegacyData(dataRoot) {
  const legacyIdentityFile = path.join(dataRoot, 'identity.json')
  const identity = readIdentity(legacyIdentityFile)
  if (!identity) return false
  const targetDir = userDataDir(dataRoot, publicKeyHexFromIdentity(identity))
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
    if (entry.name === path.basename(targetDir)) continue
    // Nunca move pastas de outros usuários locais.
    if (entry.isDirectory() && /^[0-9a-f]{64}$/i.test(entry.name)) continue
    fs.renameSync(path.join(dataRoot, entry.name), path.join(targetDir, entry.name))
  }
  // O layout legado só existia para usuários ESTABELECIDOS (o app antigo não
  // tinha importação pendente). Com corestore local, marca como recuperado.
  if (fs.existsSync(path.join(targetDir, 'corestore'))) {
    writeRecoveredMarker(targetDir)
  }
  return true
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

/**
 * Um usuário é "estabelecido" quando pode iniciar com os dados locais, sem
 * precisar de recuperação pela rede: tem o marcador recovered.json OU um
 * corestore local íntegro.
 *
 * Importações pendentes/canceladas NUNCA criam a pasta `corestore` (durante a
 * recuperação o storage fica em `corestore.recovery`, removido ao cancelar).
 * Portanto, a presença do `corestore` é sinal confiável de dados estabelecidos
 * — mesmo que o marcador tenha se perdido (ex.: conflito de sync/OneDrive).
 */
function isEstablished(dataDir) {
  return isRecovered(dataDir) || fs.existsSync(path.join(dataDir, 'corestore'))
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
  migrateLegacyData,
  recoveredMarkerFile,
  isRecovered,
  writeRecoveredMarker,
  isEstablished,
  listUserKeys,
  parseUserKeyArg
}
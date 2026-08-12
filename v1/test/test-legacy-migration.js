'use strict'

// Testa a migração do layout legado (identity.json + corestore na raiz do
// dataRoot) para a pasta por-chave. Verifica duas regras críticas:
//
//  1. O usuário legado migrado com corestore local recebe o marcador
//     `recovered.json` — sem ele o app entraria em "recuperação" eterna
//     ("buscando seeders na rede", "peers na rede: 0") ignorando os dados locais.
//  2. A migração NUNCA move pastas de outros usuários locais (pastas hex de 64)
//     — senão os demais usuários "sumiriam" da listagem do start-all.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  migrateLegacyData,
  isRecovered,
  isEstablished,
  listUserKeys
} = require('../src/user-data')

function tmpRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

function makeLegacyIdentity(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const identity = {
    publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAf8jOfQt+/Y29u2mB4bvZ0sKRlpjjovoJQdkrrVJWhTg=\n-----END PUBLIC KEY-----\n',
    privateKey: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEILqN9Wbbp7UOpKIzbUJpgwhZHma0bt9f4KxQatXxnIRf\n-----END PRIVATE KEY-----\n',
    coreKey: 'a9885418b1c62a495f50e3a03ef7fb5ccf72339f1471d8894eecad218c0cff5f'
  }
  fs.writeFileSync(path.join(dir, 'identity.json'), JSON.stringify(identity, null, 2))
}

;(async () => {
  const results = {}

  // ---- Caso A: legado com corestore local + outro usuário por-chave na raiz
  const rootA = tmpRoot('legacy-migrate-A')
  makeLegacyIdentity(rootA)
  fs.mkdirSync(path.join(rootA, 'corestore'), { recursive: true })
  fs.writeFileSync(path.join(rootA, 'corestore', 'CORESTORE'), 'x')
  // Outro usuário local (pasta hex de 64) que NÃO pode ser movido.
  const otherKey = 'bf4470ee990388235613535d7ca97967d0b77e0b27a60681bcafc7f2083aa4d7'
  fs.mkdirSync(path.join(rootA, otherKey), { recursive: true })
  fs.writeFileSync(path.join(rootA, otherKey, 'identity.json'), '{}')

  const migratedA = migrateLegacyData(rootA)
  const targetA = path.join(rootA, 'a9885418b1c62a495f50e3a03ef7fb5ccf72339f1471d8894eecad218c0cff5f')

  results.A_migrated = migratedA === true
  results.A_identityMoved = fs.existsSync(path.join(targetA, 'identity.json'))
  results.A_corestoreMoved = fs.existsSync(path.join(targetA, 'corestore', 'CORESTORE'))
  results.A_markerWritten = isRecovered(targetA)
  results.A_established = isEstablished(targetA)
  results.A_otherUserKept = fs.existsSync(path.join(rootA, otherKey, 'identity.json'))
  results.A_otherUserNotInside = !fs.existsSync(path.join(targetA, otherKey))
  results.A_rootClean = !fs.existsSync(path.join(rootA, 'identity.json'))
  results.A_listedKeys = listUserKeys(rootA).sort().join(',')

  // ---- Caso B: legado SEM corestore (importação pendente) → NÃO marca
  const rootB = tmpRoot('legacy-migrate-B')
  makeLegacyIdentity(rootB)
  const migratedB = migrateLegacyData(rootB)
  const targetB = path.join(rootB, 'a9885418b1c62a495f50e3a03ef7fb5ccf72339f1471d8894eecad218c0cff5f')
  results.B_migrated = migratedB === true
  results.B_noMarker = !isRecovered(targetB)
  results.B_notEstablished = !isEstablished(targetB)

  // ---- Caso C: raiz sem identity.json → nada a migrar
  const rootC = tmpRoot('legacy-migrate-C')
  fs.mkdirSync(path.join(rootC, 'deadbeef'), { recursive: true })
  results.C_noop = migrateLegacyData(rootC) === false

  console.log('A) legado com corestore migrou:', results.A_migrated)
  console.log('A) identity.json movido:', results.A_identityMoved)
  console.log('A) corestore movido:', results.A_corestoreMoved)
  console.log('A) recovered.json gravado:', results.A_markerWritten)
  console.log('A) isEstablished:', results.A_established)
  console.log('A) outro usuário preservado na raiz:', results.A_otherUserKept)
  console.log('A) outro usuário NÃO movido para dentro:', results.A_otherUserNotInside)
  console.log('A) raiz limpa:', results.A_rootClean)
  console.log('A) chaves listadas:', results.A_listedKeys)
  console.log('B) legado sem corestore migrou:', results.B_migrated)
  console.log('B) sem marcador:', results.B_noMarker)
  console.log('B) não estabelecido:', results.B_notEstablished)
  console.log('C) sem identity.json, noop:', results.C_noop)

  const ok = results.A_migrated &&
    results.A_identityMoved && results.A_corestoreMoved && results.A_markerWritten &&
    results.A_established &&
    results.A_otherUserKept && results.A_otherUserNotInside && results.A_rootClean &&
    results.A_listedKeys === 'a9885418b1c62a495f50e3a03ef7fb5ccf72339f1471d8894eecad218c0cff5f,bf4470ee990388235613535d7ca97967d0b77e0b27a60681bcafc7f2083aa4d7' &&
    results.B_migrated && results.B_noMarker && results.B_notEstablished &&
    results.C_noop

  console.log('\nRESULTADO:', ok ? 'PASSOU' : 'FALHOU')
  process.exit(ok ? 0 : 1)
})().catch((err) => {
  console.error('ERRO NO TESTE:', err)
  process.exit(1)
})

'use strict'

// ====================================================================
// Identidade: reaproveita EXATAMENTE a mesma estratégia do protótipo
// original (app-p2p.js) para gerar/carregar o par de chaves Ed25519
// via node:crypto, e adiciona a conversão para o formato usado pelo
// Hypercore ({ publicKey: 32 bytes, secretKey: 64 bytes }).
//
// Por quê reaproveitar a mesma chave? Porque a identidade "de verdade"
// do usuário é o par de chaves Ed25519 em si (é ele que assina tudo).
// O formato do endereço público que você compartilha com os amigos
// muda (ver README/NOTAS-OPCAO-B.md), mas a chave privada continua
// sendo a mesma — nenhum usuário perde ou precisa recriar sua
// identidade criptográfica por causa dessa migração.
// ====================================================================

const fs = require('node:fs')
const path = require('node:path')
const nodeCrypto = require('node:crypto')

function rawPublicKeyBytes(publicKeyObject) {
  // Node não expõe format:'buffer' para chaves Ed25519 — exportamos
  // como JWK (RFC 8037) e decodificamos o campo "x" (base64url).
  const jwk = publicKeyObject.export({ format: 'jwk' })
  return Buffer.from(jwk.x, 'base64url')
}

function rawSeedBytes(privateKeyObject) {
  const jwk = privateKeyObject.export({ format: 'jwk' })
  return Buffer.from(jwk.d, 'base64url')
}

/**
 * Converte um par de chaves node:crypto (PEM, Ed25519) no formato usado
 * pelas libs do ecossistema Hypercore (libsodium): secretKey = seed(32) + publicKey(32).
 */
function toHypercoreKeyPair(publicKeyObject, privateKeyObject) {
  const publicKey = rawPublicKeyBytes(publicKeyObject)
  const seed = rawSeedBytes(privateKeyObject)
  const secretKey = Buffer.concat([seed, publicKey])
  return { publicKey, secretKey }
}

/**
 * Carrega a identidade do disco ou gera uma nova na primeira execução.
 * Mantém o mesmo formato de arquivo (identity.json com PEM) do protótipo
 * original, então uma identity.json já existente continua funcionando.
 */
function loadOrCreateIdentity(identityFile) {
  let pem

  if (fs.existsSync(identityFile)) {
    pem = JSON.parse(fs.readFileSync(identityFile, 'utf8'))
  } else {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519')
    pem = {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
    }
    fs.mkdirSync(path.dirname(identityFile), { recursive: true })
    fs.writeFileSync(identityFile, JSON.stringify(pem, null, 2))
  }

  const publicKeyObject = nodeCrypto.createPublicKey(pem.publicKey)
  const privateKeyObject = nodeCrypto.createPrivateKey(pem.privateKey)
  const keyPair = toHypercoreKeyPair(publicKeyObject, privateKeyObject)

  return {
    keyPair,               // { publicKey, secretKey } — usar para abrir o core próprio no Corestore
    coreKey: typeof pem.coreKey === 'string' ? pem.coreKey : null,
    publicKeyObject,       // KeyObject node:crypto, caso precise assinar algo fora do Hypercore
    privateKeyObject
  }
}

function saveCoreKey(identityFile, coreKey) {
  const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'))
  identity.coreKey = Buffer.from(coreKey).toString('hex')
  fs.writeFileSync(identityFile, JSON.stringify(identity, null, 2))
}

module.exports = { loadOrCreateIdentity, saveCoreKey, toHypercoreKeyPair }

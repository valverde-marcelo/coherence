'use strict'
const fs = require('fs')
const nacl = require('tweetnacl')
const paths = require('./paths')

/**
 * Identidade do usuário = par de chaves ed25519.
 * Não há cadastro, username ou servidor: a chave pública (hex) É o identificador
 * único e portátil do usuário em toda a rede.
 *
 * A chave secreta é persistida em disco protegida pelo `safeStorage` do Electron
 * (DPAPI no Windows / Keychain no macOS / libsecret no Linux) quando disponível.
 * Se a criptografia do SO não estiver disponível, cai para um arquivo local simples
 * (ainda restrito ao usuário do SO pelas permissões do diretório userData).
 */
class Identity {
  constructor (publicKey, secretKey) {
    this.publicKey = publicKey // Buffer 32 bytes
    this.secretKey = secretKey // Buffer 64 bytes
  }

  get publicKeyHex () {
    return this.publicKey.toString('hex')
  }

  sign (messageBuf) {
    return Buffer.from(nacl.sign.detached(messageBuf, this.secretKey))
  }

  static verify (messageBuf, sigBuf, publicKeyBuf) {
    try {
      return nacl.sign.detached.verify(messageBuf, sigBuf, publicKeyBuf)
    } catch {
      return false
    }
  }
}

function loadOrCreateIdentity (safeStorage) {
  paths.ensureAllDirs()
  const idFile = paths.identityFile()
  const keyFile = paths.identityKeyFile()

  if (fs.existsSync(idFile) && fs.existsSync(keyFile)) {
    const meta = JSON.parse(fs.readFileSync(idFile, 'utf8'))
    const rawStored = fs.readFileSync(keyFile)
    let secretKey
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      secretKey = Buffer.from(safeStorage.decryptString(rawStored), 'hex')
    } else {
      secretKey = Buffer.from(rawStored.toString('utf8'), 'hex')
    }
    const publicKey = Buffer.from(meta.publicKeyHex, 'hex')
    return new Identity(publicKey, secretKey)
  }

  // Gera nova identidade
  const kp = nacl.sign.keyPair()
  const publicKey = Buffer.from(kp.publicKey)
  const secretKey = Buffer.from(kp.secretKey)

  fs.writeFileSync(idFile, JSON.stringify({ publicKeyHex: publicKey.toString('hex'), createdAt: Date.now() }, null, 2))

  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(keyFile, safeStorage.encryptString(secretKey.toString('hex')))
  } else {
    fs.writeFileSync(keyFile, secretKey.toString('hex'), 'utf8')
  }

  return new Identity(publicKey, secretKey)
}

module.exports = { Identity, loadOrCreateIdentity }

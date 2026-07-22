'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const archiver = require('archiver')
const { extractZip } = require('extract-zip')
const paths = require('./paths')
const hashchain = require('./hashchain')
const { Identity } = require('./identity')

const BACKUP_VERSION = '1.0'

/**
 * Exporta backup criptografado (ZIP) com identidade + dados completos da conta.
 * @param {App} app - instância do App
 * @param {string?} password - senha opcional para criptografia AES-256-GCM
 * @returns {Promise<Buffer>} ZIP criptografado
 */
async function exportBackup (app, password = null) {
  const tempDir = path.join(paths.root(), '.backup-tmp')
  const backupDir = path.join(tempDir, 'backup-data')
  fs.mkdirSync(backupDir, { recursive: true })

  try {
    // 1. Copia arquivos de identidade
    const identityJsonPath = paths.identityFile()
    const identityKeyPath = paths.identityKeyFile()
    const dbJsonPath = paths.dbFile()

    const identityMeta = JSON.parse(fs.readFileSync(identityJsonPath, 'utf8'))

    // Descriptografa chave privada do OS (safeStorage)
    let secretKeyHex
    if (app.safeStorage && app.safeStorage.isEncryptionAvailable()) {
      const encryptedKeyBuf = fs.readFileSync(identityKeyPath)
      // safeStorage.decryptString() expects a Buffer
      try {
        secretKeyHex = app.safeStorage.decryptString(encryptedKeyBuf)
      } catch (err) {
        throw new Error(`Falha ao descriptografar chave privada: ${err.message}`)
      }
    } else {
      secretKeyHex = fs.readFileSync(identityKeyPath, 'utf8').trim()
    }

    // 2. Coleta dados do banco (exclui feedCache)
    const db = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'))
    const dbBackup = {
      ownChain: db.ownChain || [],
      follows: db.follows || [],
      profile: db.profile || {},
      knownUsers: db.knownUsers || [],
      settings: db.settings || {}
    }

    // 3. Coleta metadados dos capítulos sealed
    const chaptersIndex = paths.chaptersOwnIndex()
    let chaptersIndexData = { chapters: [] }
    if (fs.existsSync(chaptersIndex)) {
      chaptersIndexData = JSON.parse(fs.readFileSync(chaptersIndex, 'utf8'))
    }

    // 4. Cria manifest assinado
    const manifest = {
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      publicKeyHex: identityMeta.publicKeyHex,
      createdAt: identityMeta.createdAt,
      hasPassword: !!password,
      checksums: {
        identity: crypto.createHash('sha256').update(secretKeyHex).digest('hex'),
        db: crypto.createHash('sha256').update(JSON.stringify(dbBackup)).digest('hex'),
        chaptersIndex: crypto.createHash('sha256').update(JSON.stringify(chaptersIndexData)).digest('hex')
      }
    }

    // Assina manifest com chave privada
    const manifestStr = JSON.stringify(manifest)
    const manifestHash = crypto.createHash('sha256').update(manifestStr).digest('hex')
    const secretKeyBuf = Buffer.from(secretKeyHex, 'hex')
    const identity = app.identity
    const manifestSig = identity.sign(Buffer.from(manifestHash, 'hex')).toString('hex')
    manifest.sig = manifestSig

    // 5. Salva arquivos temporários
    fs.writeFileSync(path.join(backupDir, 'identity.json'), JSON.stringify({ ...identityMeta }, null, 2))
    fs.writeFileSync(path.join(backupDir, 'identity.key'), secretKeyHex, 'utf8')
    fs.writeFileSync(path.join(backupDir, 'db.json'), JSON.stringify(dbBackup, null, 2))
    fs.writeFileSync(path.join(backupDir, 'chapters-index.json'), JSON.stringify(chaptersIndexData, null, 2))
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    // 6. Copia capítulos sealed (estrutura apenas)
    const chaptersSealed = paths.chaptersOwnSealed()
    if (fs.existsSync(chaptersSealed)) {
      const chaptersDest = path.join(backupDir, 'chapters', 'sealed')
      fs.mkdirSync(chaptersDest, { recursive: true })
      const chapters = fs.readdirSync(chaptersSealed)
      for (const chapter of chapters) {
        const chapterPath = path.join(chaptersSealed, chapter)
        const chapterJsonFile = path.join(chapterPath, 'chapter.json')
        if (fs.existsSync(chapterJsonFile)) {
          fs.mkdirSync(path.join(chaptersDest, chapter), { recursive: true })
          fs.copyFileSync(chapterJsonFile, path.join(chaptersDest, chapter, 'chapter.json'))
        }
      }
    }

    // 7. Cria ZIP
    const zipBuffer = await createZip(backupDir)

    // 8. Se senha, criptografa ZIP com AES-256-GCM
    let finalBuffer = zipBuffer
    if (password) {
      finalBuffer = encryptBufferAES256(zipBuffer, password)
    }

    return finalBuffer
  } finally {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * Importa backup, validando integridade e restaurando conta.
 * @param {App} app
 * @param {Buffer} zipBuffer - conteúdo do ZIP (possivelmente criptografado)
 * @param {string?} password - senha se backup era criptografado
 * @returns {Promise<{ok: boolean, reason?: string, imported?: object}>}
 */
async function importBackup (app, zipBuffer, password = null) {
  const tempDir = path.join(paths.root(), '.restore-tmp')
  const extractDir = path.join(tempDir, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })

  try {
    let dataBuffer = zipBuffer

    // 1. Descriptografa se necessário
    if (password) {
      const decrypted = decryptBufferAES256(dataBuffer, password)
      if (!decrypted) {
        return { ok: false, reason: 'Senha incorreta ou backup corrompido' }
      }
      dataBuffer = decrypted
    }

    // 2. Extrai ZIP
    await extractZip(dataBuffer, { dir: extractDir })

    // 3. Carrega arquivos
    const manifestPath = path.join(extractDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, reason: 'Backup inválido: manifest.json não encontrado' }
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    // Valida versão
    if (manifest.version !== BACKUP_VERSION) {
      return { ok: false, reason: `Versão incompatível: esperado ${BACKUP_VERSION}, recebido ${manifest.version}` }
    }

    // 4. Carrega dados
    const identityMeta = JSON.parse(fs.readFileSync(path.join(extractDir, 'identity.json'), 'utf8'))
    const secretKeyHex = fs.readFileSync(path.join(extractDir, 'identity.key'), 'utf8').trim()
    const dbBackup = JSON.parse(fs.readFileSync(path.join(extractDir, 'db.json'), 'utf8'))
    const chaptersIndexData = JSON.parse(fs.readFileSync(path.join(extractDir, 'chapters-index.json'), 'utf8'))

    // 5. Valida checksums
    const checksums = {
      identity: crypto.createHash('sha256').update(secretKeyHex).digest('hex'),
      db: crypto.createHash('sha256').update(JSON.stringify(dbBackup)).digest('hex'),
      chaptersIndex: crypto.createHash('sha256').update(JSON.stringify(chaptersIndexData)).digest('hex')
    }

    for (const key of Object.keys(checksums)) {
      if (checksums[key] !== manifest.checksums[key]) {
        return { ok: false, reason: `Checksum falhou: ${key} corrompido` }
      }
    }

    // 6. Valida assinatura do manifest
    const manifestWithoutSig = { ...manifest }
    delete manifestWithoutSig.sig
    const manifestStr = JSON.stringify(manifestWithoutSig)
    const manifestHash = crypto.createHash('sha256').update(manifestStr).digest('hex')
    const isValidSig = Identity.verify(
      Buffer.from(manifestHash, 'hex'),
      Buffer.from(manifest.sig, 'hex'),
      Buffer.from(identityMeta.publicKeyHex, 'hex')
    )
    if (!isValidSig) {
      return { ok: false, reason: 'Assinatura do backup inválida' }
    }

    // 7. Valida chain pessoal (verifySequence)
    if (dbBackup.ownChain && dbBackup.ownChain.length > 0) {
      const verifyResult = hashchain.verifySequence(
        dbBackup.ownChain,
        (msg, sig, pubkey) => hashchain.Identity.verify(msg, sig, pubkey),
        null
      )
      if (!verifyResult.ok) {
        return { ok: false, reason: `Chain inválida: ${verifyResult.reason}` }
      }
    }

    // 8. Restaura para disco (atomicamente com .backup)
    const idFile = paths.identityFile()
    const idKeyFile = paths.identityKeyFile()
    const dbFile = paths.dbFile()
    const chaptIndexFile = paths.chaptersOwnIndex()

    // Backup de arquivos existentes
    if (fs.existsSync(idFile)) fs.copyFileSync(idFile, idFile + '.backup')
    if (fs.existsSync(idKeyFile)) fs.copyFileSync(idKeyFile, idKeyFile + '.backup')
    if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, dbFile + '.backup')

    try {
      // Escreve identidade
      fs.writeFileSync(idFile, JSON.stringify(identityMeta, null, 2))

      // Re-criptografa chave privada com safeStorage do dispositivo destino
      if (app.safeStorage && app.safeStorage.isEncryptionAvailable()) {
        const encrypted = app.safeStorage.encryptString(secretKeyHex)
        fs.writeFileSync(idKeyFile, encrypted)
      } else {
        fs.writeFileSync(idKeyFile, secretKeyHex, 'utf8')
      }

      // Escreve dados (merge com defaults)
      const currentDb = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
      const mergedDb = {
        ...currentDb,
        ownChain: dbBackup.ownChain,
        follows: dbBackup.follows,
        profile: dbBackup.profile,
        knownUsers: dbBackup.knownUsers,
        settings: { ...currentDb.settings, ...dbBackup.settings }
      }
      fs.writeFileSync(dbFile, JSON.stringify(mergedDb, null, 2))

      // Escreve chapters index
      fs.writeFileSync(chaptIndexFile, JSON.stringify(chaptersIndexData, null, 2))

      // Restaura capítulos sealed
      const chaptersSealed = paths.chaptersOwnSealed()
      const extractedChapters = path.join(extractDir, 'chapters', 'sealed')
      if (fs.existsSync(extractedChapters)) {
        const chapters = fs.readdirSync(extractedChapters)
        for (const chapter of chapters) {
          const src = path.join(extractedChapters, chapter, 'chapter.json')
          const dest = path.join(chaptersSealed, chapter)
          if (fs.existsSync(src)) {
            fs.mkdirSync(dest, { recursive: true })
            fs.copyFileSync(src, path.join(dest, 'chapter.json'))
          }
        }
      }
    } catch (err) {
      // Rollback
      if (fs.existsSync(idFile + '.backup')) fs.copyFileSync(idFile + '.backup', idFile)
      if (fs.existsSync(idKeyFile + '.backup')) fs.copyFileSync(idKeyFile + '.backup', idKeyFile)
      if (fs.existsSync(dbFile + '.backup')) fs.copyFileSync(dbFile + '.backup', dbFile)
      return { ok: false, reason: `Erro ao restaurar: ${err.message}` }
    }

    // Cleanup backups
    fs.rmSync(idFile + '.backup', { force: true })
    fs.rmSync(idKeyFile + '.backup', { force: true })
    fs.rmSync(dbFile + '.backup', { force: true })

    return {
      ok: true,
      imported: {
        publicKeyHex: identityMeta.publicKeyHex,
        postsCount: dbBackup.ownChain.length,
        followsCount: dbBackup.follows.length,
        exportedAt: manifest.exportedAt
      }
    }
  } catch (err) {
    return { ok: false, reason: `Erro ao processar backup: ${err.message}` }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * Cria arquivo ZIP em memória
 */
function createZip (sourceDir) {
  return new Promise((resolve, reject) => {
    const buffers = []
    const archive = archiver('zip', { zlib: { level: 9 } })

    archive.on('data', chunk => buffers.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(buffers)))
    archive.on('error', reject)

    archive.directory(sourceDir, false)
    archive.finalize()
  })
}

/**
 * Criptografa buffer com AES-256-GCM
 * Formato: [12 bytes salt][16 bytes auth tag][N bytes ciphertext]
 */
function encryptBufferAES256 (buffer, password) {
  const salt = crypto.randomBytes(12)
  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  const encrypted = Buffer.concat([
    cipher.update(buffer),
    cipher.final()
  ])

  const authTag = cipher.getAuthTag()

  // Formato: salt (12) | iv (16) | authTag (16) | encrypted
  return Buffer.concat([salt, iv, authTag, encrypted])
}

/**
 * Descriptografa buffer criptografado com AES-256-GCM
 */
function decryptBufferAES256 (encryptedBuffer, password) {
  try {
    const salt = encryptedBuffer.slice(0, 12)
    const iv = encryptedBuffer.slice(12, 28)
    const authTag = encryptedBuffer.slice(28, 44)
    const ciphertext = encryptedBuffer.slice(44)

    const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ])

    return decrypted
  } catch (err) {
    return null
  }
}

module.exports = { exportBackup, importBackup }

'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const paths = require('./paths')

// Agrupa posts em "capítulos" para concentrar o swarm (menos torrents, mais
// seeders por torrent = distribuição mais rápida) em vez de 1 torrent por post.
const MAX_POSTS_PER_CHAPTER = 10
const SEAL_DEBOUNCE_MS = 15000 // um post isolado sai em ~15s; posts em sequência viram 1 capítulo só

class ChapterManager {
  constructor (torrentClient, identity, onSealed) {
    this.torrentClient = torrentClient
    this.identity = identity
    this.onSealed = onSealed // callback async (chapterMeta) => void, usado para publicar no DHT
    this._sealTimer = null
  }

  _openManifestPath () {
    return path.join(paths.chaptersOwnOpen(), 'manifest.json')
  }

  _readOpenManifest () {
    const p = this._openManifestPath()
    if (!fs.existsSync(p)) return { posts: [] }
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      return { posts: [] }
    }
  }

  _writeOpenManifest (manifest) {
    fs.writeFileSync(this._openManifestPath(), JSON.stringify(manifest, null, 2))
  }

  _readIndex () {
    const p = paths.chaptersOwnIndex()
    if (!fs.existsSync(p)) return []
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      return []
    }
  }

  _writeIndex (index) {
    fs.writeFileSync(paths.chaptersOwnIndex(), JSON.stringify(index, null, 2))
  }

  /**
   * Copia um arquivo de mídia para a pasta do capítulo aberto e retorna sua
   * referência (sha256, nome, mime, tamanho) para ser anexada ao post.
   */
  attachMedia (sourcePath, mime) {
    const buf = fs.readFileSync(sourcePath)
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    const ext = path.extname(sourcePath) || ''
    const destName = sha256 + ext
    const destDir = path.join(paths.chaptersOwnOpen(), 'media')
    fs.mkdirSync(destDir, { recursive: true })
    const destPath = path.join(destDir, destName)
    if (!fs.existsSync(destPath)) fs.writeFileSync(destPath, buf)
    return { sha256, name: destName, mime: mime || 'application/octet-stream', size: buf.length }
  }

  /**
   * Adiciona um post (já assinado) ao capítulo aberto e agenda o "selamento"
   * (seal) com debounce: posts feitos em sequência rápida saem juntos em um
   * único torrent; um post isolado ainda assim sai rápido (poucos segundos).
   */
  addPost (post) {
    const manifest = this._readOpenManifest()
    manifest.posts.push(post)
    this._writeOpenManifest(manifest)

    if (manifest.posts.length >= MAX_POSTS_PER_CHAPTER) {
      this._triggerSeal()
    } else {
      clearTimeout(this._sealTimer)
      this._sealTimer = setTimeout(() => this._triggerSeal(), SEAL_DEBOUNCE_MS)
    }
  }

  async _triggerSeal () {
    clearTimeout(this._sealTimer)
    try {
      const meta = await this.seal()
      if (meta && this.onSealed) await this.onSealed(meta)
    } catch (err) {
      console.error('[chapters] erro ao selar capítulo:', err.message)
    }
  }

  /**
   * Sela o capítulo aberto (se houver posts pendentes): grava chapter.json
   * assinado, move a pasta para sealed/<start>-<end>, e inicia o seeding via
   * WebTorrent. Retorna os metadados do capítulo ou null se não havia posts.
   */
  async seal () {
    const manifest = this._readOpenManifest()
    if (!manifest.posts.length) return null

    const posts = manifest.posts
    const start = posts[0].seq
    const end = posts[posts.length - 1].seq
    const chapterHash = crypto.createHash('sha256').update(JSON.stringify(posts)).digest('hex')
    const sig = this.identity.sign(Buffer.from(chapterHash, 'hex')).toString('hex')

    const index = this._readIndex()
    const prevInfohash = index.length ? index[index.length - 1].infohash : ''

    const chapterFile = {
      start,
      end,
      posts,
      pubkeyHex: this.identity.publicKeyHex,
      chapterHash,
      sig,
      prevInfohash,
      sealedAt: Date.now()
    }
    fs.writeFileSync(path.join(paths.chaptersOwnOpen(), 'chapter.json'), JSON.stringify(chapterFile, null, 2))

    const openDir = paths.chaptersOwnOpen()
    const sealedDir = path.join(paths.chaptersOwnSealed(), `${start}-${end}`)
    fs.renameSync(openDir, sealedDir)

    // recria a pasta "open" vazia para os próximos posts
    fs.mkdirSync(openDir, { recursive: true })
    fs.mkdirSync(path.join(openDir, 'media'), { recursive: true })

    const { infohash } = await this.torrentClient.seedFolder(sealedDir)

    const entry = { start, end, infohash, chapterHash, sig, prevInfohash, sealedAt: chapterFile.sealedAt }
    index.push(entry)
    this._writeIndex(index)

    return entry
  }
}

module.exports = { ChapterManager, MAX_POSTS_PER_CHAPTER, SEAL_DEBOUNCE_MS }

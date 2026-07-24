'use strict'
const fs = require('fs')
const paths = require('./paths')

const DEFAULT_DB = {
  ownChain: [], // hash-chain pessoal: [{seq, ts, type, text, media:[], prevHash, hash, sig}]
  follows: [], // [{pubkeyHex, alias, remoteDisplayName, lastSeq, lastChainHash, lastInfohash, prevInfohash, addedAt, lastPolledAt}]
  feedCache: [], // posts ingeridos de follows: [{pubkeyHex, seq, ts, type, text, media, hash, sig}]
  profile: { displayName: '' }, // seu próprio nome de exibição, publicado junto do ponteiro DHT
  // Diretório local de usuários "conhecidos" via gossip FOAF (friend-of-a-friend):
  // ao sincronizar quem você segue, você também aprende quem ELES seguem, o que
  // permite uma "busca de usuários" sem nenhum servidor central de cadastro.
  knownUsers: [], // [{pubkeyHex, displayName, discoveredVia, lastSeen}]
  settings: {
    trackers: [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://tracker.openbittorrent.com:80/announce',
      'udp://open.stealth.si:80/announce',
      'udp://exodus.desync.com:6969/announce',
      'wss://tracker.btorrent.xyz',
      'wss://tracker.openwebtorrent.com'
    ],
    autoBackupEnabled: false,
    autoBackupInterval: 'weekly', // 'daily', 'weekly', 'monthly'
    lastAutoBackupAt: null
  }
}

/**
 * Armazenamento local simples em JSON (db.json) com fila de escrita serializada
 * para evitar corrupção por escritas concorrentes.
 */
class Store {
  constructor () {
    this.file = paths.dbFile()
    this.data = this._load()
    this._writeQueue = Promise.resolve()
  }

  _load () {
    paths.ensureAllDirs()
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify(DEFAULT_DB, null, 2))
      return JSON.parse(JSON.stringify(DEFAULT_DB))
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return { ...JSON.parse(JSON.stringify(DEFAULT_DB)), ...raw, settings: { ...DEFAULT_DB.settings, ...(raw.settings || {}) } }
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_DB))
    }
  }

  // Persiste o estado atual em disco, serializando escritas concorrentes.
  // Com retry para EPERM (múltiplas instâncias podem escrever simultaneamente).
  save () {
    this._writeQueue = this._writeQueue.then(() => this._saveWithRetry())
    return this._writeQueue
  }

  _saveWithRetry (attempt = 1, maxAttempts = 5) {
    return new Promise((resolve, reject) => {
      const tmp = this.file + '.tmp'
      fs.writeFile(tmp, JSON.stringify(this.data, null, 2), err => {
        if (err) return reject(err)
        
        fs.rename(tmp, this.file, err2 => {
          if (!err2) return resolve()
          
          // Se EPERM (concorrência com outra instância), retry com backoff
          if (err2.code === 'EPERM' && attempt < maxAttempts) {
            const backoffMs = Math.min(500, attempt * 100)
            setTimeout(() => {
              this._saveWithRetry(attempt + 1, maxAttempts)
                .then(resolve)
                .catch(reject)
            }, backoffMs)
            return
          }
          
          // Limpar tmp se rename falhar
          try { fs.unlinkSync(tmp) } catch {}
          reject(err2)
        })
      })
    })
  }
}

module.exports = { Store }

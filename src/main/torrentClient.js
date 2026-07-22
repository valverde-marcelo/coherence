'use strict'
const path = require('path')
const fs = require('fs')

/**
 * Wrapper do cliente WebTorrent com foco em VELOCIDADE de distribuição:
 *
 *  - Reseeding automático: nunca destruímos um torrent após o download —
 *    todo peer que baixa um "capítulo" passa a ajudar a distribuí-lo (efeito
 *    de rede: quanto mais gente vê um post, mais rápido ele se espalha).
 *  - Múltiplos trackers (UDP/WSS) + DHT + PEX + LSD (descoberta de peers na
 *    rede local) simultaneamente, para maximizar as fontes de peers.
 *  - Swarms concentrados: cada torrent agrupa vários posts ("capítulo") em
 *    vez de 1 torrent por post — menos swarms fragmentados, mais seeders por
 *    swarm, convergência mais rápida.
 *  - Priorização de peças: mídia (imagens) tem as primeiras peças marcadas
 *    como "críticas" para exibir uma prévia o quanto antes.
 *
 * O módulo webtorrent é ESM puro; usamos import() dinâmico a partir do nosso
 * código CommonJS.
 */
class TorrentClient {
  constructor () {
    this.client = null
    this.seededTorrents = new Map() // infohash -> torrent (nunca destruídos = auto-reseed)
  }

  async init ({ dhtOpts, trackers }) {
    const { default: WebTorrent } = await import('webtorrent')
    this.trackers = trackers || []
    this.client = new WebTorrent({
      dht: dhtOpts,
      lsd: true, // Local Service Discovery: acha peers na mesma rede local instantaneamente
      utPex: true, // Peer Exchange: peers compartilham peers entre si, reduz dependência só do tracker/DHT
      maxConns: 100
    })
    this.client.on('error', err => console.error('[torrent] erro do cliente:', err.message))
    return this.client
  }

  get dht () {
    return this.client && this.client.dht
  }

  /**
   * Cria e semeia (seed) um torrent a partir de uma pasta local (ex: um capítulo
   * selado). Retorna { infohash, torrent }. O torrent nunca é destruído
   * automaticamente — permanece semeando enquanto o app estiver aberto.
   */
  seedFolder (folderPath) {
    return new Promise((resolve) => {
      this.client.seed(folderPath, { announce: this.trackers }, torrent => {
        this.seededTorrents.set(torrent.infoHash, torrent)
        resolve({ infohash: torrent.infoHash, torrent })
      })
    })
  }

  /**
   * Baixa um capítulo pelo infohash e passa a semeá-lo permanentemente
   * (reseed automático) assim que concluído. `destDir` é onde os arquivos
   * ficarão gravados em disco.
   */
  downloadChapter (infohash, destDir, { onProgress, prioritizeMedia = true } = {}) {
    fs.mkdirSync(destDir, { recursive: true })
    return new Promise((resolve, reject) => {
      const existing = this.client.torrents.find(t => t.infoHash === infohash.toLowerCase())
      if (existing) {
        resolve(existing)
        return
      }
      const torrent = this.client.add(infohash, {
        path: destDir,
        announce: this.trackers
      }, torrent => {
        this.seededTorrents.set(torrent.infoHash, torrent) // ao terminar continuará semeando (reseed)
      })

      if (prioritizeMedia) {
        torrent.on('ready', () => {
          // Prioriza as primeiras peças de cada arquivo de mídia para exibir
          // uma prévia rapidamente, mesmo antes do torrent terminar 100%.
          for (const file of torrent.files) {
            file.select()
          }
          const previewPieces = Math.min(4, torrent.pieces ? torrent.pieces.length : 0)
          if (previewPieces > 0) torrent.critical(0, previewPieces - 1)
        })
      }

      if (onProgress) torrent.on('download', () => onProgress(torrent.progress))

      torrent.on('done', () => resolve(torrent))
      torrent.on('error', reject)

      // timeout para não travar a fila de descoberta caso não existam seeders
      const timeout = setTimeout(() => {
        reject(new Error(`timeout ao baixar capítulo ${infohash}`))
      }, 120000)
      torrent.on('done', () => clearTimeout(timeout))
    })
  }

  stats () {
    if (!this.client) return { peers: 0, downloadSpeed: 0, uploadSpeed: 0, torrents: 0 }
    return {
      peers: this.client.torrents.reduce((n, t) => n + t.numPeers, 0),
      downloadSpeed: this.client.downloadSpeed,
      uploadSpeed: this.client.uploadSpeed,
      torrents: this.client.torrents.length
    }
  }

  destroy () {
    return new Promise(resolve => {
      if (!this.client) return resolve()
      this.client.destroy(() => resolve())
    })
  }
}

module.exports = { TorrentClient }

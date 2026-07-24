'use strict'
const path = require('path')
const { loadOrCreateIdentity } = require('./identity')
const { Store } = require('./store')
const { TorrentClient } = require('./torrentClient')
const { ChapterManager } = require('./chapters')
const dhtLib = require('./dht')
const discovery = require('./discovery')
const hashchain = require('./hashchain')
const { PollScheduler } = require('./scheduler')
const feed = require('./feed')

const DHT_REPUBLISH_MS = 50 * 60 * 1000 // BEP44: nós podem descartar valores com +2h sem republicar

/**
 * Orquestra todos os módulos da rede social distribuída:
 * identidade -> hash-chain -> capítulos (torrents) -> DHT (descoberta) -> feed
 */
class App {
  constructor (safeStorage) {
    this.safeStorage = safeStorage
    this.identity = loadOrCreateIdentity(safeStorage)
    this.store = new Store()
    this.torrentClient = new TorrentClient()
    this.chapters = new ChapterManager(this.torrentClient, this.identity, meta => this._onChapterSealed(meta))
    this.scheduler = new PollScheduler(() => this._pollAllFollows())
    this._dhtIsOnline = true // flag para rastrear se DHT está disponível
  }

  async init () {
    await this.torrentClient.init({
      dhtOpts: dhtLib.makeDhtOpts(),
      trackers: this.store.data.settings.trackers
    })

    // Recupera e sela automaticamente capítulos pendentes do app anterior
    await this.chapters.recoverPendingChapter()

    // Aguarda o DHT descobrir pelo menos alguns nós antes de publicar
    await this._waitDhtReady()

    // Agora sim, publica e configura republish periódico
    await this._publishPointer()
    this._republishTimer = setInterval(() => this._publishPointer(), DHT_REPUBLISH_MS)
    this.scheduler.start()
  }

  async _waitDhtReady (timeoutMs = 30000) {
    const dht = this.torrentClient.dht
    if (!dht) throw new Error('DHT não inicializado')

    const start = Date.now()
    return new Promise((resolve) => {
      let resolved = false
      let peerCount = 0

      // Listener para evento de peer descoberto (mais confiável que dht.nodes.size)
      const onPeer = () => {
        peerCount++
        const elapsedMs = Date.now() - start
        console.log(`[app] DHT peer descoberto #${peerCount} (${elapsedMs}ms)`, { nodesSize: dht._nodes ? dht._nodes.length : 0 })
        
        // Aguardar mínimo de 3 peers para considerado "pronto"
        if (peerCount >= 3 && !resolved) {
          resolved = true
          dht.removeListener('peer', onPeer)
          clearTimeout(timeoutId)
          console.log('[app] DHT pronto: 3+ peers descobertos em', elapsedMs, 'ms')
          this._dhtIsOnline = true
          resolve()
        }
      }

      // Fallback: se ainda não houve 3 peers após timeout, continua mesmo assim
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true
          dht.removeListener('peer', onPeer)
          const elapsedMs = Date.now() - start
          if (peerCount === 0) {
            console.warn(`[app] ⚠️  DHT ISOLADO: nenhum peer descoberto após ${elapsedMs}ms. Possível: firewall UDP bloqueado ou rede restrita.`)
            console.warn(`[app] Operando em modo "local only": descoberta via LSD (rede local) apenas. DHT global indisponível.`)
            this._dhtIsOnline = false
          } else {
            console.warn(`[app] DHT bootstrap timeout após ${elapsedMs}ms com ${peerCount} peers. Continuando com bootstrap parcial.`)
            this._dhtIsOnline = true
          }
          resolve()
        }
      }, timeoutMs)

      dht.on('peer', onPeer)
    })
  }

  async _onChapterSealed () {
    await this._publishPointer()
  }

  async _publishPointer () {
    const startTime = Date.now()
    try {
      const result = await discovery.publishOwnPointer(this.torrentClient.dht, this.identity, this.store)
      const elapsedMs = Date.now() - startTime
      const pointer = discovery.buildOwnPointer(this.store)
      const pointerSize = pointer ? JSON.stringify(pointer).length : 0
      if (!this._dhtIsOnline) {
        console.warn('[app] ⚠️  Ponteiro não publicado no DHT (modo isolado): seeding local é possível via LSD')
      } else {
        console.log('[app] ponteiro publicado com sucesso no DHT', {
          elapsedMs,
          pointerSize,
          hasLatest: pointer && !!pointer.latest,
          followingCount: pointer ? pointer.following.length : 0,
          chainSeq: pointer ? pointer.chainSeq : null
        })
      }
    } catch (err) {
      const elapsedMs = Date.now() - startTime
      if (!this._dhtIsOnline) {
        console.warn('[app] ⚠️  Não há DHT disponível (modo isolado). Posts poderão ser descobertos via LSD se peers estiverem na mesma rede local.')
      } else {
        console.error('[app] falha ao publicar ponteiro no DHT após', elapsedMs, 'ms:', err.message)
      }
    }
  }

  async _pollAllFollows () {
    const startTime = Date.now()
    console.log(`[app] iniciando poll de ${this.store.data.follows.length} follows`)
    let successCount = 0
    for (const follow of this.store.data.follows) {
      try {
        const result = await discovery.pollFollow({ dht: this.torrentClient.dht, torrentClient: this.torrentClient, store: this.store }, follow)
        if (result.updated) {
          successCount++
          console.log(`[app] follow ${follow.pubkeyHex.slice(0, 8)} atualizado com posts`)
        } else if (result.error) {
          console.warn(`[app] erro ao consultar follow ${follow.pubkeyHex.slice(0, 8)}:`, result.error)
        } else {
          console.log(`[app] follow ${follow.pubkeyHex.slice(0, 8)} sem novidades`)
        }
      } catch (err) {
        console.error('[app] erro ao consultar follow', follow.pubkeyHex.slice(0, 8), err.message)
      }
    }
    const elapsedMs = Date.now() - startTime
    console.log(`[app] poll completo: ${successCount}/${this.store.data.follows.length} atualizados em ${elapsedMs}ms`)
    await this.store.save()
  }

  // ---- API usada pelo IPC ----

  getIdentity () {
    return { publicKeyHex: this.identity.publicKeyHex }
  }

  getProfile () {
    return { displayName: this.store.data.profile.displayName || '' }
  }

  async setDisplayName (displayName) {
    this.store.data.profile.displayName = (displayName || '').trim().slice(0, 40)
    await this.store.save()
    await this._publishPointer() // republica para propagar o novo nome aos seguidores
    return this.getProfile()
  }

  /**
   * Busca local de usuários: combina quem você já segue com o diretório
   * descoberto por gossip amigo-de-amigo (sem nenhum servidor central de busca).
   */
  searchUsers (query) {
    return discovery.searchUsers(this.store, this.identity.publicKeyHex, query)
  }

  /**
   * Cria um novo post: assina, encadeia na hash-chain pessoal, anexa ao
   * capítulo em aberto (que será selado/torrentado em breve) e publica o
   * ponteiro atualizado assim que o capítulo sair.
   */
  async createPost ({ text, mediaPaths }) {
    const media = (mediaPaths || []).map(p => this.chapters.attachMedia(p))
    const post = hashchain.createSignedPost(this.identity, this.store.data.ownChain, {
      type: media.length ? 'media' : 'text',
      text,
      media
    })
    this.store.data.ownChain.push(post)
    await this.store.save()
    this.chapters.addPost(post)
    return post
  }

  getFeed () {
    return feed.getFeed(this.store, this.identity)
  }

  resolveMediaPath (pubkeyHex, isOwn, sha256) {
    return feed.resolveMediaPath(pubkeyHex, isOwn, sha256)
  }

  listFollows () {
    return this.store.data.follows
  }

  async addFollow (pubkeyHex, alias) {
    if (!/^[0-9a-f]{64}$/i.test(pubkeyHex)) throw new Error('chave pública inválida (esperado hex de 64 caracteres)')
    if (pubkeyHex.toLowerCase() === this.identity.publicKeyHex.toLowerCase()) throw new Error('não é possível seguir a própria identidade')
    if (this.store.data.follows.some(f => f.pubkeyHex === pubkeyHex)) throw new Error('já está seguindo essa identidade')
    const follow = { pubkeyHex, alias: alias || pubkeyHex.slice(0, 10), lastSeq: null, lastChainHash: null, lastInfohash: null, addedAt: Date.now(), lastPolledAt: null }
    this.store.data.follows.push(follow)
    await this.store.save()
    // consulta imediatamente para trazer o feed inicial sem esperar o próximo ciclo
    discovery.pollFollow({ dht: this.torrentClient.dht, torrentClient: this.torrentClient, store: this.store }, follow)
      .then(() => this.store.save())
      .catch(err => console.error('[app] poll inicial falhou:', err.message))
    return follow
  }

  async removeFollow (pubkeyHex) {
    this.store.data.follows = this.store.data.follows.filter(f => f.pubkeyHex !== pubkeyHex)
    this.store.data.feedCache = this.store.data.feedCache.filter(p => p.pubkeyHex !== pubkeyHex)
    await this.store.save()
  }

  async deletePost (seq) {
    if (typeof seq !== 'number' || seq < 0) throw new Error('seq inválido')
    
    // Verifica se o post foi selado em um capítulo
    const { isPostSealed } = require('./feed')
    if (isPostSealed(seq)) {
      throw new Error('Não é possível deletar posts já publicados. Uma vez selados em um capítulo, eles são distribuídos permanentemente na rede P2P.')
    }
    
    const idx = this.store.data.ownChain.findIndex(p => p.seq === seq)
    if (idx === -1) throw new Error('post não encontrado')
    this.store.data.ownChain.splice(idx, 1)
    await this.store.save()
  }

  setFocusState (state) {
    this.scheduler.setState(state)
  }

  getStats () {
    return {
      ...this.torrentClient.stats(),
      follows: this.store.data.follows.length,
      ownPosts: this.store.data.ownChain.length
    }
  }

  async shutdown () {
    clearInterval(this._republishTimer)
    this.scheduler.stop()
    await this.torrentClient.destroy()
  }
}

module.exports = { App }

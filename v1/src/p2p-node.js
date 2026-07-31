'use strict'

// ====================================================================
// P2PNode — núcleo da rede social distribuída (Opção B: Hypercore)
//
// Cada usuário tem UM Hyperbee (B-tree assinado sobre um Hypercore).
// Duas famílias de chaves dentro desse Hyperbee:
//
//   'profile'                -> { nome, bio, avatar, followList, updatedAt }
//   'post!<seq 12 dígitos>'  -> { tipo, texto, imagem, timestamp, autor }
//
// O Hypercore já garante, de fábrica, o que o protótipo original fazia
// na mão: cada bloco é assinado, e a posição/ordem dos blocos forma uma
// cadeia verificável (árvore de Merkle) — não precisamos mais calcular
// nem conferir manualmente um "previousPostHash".
//
// Seguir alguém = carregar o Hypercore dela (somente leitura) via
// Corestore e entrar no swarm do tópico dela com {server:true}. Isso
// faz este peer também "semear" o perfil seguido quando o dono estiver
// offline — sem precisarmos escrever nenhum código de servir dados na
// mão: a replicação do Corestore já cuida disso com segurança (tudo
// chega assinado e é verificado antes de aceitar).
// ====================================================================

const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const Hyperswarm = require('hyperswarm')

const { loadOrCreateIdentity } = require('./identity')

const POST_PREFIX = 'post!'
const POST_SEQ_DIGITS = 12
const FOLLOWERS_PREFIX = 'followers!'
const MAX_IMAGE_BASE64_BYTES = 400 * 1024 // ~400KB de base64 por imagem (limite v1, ver README)
const HEX64 = /^[0-9a-f]{64}$/i

function postKey(seq) {
  return POST_PREFIX + String(seq).padStart(POST_SEQ_DIGITS, '0')
}

function seqFromPostKey(key) {
  return parseInt(key.slice(POST_PREFIX.length), 10)
}

function followerKey(pubKeyHex) {
  return FOLLOWERS_PREFIX + pubKeyHex
}

function pubKeyFromFollowerKey(key) {
  return key.slice(FOLLOWERS_PREFIX.length)
}

/** Resolve com `fallback` se `promise` não terminar em `ms` milissegundos. */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(fallback) }
    }, ms)
    promise.then((value) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(value) }
    }).catch(() => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(fallback) }
    })
  })
}

/** Coleta as entradas de um createReadStream do Hyperbee, com timeout (peer pode estar offline). */
function collectWithTimeout(stream, ms) {
  return new Promise((resolve) => {
    const results = []
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(results)
    }
    const timer = setTimeout(() => { stream.destroy(); finish() }, ms)
    stream.on('data', (entry) => results.push(entry))
    stream.on('end', finish)
    stream.on('close', finish)
    stream.on('error', finish)
  })
}

class P2PNode extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir - pasta onde ficam identity.json e o storage do Corestore
   * @param {number} [opts.readTimeoutMs] - timeout ao ler dados de peers seguidos
   */
  constructor({ dataDir, readTimeoutMs = 4000, swarmOpts = {} }) {
    super()
    this.dataDir = dataDir
    this.readTimeoutMs = readTimeoutMs
    this.swarmOpts = swarmOpts
    this.identityFile = path.join(dataDir, 'identity.json')
    this.storageDir = path.join(dataDir, 'corestore')

    this.store = null
    this.swarm = null
    this.myCore = null
    this.myBee = null
    /** @type {Map<string, { core: any, bee: any, discovery: any }>} */
    this.followed = new Map()
    
    // Mapa para correlacionar socketKey (Hyperswarm) → identityKey (chave real do usuário)
    this.peerIdentityMap = new Map()
    
    this.ready = false
  }

  // ------------------------------------------------------------------
  // Ciclo de vida
  // ------------------------------------------------------------------

  async start() {
    fs.mkdirSync(this.dataDir, { recursive: true })

    const { keyPair } = loadOrCreateIdentity(this.identityFile)

    this.store = new Corestore(this.storageDir)
    this.swarm = new Hyperswarm(this.swarmOpts)

    // Toda conexão P2P recebida ou iniciada replica, de forma segura,
    // qualquer core que este processo já tenha carregado (o próprio +
    // os dos perfis seguidos). Ver nota de privacidade no README: um
    // peer só consegue pedir dados de um core se já souber a chave dele.
    
    this.swarm.on('connection', (socket) => {
      const socketKey = socket.remotePublicKey?.toString('hex')
      console.log('[swarm:connection] Socket conectado de peer:', socketKey?.slice(0, 16))
      
      // FASE 1: Hand-shake de identidade
      // Enviar nossa identidade como PRIMEIRA mensagem
      const handshake = JSON.stringify({
        type: 'handshake',
        identityKey: this.myPublicKeyHex
      })
      socket.write(handshake + '\n')
      
      // FASE 2: Aguardar identidade do peer (máx 500ms)
      let handshakeDone = false
      let peerIdentityKey = null
      
      const handleFirstData = (chunk) => {
        if (handshakeDone) return
        
        try {
          const str = chunk.toString('utf8').trim()
          const lines = str.split('\n')
          const firstLine = lines[0].trim()
          
          if (firstLine.startsWith('{')) {
            const msg = JSON.parse(firstLine)
            if (msg.type === 'handshake' && msg.identityKey) {
              handshakeDone = true
              peerIdentityKey = msg.identityKey
              this.peerIdentityMap.set(socketKey, peerIdentityKey)
              
              console.log('[swarm:connection:handshake] ✓ Identidade do peer:', peerIdentityKey?.slice(0, 16))
              
              socket.removeListener('data', handleFirstData)
              this.store.replicate(socket)
              
              // Registrar com a VERDADEIRA identidade do peer
              if (peerIdentityKey && peerIdentityKey !== this.myPublicKeyHex) {
                this._recordFollower(peerIdentityKey).catch((err) => {
                  console.error('[_recordFollower] Erro:', err.message)
                })
              }
              
              this.emit('peers-changed')
              return
            }
          }
        } catch (e) {
          // Erro ao parsear handshake - continuar com fallback
        }
      }
      
      socket.on('data', handleFirstData)
      
      // FASE 3: Timeout - se não receber handshake, usar socketKey como fallback
      const timeoutId = setTimeout(() => {
        if (!handshakeDone) {
          console.log('[swarm:connection:handshake] ⚠️ Timeout no handshake, usando socketKey como fallback')
          socket.removeListener('data', handleFirstData)
          handshakeDone = true
          
          this.store.replicate(socket)
          
          if (socketKey && socketKey !== this.myPublicKeyHex) {
            this._recordFollower(socketKey).catch((err) => {
              console.error('[_recordFollower] Erro:', err.message)
            })
          }
          
          this.emit('peers-changed')
        }
      }, 500)
    })
    this.swarm.on('error', (err) => this.emit('error', err))

    this.myCore = this.store.get({ keyPair })
    await this.myCore.ready()
    this.myBee = new Hyperbee(this.myCore, { keyEncoding: 'utf-8', valueEncoding: 'json' })
    await this.myBee.ready()

    const existingProfile = await this.myBee.get('profile')
    if (!existingProfile) {
      await this.myBee.put('profile', {
        nome: 'Usuário P2P ' + Math.floor(Math.random() * 1000),
        bio: '',
        avatar: null,
        links: [],
        followList: [],
        updatedAt: Date.now()
      })
    } else if (!existingProfile.value.links) {
      // Migração para usuários existentes: adicionar campo links se não existir
      existingProfile.value.links = []
      existingProfile.value.updatedAt = Date.now()
      await this.myBee.put('profile', existingProfile.value)
    }

    await this._joinTopic(this.myCore)

    // Reabre a "semeadura" de quem este usuário já seguia em sessões anteriores.
    // Isso é aguardado (não é "fire and forget") para evitar uma corrida em
    // que um stop() logo após o start() derrubaria o swarm no meio do
    // processo de reconexão (swarm.join em um swarm já destruído).
    const profile = await this.myBee.get('profile')
    const followList = (profile && profile.value.followList) || []
    await Promise.all(followList.map((hex) =>
      this._openFollowed(hex).catch((err) => this.emit('error', err))
    ))

    this.ready = true
    this.emit('ready', { publicKeyHex: this.myPublicKeyHex })
  }

  async stop() {
    for (const { core } of this.followed.values()) {
      await core.close().catch(() => {})
    }
    if (this.swarm) await this.swarm.destroy().catch(() => {})
    if (this.store) await this.store.close().catch(() => {})
  }

  /** Chave pública compartilhável (hex) — é isso que um amigo cola para te seguir. */
  get myPublicKeyHex() {
    return this.myCore.key.toString('hex')
  }

  async _joinTopic(core) {
    const discovery = this.swarm.join(core.discoveryKey, { server: true, client: true })
    const done = core.findingPeers()
    discovery.flushed().then(done, done)
    return discovery
  }

  /**
   * Registra um seguidor no Hyperbee quando um peer se conecta para replicar o seu core.
   * Escreve um registro persistente: followers!<pubkey> = { connectedAt, lastSeen, isActive }
   */
  async _recordFollower(pubKeyHex) {
    try {
      const key = followerKey(pubKeyHex)
      const now = Date.now()
      const existing = await this.myBee.get(key)
      
      const record = existing
        ? { ...existing.value, lastSeen: now, isActive: true }
        : { connectedAt: now, lastSeen: now, isActive: true }
      
      await this.myBee.put(key, record)
      console.log('[_recordFollower] ✓ Registrado:', pubKeyHex.slice(0, 16))
    } catch (err) {
      console.error('[_recordFollower] Erro ao registrar:', err.message)
    }
  }

  /**
   * Carrega todos os registros de seguidores do próprio Hyperbee.
   * Retorna: [{ publicKeyHex, connectedAt, lastSeen }, ...]
   */
  async _loadFollowersFromRecords() {
    try {
      const stream = this.myBee.createReadStream({
        gte: FOLLOWERS_PREFIX,
        lt: FOLLOWERS_PREFIX + '\uffff'
      })
      const entries = await collectWithTimeout(stream, this.readTimeoutMs)
      
      const followers = entries
        .filter((e) => e.value && e.value.isActive)
        .map((e) => ({
          publicKeyHex: pubKeyFromFollowerKey(e.key),
          connectedAt: e.value.connectedAt,
          lastSeen: e.value.lastSeen
        }))
      
      return followers
    } catch (err) {
      console.error('[_loadFollowersFromRecords] Erro:', err.message)
      return []
    }
  }

  async _openFollowed(pubKeyHex) {
    const existing = this.followed.get(pubKeyHex)
    if (existing) return existing

    const core = this.store.get({ key: Buffer.from(pubKeyHex, 'hex') })
    await core.ready()
    const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })

    const discovery = await this._joinTopic(core)

    core.on('append', () => this.emit('feed-updated'))
    core.on('peer-add', () => this.emit('peers-changed'))
    core.on('peer-remove', () => this.emit('peers-changed'))

    const entry = { core, bee, discovery }
    this.followed.set(pubKeyHex, entry)
    return entry
  }

  async follow(pubKeyHex) {
    pubKeyHex = String(pubKeyHex || '').trim().toLowerCase()
    if (!HEX64.test(pubKeyHex)) throw new Error('Chave pública inválida (esperado hex de 64 caracteres).')
    if (pubKeyHex === this.myPublicKeyHex) throw new Error('Você não pode seguir a si mesmo.')

    await this._openFollowed(pubKeyHex)

    const current = await this.myBee.get('profile')
    const value = (current && current.value) || { followList: [] }
    if (!value.followList.includes(pubKeyHex)) {
      value.followList = [...value.followList, pubKeyHex]
      value.updatedAt = Date.now()
      await this.myBee.put('profile', value)
    }

    this.emit('following-changed')
    return true
  }

  async unfollow(pubKeyHex) {
    pubKeyHex = String(pubKeyHex || '').trim().toLowerCase()

    const current = await this.myBee.get('profile')
    if (current && current.value.followList.includes(pubKeyHex)) {
      const value = current.value
      value.followList = value.followList.filter((k) => k !== pubKeyHex)
      value.updatedAt = Date.now()
      await this.myBee.put('profile', value)
    }

    const entry = this.followed.get(pubKeyHex)
    if (entry) {
      this.swarm.leave(entry.core.discoveryKey).catch(() => {})
      await entry.core.close().catch(() => {})
      this.followed.delete(pubKeyHex)
    }

    this.emit('following-changed')
    return true
  }

  // ------------------------------------------------------------------
  // Perfil
  // ------------------------------------------------------------------

  async getMyProfile() {
    const entry = await this.myBee.get('profile')
    return { publicKeyHex: this.myPublicKeyHex, ...(entry ? entry.value : {}) }
  }

  async updateMyProfile({ nome, bio, avatar, links } = {}) {
    const current = await this.myBee.get('profile')
    const value = (current && current.value) || { followList: [], links: [] }
    if (nome !== undefined) value.nome = nome
    if (bio !== undefined) value.bio = bio
    if (avatar !== undefined) value.avatar = avatar
    if (links !== undefined) {
      // Limitar a máximo 3 links
      value.links = Array.isArray(links) ? links.slice(0, 3) : []
    }
    value.updatedAt = Date.now()
    await this.myBee.put('profile', value)
    this.emit('profile-updated')
    return value
  }

  /** Lê o perfil de qualquer chave (própria ou seguida), com timeout se ainda não sincronizou. */
  async getProfile(pubKeyHex) {
    if (pubKeyHex === this.myPublicKeyHex) {
      const myProf = await this.getMyProfile()
      console.log('[getProfile] Retornando MEU perfil:', myProf.nome)
      return myProf
    }
    
    console.log('[getProfile] Buscando perfil de:', pubKeyHex.slice(0, 16))
    const entry = this.followed.get(pubKeyHex)
    console.log('[getProfile] Entry encontrada?', !!entry)
    
    if (!entry) {
      console.log('[getProfile] ⚠️ Entry não encontrada em this.followed')
      return null
    }
    
    const result = await withTimeout(entry.bee.get('profile'), this.readTimeoutMs, null)
    const finalProfile = result ? { publicKeyHex: pubKeyHex, ...result.value } : { publicKeyHex: pubKeyHex, sincronizando: true }
    console.log('[getProfile] ✓ Perfil retornado:', { nome: finalProfile.nome, pubKeyHex: pubKeyHex.slice(0, 16) })
    return finalProfile
  }

  async getFollowingList() {
    const profile = await this.getMyProfile()
    const list = profile.followList || []
    const results = await Promise.all(list.map(async (hex) => {
      const p = await this.getProfile(hex)
      const entry = this.followed.get(hex)
      return {
        publicKeyHex: hex,
        nome: p && p.nome,
        bio: p && p.bio,
        avatar: p && p.avatar,
        links: p && p.links,
        sincronizando: !p || !!p.sincronizando,
        peersConectados: entry ? entry.core.peers.length : 0
      }
    }))
    return results
  }

  /**
   * Retorna lista de usuários que têm se conectado ao seu Hypercore.
   * Lê registros persistentes do Hyperbee (followers!<pubkey>).
   */
  async getFollowers() {
    const followers = await this._loadFollowersFromRecords()
    console.log(`[getFollowers] Retornando ${followers.length} seguidores (chaves: ${followers.map(f => f.publicKeyHex.slice(0, 12)).join(', ')})`)
    return followers
  }

  /** Retorna todos os posts de um usuário específico. */
  async getPostsOf(pubKeyHex) {
    if (pubKeyHex === this.myPublicKeyHex) {
      return this._postsFrom(pubKeyHex, this.myBee)
    }
    const entry = this.followed.get(pubKeyHex)
    if (!entry) return []
    return this._postsFrom(pubKeyHex, entry.bee)
  }

  // ------------------------------------------------------------------
  // Posts
  // ------------------------------------------------------------------

  async _nextSeq(bee) {
    const stream = bee.createReadStream({ gte: POST_PREFIX, lt: POST_PREFIX + '\uffff', reverse: true, limit: 1 })
    const [last] = await collectWithTimeout(stream, this.readTimeoutMs)
    return last ? seqFromPostKey(last.key) + 1 : 1
  }

  async publishPost({ tipo, texto, imagem }) {
    if (tipo !== 'texto' && tipo !== 'imagem') {
      throw new Error("tipo precisa ser 'texto' ou 'imagem'")
    }
    if (tipo === 'texto' && !texto) {
      throw new Error('post de texto precisa de conteúdo')
    }
    if (tipo === 'imagem') {
      if (!imagem || !imagem.dataBase64 || !imagem.mime) {
        throw new Error('post de imagem precisa de { dataBase64, mime }')
      }
      if (imagem.dataBase64.length > MAX_IMAGE_BASE64_BYTES) {
        throw new Error(`imagem excede o limite de ${Math.round(MAX_IMAGE_BASE64_BYTES / 1024)}KB (v1)`)
      }
    }

    const seq = await this._nextSeq(this.myBee)
    const post = {
      tipo,
      texto: texto || null,
      imagem: imagem || null,
      timestamp: Date.now(),
      autor: this.myPublicKeyHex
    }
    await this.myBee.put(postKey(seq), post)
    this.emit('feed-updated')
    return { seq, ...post }
  }

  async _postsFrom(pubKeyHex, bee) {
    const stream = bee.createReadStream({ gte: POST_PREFIX, lt: POST_PREFIX + '\uffff' })
    const entries = await collectWithTimeout(stream, this.readTimeoutMs)
    return entries.map((e) => ({ seq: seqFromPostKey(e.key), autor: pubKeyHex, ...e.value }))
  }

  /** Monta o feed: posts próprios + de quem você segue, mais recentes primeiro. */
  async getFeed({ limit = 100 } = {}) {
    const sources = [
      this._postsFrom(this.myPublicKeyHex, this.myBee),
      ...[...this.followed.entries()].map(([hex, entry]) => this._postsFrom(hex, entry.bee))
    ]
    const groups = await Promise.all(sources)
    const posts = groups.flat().sort((a, b) => b.timestamp - a.timestamp)
    return posts.slice(0, limit)
  }
}

module.exports = { P2PNode }

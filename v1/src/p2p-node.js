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

const { loadOrCreateIdentity, saveCoreKey } = require('./identity')
const { writeRecoveredMarker } = require('./user-data')

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
  constructor({ dataDir, readTimeoutMs = 4000, recoveryTimeoutMs = 90000, swarmOpts = {} }) {
    super()
    this.dataDir = dataDir
    this.readTimeoutMs = readTimeoutMs
    this.recoveryTimeoutMs = recoveryTimeoutMs
    this.swarmOpts = swarmOpts
    this.identityFile = path.join(dataDir, 'identity.json')
    this.storageDir = path.join(dataDir, 'corestore')
    // Durante a recuperação, o storage fica em uma pasta TEMPORÁRIA (fora do local
    // definitivo) e só é promovido para `corestore` depois que a identidade foi de
    // fato recuperada da rede. Assim, um usuário importado mas não recuperado nunca
    // cria a pasta `corestore` — que é o sinal de "usuário estabelecido".
    this.recoveryStorageDir = path.join(dataDir, 'corestore.recovery')

    this.store = null
    this.swarm = null
    this.myCore = null
    this.myBee = null
    /** @type {Map<string, { core: any, bee: any, discovery: any }>} */
    this.followed = new Map()
    
    /**
     * Armazena dados de peers que seguem você (seguidores).
     * Usado apenas para exibir perfil/posts de seguidores, NÃO para o feed.
     * Feed inclui APENAS peers em this.followed (que você segue).
     */
    this.followerDataCache = new Map()
    
    // Mapa para correlacionar socketKey (Hyperswarm) → identityKey (chave real do usuário)
    this.peerIdentityMap = new Map()
    
    this.ready = false
    this.lifecycleState = 'new'
    this.activeOperations = 0
    this.operationsDrained = null
    this.stopPromise = null
    this.recoveryState = null
    this.recoveryPromise = null
    this.recoveryCancelled = false
    this.recoveryDownload = null
    this.followerWritePromise = Promise.resolve()
    this.followerRecords = new Map()
    this.followerRecordsLoaded = false
  }

  _runOperation(operation) {
    if (this.lifecycleState !== 'ready') {
      throw new Error(`Nó P2P indisponível (${this.lifecycleState}).`)
    }

    this.activeOperations++
    const result = Promise.resolve().then(operation)
    return result.finally(() => {
      this.activeOperations--
      if (this.activeOperations === 0 && this.operationsDrained) {
        this.operationsDrained()
        this.operationsDrained = null
      }
    })
  }

  // ------------------------------------------------------------------
  // Ciclo de vida
  // ------------------------------------------------------------------

  async start({ recovery = false } = {}) {
    if (this.lifecycleState === 'ready') return
    if (this.lifecycleState !== 'new') {
      throw new Error(`Nó P2P não pode iniciar (${this.lifecycleState}).`)
    }

    this.lifecycleState = 'starting'
    fs.mkdirSync(this.dataDir, { recursive: true })

    const { keyPair, coreKey } = loadOrCreateIdentity(this.identityFile)

    const storeDir = recovery ? this._prepareRecoveryStorage() : this.storageDir
    this.store = new Corestore(storeDir)
    this.swarm = new Hyperswarm(this.swarmOpts)
    this._setupSwarmHandlers()

    if (recovery) {
      this.recoveryCancelled = false
      this.myCore = this.store.get({
        key: coreKey ? Buffer.from(coreKey, 'hex') : keyPair.publicKey,
        writable: false
      })
      await this.myCore.ready()
      this.myBee = new Hyperbee(this.myCore, { keyEncoding: 'utf-8', valueEncoding: 'json' })
      await this.myBee.ready()
      await this._joinTopic(this.myCore)
      this.lifecycleState = 'recovery'
      this.recoveryState = 'waiting'
      this.recoveryPromise = new Promise((resolve, reject) => {
        setImmediate(() => this._recoverFromNetwork(keyPair, coreKey).then(resolve, reject))
      })
      this.recoveryPromise.catch((err) => this.emit('error', err))
      this.emit('recovery-updated', { state: this.recoveryState, timeoutMs: this.recoveryTimeoutMs })
      return
    }

    this.myCore = this.store.get({ keyPair })
    await this.myCore.ready()
    if (!coreKey || coreKey !== this.myCore.key.toString('hex')) {
      saveCoreKey(this.identityFile, this.myCore.key)
    }
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
      this._openFollowed(hex, { waitForProfile: true }).catch((err) => this.emit('error', err))
    ))

    // Usuário estabelecido: dados já estão no disco (core gravável + perfil garantido).
    writeRecoveredMarker(this.dataDir)
    this.ready = true
    this.lifecycleState = 'ready'
    this.emit('ready', { publicKeyHex: this.myPublicKeyHex })
  }

  /**
   * Registra os handlers de conexão do swarm. É um método separado porque o
   * swarm precisa ser RECRIADO durante a promoção do storage de recuperação
   * (ver _promoteRecoveryStorage) — e o novo swarm precisa dos mesmos handlers.
   */
  _setupSwarmHandlers() {
    // Toda conexão P2P recebida ou iniciada replica, de forma segura,
    // qualquer core que este processo já tenha carregado (o próprio +
    // os dos perfis seguidos). Ver nota de privacidade no README: um
    // peer só consegue pedir dados de um core se já souber a chave dele.

    this.swarm.on('connection', (socket) => {
      const socketKey = socket.remotePublicKey?.toString('hex')
      const connectedAt = Date.now()

      // Hand-shake para trocar identidades
      // { type: 'handshake', identityKey: 'ABC...' }
      //
      // APÓS o handshake, peer pode enviar:
      // { type: 'follow-request', identityKey: 'ABC...' }  ← pedindo para ser registrado como seguidor
      //
      // Apenas registra como seguidor se receber follow-request explícito

      let handshakeDone = false
      let peerIdentityKey = null

      const handshakeMessage = JSON.stringify({
        type: 'handshake',
        identityKey: this.myPublicKeyHex
      })

      const processHandshake = (chunk) => {
        if (handshakeDone) return false

        const str = chunk.toString('utf8')
        const newlineIdx = str.indexOf('\n')
        if (newlineIdx === -1) return false

        const firstLine = str.substring(0, newlineIdx).trim()
        try {
          if (firstLine.startsWith('{')) {
            const msg = JSON.parse(firstLine)
            if (msg.type === 'handshake' && msg.identityKey && msg.identityKey.length === 64) {
              handshakeDone = true
              peerIdentityKey = msg.identityKey
              this.peerIdentityMap.set(socketKey, peerIdentityKey)

              console.log('[swarm:connection:handshake] ✓ Peer:', peerIdentityKey.slice(0, 16))

              return true
            }
          }
        } catch (e) {
          console.log('[swarm:connection:handshake] ⚠️ Parse error:', e.message)
        }
        return false
      }

      const processFollowRequest = (chunk) => {
        const str = chunk.toString('utf8')
        const newlineIdx = str.indexOf('\n')
        if (newlineIdx === -1) return false

        const firstLine = str.substring(0, newlineIdx).trim()
        try {
          if (firstLine.startsWith('{')) {
            const msg = JSON.parse(firstLine)
            if (msg.type === 'follow-request' && msg.identityKey && msg.identityKey.length === 64) {
              console.log('[swarm:connection:follow-request] ✓ Recebi follow-request de:', msg.identityKey.slice(0, 16))
              if (this.lifecycleState === 'ready') {
                this._recordFollower(msg.identityKey).catch((err) => {
                  console.error('[_recordFollower] Erro:', err.message)
                })
              }
              return true
            }
          }
        } catch (e) {
          // Ignorar erros de parse
        }
        return false
      }

      const handleData = (chunk) => {
        if (!handshakeDone) {
          if (processHandshake(chunk)) {
            socket.removeListener('data', handleData)

            // Iniciar replicação após handshake bem-sucedido
            this._safeReplicate(socket)

            // Aguardar follow-request por até 3 segundos
            const followRequestTimeout = setTimeout(() => {
              socket.removeListener('data', handleFollowRequest)
              console.log('[swarm:connection:follow-request] ⚠️ Timeout, nenhum follow-request recebido de:', peerIdentityKey.slice(0, 16))
            }, 3000)

            // Continuar ouvindo por follow-request
            const handleFollowRequest = (chunk) => {
              if (processFollowRequest(chunk)) {
                clearTimeout(followRequestTimeout)
                socket.removeListener('data', handleFollowRequest)
              }
            }
            socket.on('data', handleFollowRequest)

            this.emit('peers-changed')
          }
        }
      }

      // Registrar listener ANTES de enviar (evita race condition)
      socket.on('data', handleData)

      // Enviar handshake
      socket.write(handshakeMessage + '\n')

      // Timeout se não receber handshake
      const handshakeTimeout = setTimeout(() => {
        if (!handshakeDone) {
          console.log('[swarm:connection:handshake] ⚠️ Timeout, continuando sem handshake')
          socket.removeListener('data', handleData)
          handshakeDone = true
          this._safeReplicate(socket)
          this.emit('peers-changed')
        }
      }, 1000)

      socket.on('close', () => {
        clearTimeout(handshakeTimeout)
      })
    })
    this.swarm.on('error', (err) => this.emit('error', err))
  }

  /**
   * Inicia a replicação do Corestore em um socket, tolerando o store em transição
   * (fechado/reaberto durante a promoção do storage de recuperação). Nesse caso a
   * conexão é reestabelecida pelo novo swarm; aqui apenas evitamos que o erro
   * estoure dentro do handler de 'data'.
   */
  _safeReplicate(socket) {
    try {
      if (this.store && !socket.destroyed) this.store.replicate(socket)
    } catch (err) {
      console.log('[swarm:connection] ⚠️ Replicação não iniciada (store em transição):', err.message)
    }
  }

  /** Prepara (e limpa) o storage temporário usado durante a recuperação da identidade. */
  _prepareRecoveryStorage() {
    fs.rmSync(this.recoveryStorageDir, { recursive: true, force: true })
    fs.mkdirSync(this.recoveryStorageDir, { recursive: true })
    return this.recoveryStorageDir
  }

  async _recoverFromNetwork(keyPair, coreKey) {
    let lastDownloadedCount = -1
    let stallStreak = 0
    let stalledNotified = false

    while (this.lifecycleState === 'recovery' && !this.recoveryCancelled) {
      try {
        await withTimeout(this.myCore.update({ wait: true }), 3000, null)
        if (this.myCore.length === 0) {
          // Nenhum seeder com dados no momento — volta para a fase de busca.
          lastDownloadedCount = -1
          stallStreak = 0
          stalledNotified = false
          if (this.recoveryState !== 'waiting') {
            this.recoveryState = 'waiting'
            this.emit('recovery-updated', { state: this.recoveryState, timeoutMs: this.recoveryTimeoutMs })
          }
          await new Promise((resolve) => setTimeout(resolve, 500))
          continue
        }

        // Um seeder apareceu e há dados para baixar — avisa a UI para mostrar
        // a fase de sincronização ("seeder encontrado, baixando dados…").
        this.recoveryState = 'syncing'
        this.emit('recovery-updated', { state: this.recoveryState })

        const download = this.myCore.download({ start: 0, end: this.myCore.length })
        this.recoveryDownload = download
        const downloaded = await withTimeout(download.done().then(() => true), 15000, false)
        if (this.recoveryDownload === download) this.recoveryDownload = null
        if (this.recoveryCancelled) return

        if (!downloaded) {
          // O download não terminou no tempo. Conta quantos blocos realmente
          // chegaram para distinguir "ainda baixando" de "seeder incompleto":
          // um seeder parcial anuncia o tamanho do core, envia os blocos que
          // tem e deixa o resto pendurado para sempre.
          const len = this.myCore.length
          let have = 0
          if (len > 0) {
            for (let i = 0; i < len; i++) {
              if (await this.myCore.has(i)) have++
            }
          }

          if (have < len) {
            if (have > lastDownloadedCount) {
              // Há progresso — algum peer está enviando blocos.
              lastDownloadedCount = have
              stallStreak = 0
              stalledNotified = false
            } else {
              // Nenhum progresso desde a tentativa anterior: os seeders na rede
              // têm cópias INCOMPLETAS e não conseguem enviar o que falta.
              stallStreak++
              if (stallStreak >= 3 && !stalledNotified) {
                stalledNotified = true
                this.recoveryState = 'stalled'
                this.emit('recovery-updated', { state: this.recoveryState, downloaded: have, length: len })
              }
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 500))
          continue
        }

        const profile = await withTimeout(this.myBee.get('profile'), 3000, null)
        if (profile) {
          const followList = (profile && profile.value.followList) || []
          const coreKeyHex = this.myCore.key.toString('hex')
          await this.swarm.leave(this.myCore.discoveryKey).catch(() => {})
          await this.myBee.close().catch(() => {})
          await this.myCore.close().catch(() => {})
          // Só agora — com os dados de fato recuperados — o storage temporário é
          // promovido para o local definitivo (dataDir/corestore).
          await this._promoteRecoveryStorage()

          this.myCore = this.store.get({ key: coreKeyHex, keyPair })
          await this.myCore.ready()
          if (!coreKey || coreKey !== coreKeyHex) {
            saveCoreKey(this.identityFile, coreKeyHex)
          }
          this.myBee = new Hyperbee(this.myCore, { keyEncoding: 'utf-8', valueEncoding: 'json' })
          await this.myBee.ready()
          await this._joinTopic(this.myCore)
          await Promise.all(followList.map((hex) =>
            this._openFollowed(hex, { waitForProfile: true }).catch((err) => this.emit('error', err))
          ))

          writeRecoveredMarker(this.dataDir)
          this.recoveryState = 'recovered'
          this.lifecycleState = 'ready'
          this.ready = true
          this.emit('recovery-updated', { state: this.recoveryState, publicKeyHex: this.myPublicKeyHex })
          this.emit('ready', { publicKeyHex: this.myPublicKeyHex })
          return
        }
      } catch (err) {
        if (err.code !== 'SESSION_CLOSED') this.emit('error', err)
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
    }

  }

  /**
   * Promove o storage temporário da recuperação para o local definitivo.
   * Só deve ser chamado DEPOIS que perfil/posts foram de fato recuperados da rede.
   * Fecha o Corestore temporário (libera os handles do RocksDB — necessário para
   * renomear no Windows), move a pasta e reabre o Corestore no local definitivo.
   *
   * IMPORTANTE: o swarm também é recriado aqui. As conexões existentes carregam
   * streams de replicação ligadas ao store ANTIGO (que será fechado); se ficarem
   * vivas, o Hyperswarm mantém a deduplicação por chave pública (uma conexão por
   * peer) e os cores seguidos abertos depois da promoção nunca ganham um peer de
   * replicação — o feed fica sem posts remotos e a lista de seguidos presa em
   * "sincronizando". Ao recriar o swarm com os handlers re-registrados, novas
   * conexões replicam o store promovido (que já contém os cores seguidos).
   */
  async _promoteRecoveryStorage() {
    // Teardown suave do swarm ANTES de fechar o store: destrói as conexões,
    // as descobertas e o server DHT, mas PRESERVA o DHT (que pode ser externo,
    // ex.: um nó de testnet nos testes). O destroy() completo do swarm mataria
    // o DHT e o novo swarm ficaria sem rede.
    if (this.swarm) {
      for (const conn of [...this.swarm.connections]) {
        try { conn.destroy() } catch { /* ignora */ }
      }
      await this.swarm.clear().catch(() => {})
      await this.swarm.server.close().catch(() => {})
    }
    const dht = this.swarm ? this.swarm.dht : null
    const keyPair = this.swarm ? this.swarm.keyPair : null

    if (this.store) await this.store.close().catch(() => {})
    fs.rmSync(this.storageDir, { recursive: true, force: true })
    try {
      fs.renameSync(this.recoveryStorageDir, this.storageDir)
    } catch {
      // Fallback (ex.: volume diferente ou bloqueio do SO): copia e remove.
      fs.cpSync(this.recoveryStorageDir, this.storageDir, { recursive: true })
      fs.rmSync(this.recoveryStorageDir, { recursive: true, force: true })
    }
    this.store = new Corestore(this.storageDir)
    await this.store.ready()

    // Recria o swarm reutilizando o mesmo DHT e keyPair, e re-registra os
    // handlers. O novo swarm nasce com _allConnections vazio, então novas
    // conexões são abertas e replicam o store promovido.
    this.swarm = new Hyperswarm({
      ...this.swarmOpts,
      ...(dht ? { dht } : {}),
      ...(keyPair ? { keyPair } : {})
    })
    this._setupSwarmHandlers()
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise

    this.stopPromise = (async () => {
      this.ready = false
      this.recoveryCancelled = true
      if (this.recoveryDownload) this.recoveryDownload.destroy()
      this.lifecycleState = 'stopping'

      if (this.recoveryPromise) await this.recoveryPromise.catch(() => {})
      if (this.activeOperations > 0) {
        await new Promise((resolve) => { this.operationsDrained = resolve })
      }

    for (const { core } of this.followed.values()) {
      await core.close().catch(() => {})
    }
    if (this.swarm) await this.swarm.destroy().catch(() => {})
    if (this.store) await this.store.close().catch(() => {})
    // Remove resíduo de uma recuperação abandonada (a pasta temporária nunca vira
    // `corestore`; se a recuperação teve sucesso, ela já foi renomeada para lá).
    fs.rmSync(this.recoveryStorageDir, { recursive: true, force: true })
      this.lifecycleState = 'stopped'
    })()

    return this.stopPromise
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
  
  // Armazenar qual core publicamos (para identificar em swarm.on('connection'))
  get myDiscoveryKey() {
    return this.myCore?.discoveryKey?.toString('hex')
  }

  /**
   * Registra um seguidor no Hyperbee quando um peer se conecta para replicar o seu core.
   * Escreve um registro persistente: followers!<pubkey> = { connectedAt, lastSeen, isActive }
   * Também carrega automaticamente os dados (perfil, posts) do seguidor para exibir na UI.
   */
  async _recordFollower(pubKeyHex) {
    const operation = this.followerWritePromise.then(async () => {
      const now = Date.now()
      if (!this.followerRecordsLoaded) {
        const followers = await this._loadFollowersFromRecords()
        for (const follower of followers) {
          this.followerRecords.set(follower.publicKeyHex, {
            connectedAt: follower.connectedAt,
            lastSeen: follower.lastSeen,
            isActive: true
          })
        }
        this.followerRecordsLoaded = true
      }

      const previous = this.followerRecords.get(pubKeyHex)
      this.followerRecords.set(pubKeyHex, previous
        ? { ...previous, lastSeen: now, isActive: true }
        : { connectedAt: now, lastSeen: now, isActive: true })

      const batch = this.myBee.batch()
      for (const [followerKeyHex, record] of this.followerRecords) {
        await batch.put(followerKey(followerKeyHex), record)
      }
      await batch.flush()
      console.log('[_recordFollower] ✓ Registrado:', pubKeyHex.slice(0, 16))
      
      // Carregar automaticamente os dados do novo seguidor (perfil, posts)
      // Isso permite que a UI mostre informações do seguidor sem necessidade de follow
      // Usa _loadFollowerData com isFollower: true (não _openFollowed) para evitar follow-request de volta
      this._loadFollowerData(pubKeyHex, true).catch((err) => {
        console.log('[_recordFollower] ⚠️ Erro ao carregar dados do seguidor:', err.message)
      })
    })
    this.followerWritePromise = operation.catch(() => {})
    try {
      await operation
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

  /**
   * Carrega os dados de um peer (core + bee) e envia follow-request.
   * Chamado quando você explicitamente segue alguém.
   */
  async _openFollowed(pubKeyHex, { waitForProfile = false } = {}) {
    const entry = await this._loadFollowerData(pubKeyHex)
    
    // Enviar follow-request para todos os peers conectados neste core
    // Isso indica explicitamente que queremos ser registrados como seguidor
    this._sendFollowRequestsToPeers(pubKeyHex, entry).catch((err) => {
      console.log('[_openFollowed] Falha ao enviar follow-requests:', err.message)
    })

    if (waitForProfile) await this._waitForFollowedProfile(entry)
    
    return entry
  }

  async _waitForFollowedProfile(entry) {
    const deadline = Date.now() + Math.max(this.readTimeoutMs, 10000)
    let profile = null
    while (Date.now() < deadline && this.lifecycleState !== 'stopping' && this.lifecycleState !== 'stopped') {
      profile = await withTimeout(entry.bee.get('profile'), 1000, null)
      if (profile) break
      await withTimeout(entry.core.update({ wait: true }), 1000, null)
      if (entry.core.length > 0) {
        const download = entry.core.download({ start: 0, end: entry.core.length })
        await withTimeout(download.done().then(() => true), 5000, false)
      }
    }

    // Importante: mesmo com o perfil já lido, garantir que TODOS os blocos do
    // core seguido estejam em disco. Sem isso, este peer vira um "seeder
    // incompleto": anuncia o tamanho do core, serve apenas os blocos que baixou
    // e trava a recuperação de identidade do dono (que fica esperando blocos
    // que ninguém na rede tem).
    if (profile) await this._ensureFullDownload(entry)

    return profile
  }

  /**
   * Baixa (best-effort) todos os blocos do core de um peer seguido, para que
   * este nó sirva como seeder COMPLETO quando o dono estiver offline.
   * Sem isso, um seguidor pode terminar com uma cópia parcial (ex.: só as
   * entradas que a UI leu) e não conseguir atender uma recuperação de identidade.
   */
  async _ensureFullDownload(entry, timeoutMs = Math.max(this.readTimeoutMs, 15000)) {
    const { core } = entry
    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') return false

    // Se a cópia local já está completa, não precisa esperar a rede.
    const localLen = core.length
    if (localLen > 0) {
      let complete = true
      for (let i = 0; i < localLen; i++) {
        if (!(await core.has(i))) { complete = false; break }
      }
      if (complete) return true
    }

    // Cópia local incompleta (ou tamanho ainda desconhecido): descobre o tamanho
    // real pela rede e baixa os blocos faltantes, tentando até o limite de tempo.
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline && this.lifecycleState !== 'stopping' && this.lifecycleState !== 'stopped') {
      await withTimeout(core.update({ wait: true }), 1500, null)
      const len = core.length
      if (len > 0) {
        const download = core.download({ start: 0, end: len })
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        const ok = await withTimeout(download.done().then(() => true), Math.min(5000, remaining), false)
        if (ok) return true
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return false
  }

  /**
   * Carrega os dados (core + bee) de um peer sem enviar follow-request.
   * @param {string} pubKeyHex - Chave pública do peer
   * @param {boolean} isFollower - Se true, armazena em followerDataCache (seguidor que não segue você).
   *                               Se false, armazena em followed (peer que você segue).
   * Usado internamente para sincronizar dados de seguidores e peers conectados.
   */
  async _loadFollowerData(pubKeyHex, isFollower = false) {
    const targetMap = isFollower ? this.followerDataCache : this.followed
    const existing = targetMap.get(pubKeyHex)
    if (existing) return existing

    const core = this.store.get({ key: Buffer.from(pubKeyHex, 'hex') })
    await core.ready()
    const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })

    const discovery = await this._joinTopic(core)

    core.on('append', () => this.emit('feed-updated'))
    // Reenvia o follow-request a cada novo peer conectado ao core seguido: o envio
    // inicial pode pegar apenas uma parte dos peers (a descoberta é incremental),
    // e quem conecta depois ficaria sem saber que este usuário o segue.
    core.on('peer-add', () => {
      this.emit('peers-changed')
      if (!isFollower) {
        this._sendFollowRequestsToPeers(pubKeyHex, entry).catch((err) => {
          console.log('[_openFollowed] Falha ao reenviar follow-request:', err.message)
        })
      }
    })
    core.on('peer-remove', () => this.emit('peers-changed'))

    const entry = { core, bee, discovery }
    targetMap.set(pubKeyHex, entry)
    
    return entry
  }
  
  /** Enviar follow-request para peers conectados (recursivo, tenta novamente se não encontrar peers) */
  async _sendFollowRequestsToPeers(pubKeyHex, entry, attempts = 0) {
    const { core } = entry
    const peers = core.peers || []

    if (peers.length === 0) {
      // Nenhum peer conectado ainda — continua tentando com backoff enquanto o
      // nó estiver vivo. Desistir cedo (antes: 6 tentativas × 500ms = 3s) faz o
      // follow-request nunca chegar quando a descoberta DHT demora mais que isso,
      // e o dono do perfil seguido nunca registra este usuário como seguidor.
      if (
        this.lifecycleState === 'stopping' ||
        this.lifecycleState === 'stopped' ||
        core.closed
      ) return
      const delay = Math.min(500 * (attempts + 1), 5000)
      console.log('[_sendFollowRequestsToPeers] Aguardando peers para:', pubKeyHex.slice(0, 16), '(tentativa', attempts + 1, ')')
      await new Promise(resolve => setTimeout(resolve, delay))
      return this._sendFollowRequestsToPeers(pubKeyHex, entry, attempts + 1)
    }

    // Enviar para cada peer conectado
    const followRequest = JSON.stringify({
      type: 'follow-request',
      identityKey: this.myPublicKeyHex
    })
    let sent = 0
    for (const peer of peers) {
      if (peer.stream && !peer.stream.destroyed) {
        try {
          peer.stream.write(followRequest + '\n')
          sent++
        } catch (e) {
          // Ignorar
        }
      }
    }

    if (sent > 0) {
      console.log('[_sendFollowRequestsToPeers] ✓ Enviado follow-request para', sent, 'peer(s) em:', pubKeyHex.slice(0, 16))
    }
  }

  async follow(pubKeyHex) {
    return this._runOperation(async () => {
      pubKeyHex = String(pubKeyHex || '').trim().toLowerCase()
      if (!HEX64.test(pubKeyHex)) throw new Error('Chave pública inválida (esperado hex de 64 caracteres).')
      if (pubKeyHex === this.myPublicKeyHex) throw new Error('Você não pode seguir a si mesmo.')

      await this._openFollowed(pubKeyHex)

      // Garante que a cópia local do core seguido fique COMPLETA (todos os blocos),
      // para que este nó possa servir como seeder completo numa futura recuperação.
      const followedEntry = this.followed.get(pubKeyHex)
      if (followedEntry) await this._ensureFullDownload(followedEntry)

      const current = await this.myBee.get('profile')
      const value = (current && current.value) || { followList: [] }
      if (!value.followList.includes(pubKeyHex)) {
        value.followList = [...value.followList, pubKeyHex]
        value.updatedAt = Date.now()
        await this.myBee.put('profile', value)
      }

      this.emit('following-changed')
      return true
    })
  }

  async unfollow(pubKeyHex) {
    return this._runOperation(async () => {
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
    })
  }

  // ------------------------------------------------------------------
  // Perfil
  // ------------------------------------------------------------------

  async getMyProfile() {
    return this._runOperation(async () => {
      const entry = await this.myBee.get('profile')
      return { publicKeyHex: this.myPublicKeyHex, ...(entry ? entry.value : {}) }
    })
  }

  async updateMyProfile({ nome, bio, avatar, links } = {}) {
    return this._runOperation(async () => {
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
    })
  }

  /** Lê o perfil de qualquer chave (própria, seguida ou seguidor), com timeout se ainda não sincronizou. */
  async getProfile(pubKeyHex) {
    return this._runOperation(async () => {
      if (pubKeyHex === this.myPublicKeyHex) {
        const entry = await this.myBee.get('profile')
        const myProf = { publicKeyHex: this.myPublicKeyHex, ...(entry ? entry.value : {}) }
        console.log('[getProfile] Retornando MEU perfil:', myProf.nome)
        return myProf
      }

      console.log('[getProfile] Buscando perfil de:', pubKeyHex.slice(0, 16))
      // Procurar primeiro em peers que você segue
      let entry = this.followed.get(pubKeyHex)

      // Se não encontrar, procurar em seguidores (followerDataCache)
      if (!entry) {
        entry = this.followerDataCache.get(pubKeyHex)
      }

      console.log('[getProfile] Entry encontrada?', !!entry)

      if (!entry) {
        console.log('[getProfile] ⚠️ Entry não encontrada em this.followed nem em this.followerDataCache')
        return null
      }

      const result = await withTimeout(entry.bee.get('profile'), this.readTimeoutMs, null)
      const finalProfile = result ? { publicKeyHex: pubKeyHex, ...result.value } : { publicKeyHex: pubKeyHex, sincronizando: true }
      console.log('[getProfile] ✓ Perfil retornado:', { nome: finalProfile.nome, pubKeyHex: pubKeyHex.slice(0, 16) })
      return finalProfile
    })
  }

  async getFollowingList() {
    return this._runOperation(async () => {
      const profile = await this.myBee.get('profile')
      const list = (profile && profile.value && profile.value.followList) || []
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
    })
  }

  /**
   * Retorna lista de usuários que têm se conectado ao seu Hypercore.
   * Lê registros persistentes do Hyperbee (followers!<pubkey>).
   */
  async getFollowers() {
    return this._runOperation(async () => {
      const followers = await this._loadFollowersFromRecords()
      console.log(`[getFollowers] Retornando ${followers.length} seguidores (chaves: ${followers.map(f => f.publicKeyHex.slice(0, 12)).join(', ')})`)
      return followers
    })
  }

  /** Retorna todos os posts de um usuário específico (seguido ou seguidor). */
  async getPostsOf(pubKeyHex) {
    return this._runOperation(async () => {
      if (pubKeyHex === this.myPublicKeyHex) {
        return this._postsFrom(pubKeyHex, this.myBee)
      }
      // Procurar primeiro em peers que você segue
      let entry = this.followed.get(pubKeyHex)

      // Se não encontrar, procurar em seguidores
      if (!entry) {
        entry = this.followerDataCache.get(pubKeyHex)
      }

      if (!entry) return []
      return this._postsFrom(pubKeyHex, entry.bee)
    })
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
    return this._runOperation(async () => {
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
    })
  }

  async _postsFrom(pubKeyHex, bee) {
    const stream = bee.createReadStream({ gte: POST_PREFIX, lt: POST_PREFIX + '\uffff' })
    const entries = await collectWithTimeout(stream, this.readTimeoutMs)
    return entries.map((e) => ({ seq: seqFromPostKey(e.key), autor: pubKeyHex, ...e.value }))
  }

  /** Monta o feed: posts próprios + de quem você segue, mais recentes primeiro. */
  async getFeed({ limit = 100 } = {}) {
    return this._runOperation(async () => {
      const sources = [
        this._postsFrom(this.myPublicKeyHex, this.myBee),
        ...[...this.followed.entries()].map(([hex, entry]) => this._postsFrom(hex, entry.bee))
      ]
      const groups = await Promise.all(sources)
      const posts = groups.flat().sort((a, b) => b.timestamp - a.timestamp)
      return posts.slice(0, limit)
    })
  }
}

module.exports = { P2PNode }

'use strict'

// ====================================================================
// P2PNode — core of the distributed social network (Option B: Hypercore)
//
// Each user has ONE Hyperbee (signed B-tree over a Hypercore).
// Two key families inside that Hyperbee:
//
//   'profile'                -> { nome, bio, avatar, followList, updatedAt }
//   'post!<seq 12 digits>'   -> { tipo, texto, imagem, timestamp, autor }
//
// Hypercore already guarantees, out of the box, what the original prototype
// did by hand: each block is signed, and the position/order of blocks forms
// a verifiable chain (Merkle tree) — we no longer need to compute or check
// a "previousPostHash" manually.
//
// Following someone = load their Hypercore (read-only) via Corestore and
// join their topic swarm with {server:true}. This makes this peer also
// "seed" the followed profile when the owner is offline — without needing
// to write any data-serving code by hand: Corestore replication handles it
// safely (everything arrives signed and is verified before being accepted).
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
const MAX_IMAGE_BASE64_BYTES = 400 * 1024 // ~400KB of base64 per image (v1 limit, see README)
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

/** Resolves with `fallback` if `promise` does not finish within `ms` milliseconds. */
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

/** Collects the entries of a Hyperbee createReadStream, with timeout (peer may be offline). */
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
   * @param {string} opts.dataDir - folder where identity.json and the Corestore storage live
   * @param {number} [opts.readTimeoutMs] - timeout when reading data from followed peers
   * @param {string} [opts.autoFollowKey] - public key of the official Coherence user that
   *   BRAND-NEW users follow automatically on first run (ignored for existing users).
   *   Pass ''/undefined to disable.
   */
  constructor({ dataDir, readTimeoutMs = 4000, recoveryTimeoutMs = 90000, recoveryDownloadTimeoutMs = 15000, swarmOpts = {}, autoFollowKey = '' }) {
    super()
    this.dataDir = dataDir
    this.readTimeoutMs = readTimeoutMs
    this.recoveryTimeoutMs = recoveryTimeoutMs
    this.autoFollowKey = String(autoFollowKey || '').trim().toLowerCase()
    // Window to wait for blocks in each recovery download attempt.
    // Smaller in tests to detect stalls faster; 15s in the app.
    this.recoveryDownloadTimeoutMs = recoveryDownloadTimeoutMs
    this.swarmOpts = swarmOpts
    this.identityFile = path.join(dataDir, 'identity.json')
    this.storageDir = path.join(dataDir, 'corestore')
    // During recovery, the storage lives in a TEMPORARY folder (outside the
    // final location) and is only promoted to `corestore` after the identity
    // was actually recovered from the network. Thus, an imported but not
    // recovered user never creates the `corestore` folder — which is the
    // signal of an "established user".
    this.recoveryStorageDir = path.join(dataDir, 'corestore.recovery')

    this.store = null
    this.swarm = null
    this.myCore = null
    this.myBee = null
    /** @type {Map<string, { core: any, bee: any, discovery: any }>} */
    this.followed = new Map()
    
    /**
     * Stores data from peers that follow you (followers).
     * Used only to display follower profile/posts, NOT for the feed.
     * The feed includes ONLY peers in this.followed (people you follow).
     */
    this.followerDataCache = new Map()
    
    // Map to correlate socketKey (Hyperswarm) → identityKey (user's real key)
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
  // Lifecycle
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

      // Brand-new user: automatically follow the official Coherence account
      // (when configured). The follow is scheduled on the 'ready' event — which
      // start() only emits at the very end — so follow() never hits the
      // "not ready" guard (a plain setImmediate here would race with the
      // remaining awaits of start()). follow() still adds the official to the
      // follow list even when it is offline (best-effort download), and the user
      // can unfollow it later like any other user. Existing users are never
      // re-followed on restart: this branch only runs when there is no profile
      // yet, so someone who unfollowed the official is left alone.
      if (this.autoFollowKey && HEX64.test(this.autoFollowKey) && this.autoFollowKey !== this.myPublicKeyHex) {
        this.once('ready', () => {
          this.follow(this.autoFollowKey).catch((err) => this.emit('error', err))
        })
      }
    } else if (!existingProfile.value.links) {
      // Migration for existing users: add the links field if it doesn't exist
      existingProfile.value.links = []
      existingProfile.value.updatedAt = Date.now()
      await this.myBee.put('profile', existingProfile.value)
    }

    await this._joinTopic(this.myCore)

    // Reopens the "seeding" of whoever this user already followed in previous sessions.
    // This is awaited (not "fire and forget") to avoid a race where a stop() right
    // after start() would bring the swarm down in the middle of the reconnection
    // process (swarm.join on an already destroyed swarm).
    const profile = await this.myBee.get('profile')
    const followList = (profile && profile.value.followList) || []
    await Promise.all(followList.map((hex) =>
      this._openFollowed(hex, { waitForProfile: true }).catch((err) => this.emit('error', err))
    ))

    // Established user: data is already on disk (writable core + guaranteed profile).
    writeRecoveredMarker(this.dataDir)
    this.ready = true
    this.lifecycleState = 'ready'
    this.emit('ready', { publicKeyHex: this.myPublicKeyHex })
  }

  /**
   * Registers the swarm connection handlers. It is a separate method because the
   * swarm needs to be RECREATED during the recovery storage promotion
   * (see _promoteRecoveryStorage) — and the new swarm needs the same handlers.
   */
  _setupSwarmHandlers() {
    // Every received or initiated P2P connection safely replicates any core this
    // process has loaded (its own + those of followed profiles). See the privacy
    // note in the README: a peer can only request data from a core if it already
    // knows that core's key.

    this.swarm.on('connection', (socket) => {
      const socketKey = socket.remotePublicKey?.toString('hex')
      const connectedAt = Date.now()

      // Handshake to exchange identities
      // { type: 'handshake', identityKey: 'ABC...' }
      //
      // AFTER the handshake, the peer can send:
      // { type: 'follow-request', identityKey: 'ABC...' }  ← asking to be registered as a follower
      //
      // Only registers as a follower if an explicit follow-request is received

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
              // Only registers as a follower if the request is FOR THIS node. The
              // sender sends the follow-request to every peer connected to the
              // followed core (not only the owner) — without checking the targetKey,
              // a node that merely replicates the same core would register followers
              // that never followed it (e.g.: Alice follows Bob; Carol replicates
              // Bob's core; Alice would become "Carol's follower" without having
              // followed her).
              const targetKey = msg.targetKey
              if (!targetKey) {
                console.log('[swarm:connection:follow-request] ⚠️ follow-request without targetKey (old version?); ignored from:', msg.identityKey.slice(0, 16))
                return true
              }
              if (targetKey !== this.myPublicKeyHex) {
                console.log('[swarm:connection:follow-request] ⚠️ Ignored (not for me): from', msg.identityKey.slice(0, 16), 'to', targetKey.slice(0, 16))
                return true
              }
              console.log('[swarm:connection:follow-request] ✓ Received follow-request from:', msg.identityKey.slice(0, 16))
              if (this.lifecycleState === 'ready') {
                this._recordFollower(msg.identityKey).catch((err) => {
                  console.error('[_recordFollower] Error:', err.message)
                })
              }
              return true
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
        return false
      }

      const handleData = (chunk) => {
        if (!handshakeDone) {
          if (processHandshake(chunk)) {
            socket.removeListener('data', handleData)

            // Start replication after a successful handshake
            this._safeReplicate(socket)

            // Wait for a follow-request for up to 3 seconds
            const followRequestTimeout = setTimeout(() => {
              socket.removeListener('data', handleFollowRequest)
              console.log('[swarm:connection:follow-request] ⚠️ Timeout, no follow-request received from:', peerIdentityKey.slice(0, 16))
            }, 3000)

            // Keep listening for a follow-request
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

      // Register the listener BEFORE sending (avoids a race condition)
      socket.on('data', handleData)

      // Send handshake
      socket.write(handshakeMessage + '\n')

      // Timeout if no handshake is received
      const handshakeTimeout = setTimeout(() => {
        if (!handshakeDone) {
          console.log('[swarm:connection:handshake] ⚠️ Timeout, continuing without handshake')
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
   * Starts Corestore replication on a socket, tolerating a store in transition
   * (closed/reopened during the recovery storage promotion). In that case the
   * connection is re-established by the new swarm; here we only avoid the error
   * blowing up inside the 'data' handler.
   */
  _safeReplicate(socket) {
    try {
      if (this.store && !socket.destroyed) this.store.replicate(socket)
    } catch (err) {
      console.log('[swarm:connection] ⚠️ Replication not started (store in transition):', err.message)
    }
  }

  /** Prepares (and cleans) the temporary storage used during identity recovery. */
  _prepareRecoveryStorage() {
    fs.rmSync(this.recoveryStorageDir, { recursive: true, force: true })
    fs.mkdirSync(this.recoveryStorageDir, { recursive: true })
    return this.recoveryStorageDir
  }

  /**
   * Describes the state of each peer connected to a core — diagnostics for
   * identity recovery. For each peer, reports the announced remote length,
   * whether the remote copy covers all blocks 0..remoteLength-1 (complete
   * seeder) and how many blocks are missing from the remote view.
   */
  _describeCorePeers(core) {
    try {
      const peers = (core && core.peers) || []
      return peers.map((peer, idx) => {
        const remoteLength = peer.remoteLength || 0
        let complete = false
        let missing = 0
        if (peer.remoteBitfield && remoteLength > 0) {
          const firstMissing = peer.remoteBitfield.findFirst(false, 0)
          complete = firstMissing < 0 || firstMissing >= remoteLength
          for (let b = 0; b < remoteLength; b++) {
            if (!peer.remoteBitfield.get(b)) missing++
          }
        }
        return {
          idx,
          remoteLength,
          remoteContiguousLength: peer.remoteContiguousLength || 0,
          remoteSynced: !!peer.remoteSynced,
          complete,
          // "empty": announced the core size, but has NO blocks at all
          // (e.g.: another instance of the same identity in recovery mode).
          empty: remoteLength > 0 && missing === remoteLength,
          missing
        }
      })
    } catch {
      return []
    }
  }

  async _recoverFromNetwork(keyPair, coreKey) {
    let lastDownloadedCount = -1
    let stallStreak = 0
    let stalledNotified = false

    // The "incomplete seeder" detection must react to peers entering/leaving:
    // a complete seeder that appears mid-stall cannot stay masked by the
    // previous warning (nor by the progress counters).
    const recoveryCore = this.myCore
    const onPeerAdd = () => {
      lastDownloadedCount = -1
      stallStreak = 0
      const wasStalled = stalledNotified
      stalledNotified = false
      if (wasStalled) {
        // New seeder on the network — clear the warning and go back to "downloading".
        this.recoveryState = 'syncing'
        this.emit('recovery-updated', { state: this.recoveryState, resetStall: true })
      }
    }
    const onPeerRemove = () => {
      lastDownloadedCount = -1
      stallStreak = 0
      stalledNotified = false
    }
    recoveryCore.on('peer-add', onPeerAdd)
    recoveryCore.on('peer-remove', onPeerRemove)

    try {
      while (this.lifecycleState === 'recovery' && !this.recoveryCancelled) {
        try {
          await withTimeout(this.myCore.update({ wait: true }), 3000, null)
          if (this.myCore.length === 0) {
            // No seeder with data right now — go back to the search phase.
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

          // If the announced size is not covered by any connected peer, the
          // seeder that announced it left the network: the length became
          // "stale" and should not be treated as lack of progress (avoids a
          // false stall).
          const connectedPeers = this.myCore.peers || []
          if (connectedPeers.length > 0 &&
              !connectedPeers.some((p) => (p.remoteLength || 0) >= this.myCore.length)) {
            lastDownloadedCount = -1
            stallStreak = 0
            stalledNotified = false
            console.log('[recovery] ⚠️ No connected peer covers length=' + this.myCore.length +
              ' (seeder went down?); resetting stall detection.')
          }

          // A seeder appeared and there is data to download — tell the UI to
          // show the syncing phase ("seeder found, downloading data…").
          this.recoveryState = 'syncing'
          this.emit('recovery-updated', { state: this.recoveryState })

          // Counts blocks arriving DURING the window ('download' event) to
          // distinguish "still downloading" from "stalled" more accurately than
          // counting only after the fixed window.
          let blocksThisIteration = 0
          const onBlockDownload = () => { blocksThisIteration++ }
          this.myCore.on('download', onBlockDownload)

          const download = this.myCore.download({ start: 0, end: this.myCore.length })
          this.recoveryDownload = download
          // catch avoids an "unhandled rejection" if the download is destroyed
          // (timeout or stop()) while done() is still pending.
          const downloaded = await withTimeout(
            download.done().then(() => true).catch(() => false), this.recoveryDownloadTimeoutMs, false
          )
          this.myCore.removeListener('download', onBlockDownload)
          if (this.recoveryDownload === download) this.recoveryDownload = null
          if (this.recoveryCancelled) return

          if (!downloaded) {
            // The download did not finish in time. Count how many blocks actually
            // arrived to distinguish "still downloading" from "incomplete seeder":
            // a partial seeder announces the core size, sends the blocks it has
            // and leaves the rest hanging forever.
            const len = this.myCore.length
            let have = 0
            if (len > 0) {
              for (let i = 0; i < len; i++) {
                if (await this.myCore.has(i)) have++
              }
            }

            const progress = blocksThisIteration > 0 || have > lastDownloadedCount
            if (have < len) {
              const peersInfo = this._describeCorePeers(this.myCore)
              const desc = peersInfo.map((p) =>
                `peer#${p.idx} len=${p.remoteLength} complete=${p.complete} empty=${p.empty} missing=${p.missing}`).join(' | ')
              console.log(`[recovery] incomplete download: ${have}/${len} blocks ` +
                `(progress=${progress}, streak=${stallStreak})` + (desc ? ` | ${desc}` : ''))

              if (progress) {
                // There is progress — some peer is sending blocks.
                lastDownloadedCount = have
                stallStreak = 0
                stalledNotified = false
              } else {
                // No progress since the previous attempt: the seeders on the
                // network have INCOMPLETE copies and cannot send what's missing.
                stallStreak++
                if (stallStreak >= 3 && !stalledNotified) {
                  stalledNotified = true
                  this.recoveryState = 'stalled'
                  console.log(`[recovery] ⚠️ Incomplete seeder: received ${have}/${len} blocks.` +
                    (desc ? ` Connected peers: ${desc}` : ' (no connected peers)'))
                  this.emit('recovery-updated', {
                    state: this.recoveryState,
                    downloaded: have,
                    length: len,
                    peers: peersInfo
                  })
                }
              }
            }

            // Ends this iteration's download range (the next loop creates
            // another one) to avoid accumulating overlapping ranges requesting
            // the blocks.
            try { download.destroy() } catch { /* ignore */ }

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
            // Only now — with the data actually recovered — the temporary storage is
            // promoted to the final location (dataDir/corestore).
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
    } finally {
      recoveryCore.removeListener('peer-add', onPeerAdd)
      recoveryCore.removeListener('peer-remove', onPeerRemove)
    }
  }

  /**
   * Promotes the temporary recovery storage to the final location.
   * Must only be called AFTER profile/posts were actually recovered from the network.
   * Closes the temporary Corestore (releases the RocksDB handles — required to
   * rename on Windows), moves the folder and reopens the Corestore at the final
   * location.
   *
   * IMPORTANT: the swarm is also recreated here. Existing connections carry
   * replication streams bound to the OLD store (which will be closed); if they
   * stay alive, Hyperswarm keeps the public-key deduplication (one connection
   * per peer) and cores opened after the promotion never get a replication peer
   * — the feed stays without remote posts and the following list stuck on
   * "syncing". By recreating the swarm with the handlers re-registered, new
   * connections replicate the promoted store (which already contains the
   * followed cores).
   */
  async _promoteRecoveryStorage() {
    // Soft teardown of the swarm BEFORE closing the store: destroys the
    // connections, the discoveries and the DHT server, but PRESERVES the DHT
    // (which may be external, e.g. a testnet node in tests). A full swarm
    // destroy() would kill the DHT and the new swarm would have no network.
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
      // Fallback (e.g. different volume or OS lock): copy and remove.
      fs.cpSync(this.recoveryStorageDir, this.storageDir, { recursive: true })
      fs.rmSync(this.recoveryStorageDir, { recursive: true, force: true })
    }
    this.store = new Corestore(this.storageDir)
    await this.store.ready()

    // Recreates the swarm reusing the same DHT and keyPair, and re-registers the
    // handlers. The new swarm is born with an empty _allConnections, so new
    // connections are opened and replicate the promoted store.
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
    // Removes leftover residue from an abandoned recovery (the temporary folder
    // never becomes `corestore`; if recovery succeeded it was already renamed there).
    fs.rmSync(this.recoveryStorageDir, { recursive: true, force: true })
      this.lifecycleState = 'stopped'
    })()

    return this.stopPromise
  }

  /** Shareable public key (hex) — this is what a friend pastes to follow you. */
  get myPublicKeyHex() {
    return this.myCore.key.toString('hex')
  }

  async _joinTopic(core) {
    const discovery = this.swarm.join(core.discoveryKey, { server: true, client: true })
    const done = core.findingPeers()
    discovery.flushed().then(done, done)
    return discovery
  }
  
  // Store which core we published (to identify it in swarm.on('connection'))
  get myDiscoveryKey() {
    return this.myCore?.discoveryKey?.toString('hex')
  }

  /**
   * Registers a follower in the Hyperbee when a peer connects to replicate your core.
   * Writes a persistent record: followers!<pubkey> = { connectedAt, lastSeen, isActive }
   * Also automatically loads the follower's data (profile, posts) to display in the UI.
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
      console.log('[_recordFollower] ✓ Registered:', pubKeyHex.slice(0, 16))
      
      // Automatically load the new follower's data (profile, posts)
      // This lets the UI show follower info without requiring a follow
      // Uses _loadFollowerData with isFollower: true (not _openFollowed) to avoid sending a follow-request back
      this._loadFollowerData(pubKeyHex, true).catch((err) => {
        console.log('[_recordFollower] ⚠️ Error loading follower data:', err.message)
      })
    })
    this.followerWritePromise = operation.catch(() => {})
    try {
      await operation
    } catch (err) {
      console.error('[_recordFollower] Error registering:', err.message)
    }
  }

  /**
   * Loads all follower records from your own Hyperbee.
   * Returns: [{ publicKeyHex, connectedAt, lastSeen }, ...]
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
      console.error('[_loadFollowersFromRecords] Error:', err.message)
      return []
    }
  }

  /**
   * Loads a peer's data (core + bee) and sends a follow-request.
   * Called when you explicitly follow someone.
   */
  async _openFollowed(pubKeyHex, { waitForProfile = false } = {}) {
    const entry = await this._loadFollowerData(pubKeyHex)
    
    // Send a follow-request to all peers connected on this core
    // This explicitly states that we want to be registered as a follower
    this._sendFollowRequestsToPeers(pubKeyHex, entry).catch((err) => {
      console.log('[_openFollowed] Failed to send follow-requests:', err.message)
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

    // Important: even with the profile already read, ensure ALL blocks of the
    // followed core are on disk. Without this, this peer becomes an "incomplete
    // seeder": it announces the core size, serves only the blocks it downloaded
    // and stalls the owner's identity recovery (which waits for blocks nobody on
    // the network has).
    if (profile) await this._ensureFullDownload(entry)

    return profile
  }

  /**
   * Downloads (best-effort) all blocks of a followed peer's core, so that this
   * node serves as a COMPLETE seeder when the owner is offline.
   * Without this, a follower can end up with a partial copy (e.g. only the
   * entries the UI read) and fail to serve an identity recovery.
   */
  async _ensureFullDownload(entry, timeoutMs = Math.max(this.readTimeoutMs, 15000)) {
    const { core } = entry
    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') return false

    // If the local copy is already complete, no need to wait for the network.
    const localLen = core.length
    if (localLen > 0) {
      let complete = true
      for (let i = 0; i < localLen; i++) {
        if (!(await core.has(i))) { complete = false; break }
      }
      if (complete) return true
    }

    // Incomplete local copy (or size still unknown): discover the real size
    // over the network and download the missing blocks, trying until the time limit.
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
   * Loads a peer's data (core + bee) without sending a follow-request.
   * @param {string} pubKeyHex - Peer's public key
   * @param {boolean} isFollower - If true, stores in followerDataCache (follower who doesn't follow you).
   *                               If false, stores in followed (peer you follow).
   * Used internally to sync data from followers and connected peers.
   */
  async _loadFollowerData(pubKeyHex, isFollower = false) {
    const targetMap = isFollower ? this.followerDataCache : this.followed
    const existing = targetMap.get(pubKeyHex)
    if (existing) return existing

    const core = this.store.get({ key: Buffer.from(pubKeyHex, 'hex') })
    await core.ready()
    const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })

    // Creates the entry BEFORE registering the handlers: 'peer-add' can fire as
    // soon as the topic is announced, and the handler referenced it in TDZ
    // ("Cannot access 'entry' before initialization") — the follow-request to
    // the new peer was silently lost.
    const entry = { core, bee, discovery: null }

    core.on('append', () => this.emit('feed-updated'))
    // Resends the follow-request on every new peer connected to the followed core:
    // the initial send may only reach part of the peers (discovery is
    // incremental), and those who connect later wouldn't know this user follows
    // them.
    // Uses the DIRECT send (no retry loop): each peer-add would trigger a new
    // recursive loop — with infinite retry that would become a pile of timers
    // and a sea of "Waiting for peers…" in the log.
    core.on('peer-add', () => {
      this.emit('peers-changed')
      if (!isFollower && entry.core) {
        this._sendFollowRequestsNow(pubKeyHex, entry)
      }
    })
    core.on('peer-remove', () => this.emit('peers-changed'))

    entry.discovery = await this._joinTopic(core)
    targetMap.set(pubKeyHex, entry)

    return entry
  }

  /** Sends the follow-request to the peers ALREADY connected to the core (no retry). */
  _sendFollowRequestsNow(pubKeyHex, entry) {
    const { core } = entry
    const peers = core.peers || []
    if (peers.length === 0) return

    // The follow-request declares: "identityKey is following the owner of the
    // targetKey core". The target is mandatory because this node sends the
    // request to ALL peers connected to the followed core (the owner and also
    // other nodes replicating the same core) — and only the owner
    // (targetKey === itself) should register the follower. Without the target,
    // any peer connected to the core would register a follower that never
    // followed it.
    const followRequest = JSON.stringify({
      type: 'follow-request',
      identityKey: this.myPublicKeyHex,
      targetKey: pubKeyHex
    })
    let sent = 0
    for (const peer of peers) {
      if (peer.stream && !peer.stream.destroyed) {
        try {
          peer.stream.write(followRequest + '\n')
          sent++
        } catch (e) {
          // Ignore
        }
      }
    }

    if (sent > 0) {
      console.log('[_sendFollowRequestsToPeers] ✓ Sent follow-request to', sent, 'peer(s) on:', pubKeyHex.slice(0, 16))
    }
  }

  /** Sends the follow-request to connected peers (recursive, retries if no peers are found) */
  async _sendFollowRequestsToPeers(pubKeyHex, entry, attempts = 0) {
    const { core } = entry
    const peers = core.peers || []

    if (peers.length > 0) {
      this._sendFollowRequestsNow(pubKeyHex, entry)
      return
    }

    // No peer connected yet — try with backoff until a time limit.
    // An INFINITE retry (like before) makes the app stay "forever syncing" and
    // fills the log with "Waiting for peers… (attempt N)" without ever resolving
    // when the profile owner is offline/unreachable.
    // DHT discovery is incremental: when a peer connects, the `peer-add` event
    // (in _loadFollowerData) resends the follow-request — so stopping the
    // polling here doesn't miss requests that arrive later.
    const MAX_ATTEMPTS = 15 // with backoff (500ms→5s) ≈ 1 minute of polling
    if (
      attempts >= MAX_ATTEMPTS ||
      this.lifecycleState === 'stopping' ||
      this.lifecycleState === 'stopped' ||
      core.closed
    ) {
      if (attempts === MAX_ATTEMPTS) {
        console.log('[_sendFollowRequestsToPeers] ⚠️ Attempt limit reached (peer offline?) for:', pubKeyHex.slice(0, 16))
      }
      return
    }
    const delay = Math.min(500 * (attempts + 1), 5000)
    console.log('[_sendFollowRequestsToPeers] Waiting for peers for:', pubKeyHex.slice(0, 16), '(attempt', attempts + 1, ')')
    await new Promise(resolve => setTimeout(resolve, delay))
    return this._sendFollowRequestsToPeers(pubKeyHex, entry, attempts + 1)
  }

  async follow(pubKeyHex) {
    return this._runOperation(async () => {
      pubKeyHex = String(pubKeyHex || '').trim().toLowerCase()
      if (!HEX64.test(pubKeyHex)) throw new Error('Chave pública inválida (esperado hex de 64 caracteres).')
      if (pubKeyHex === this.myPublicKeyHex) throw new Error('Você não pode seguir a si mesmo.')

      await this._openFollowed(pubKeyHex)

      // Ensures the local copy of the followed core stays COMPLETE (all blocks),
      // so this node can serve as a complete seeder in a future recovery.
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
  // Profile
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
        // Limit to a maximum of 3 links
        value.links = Array.isArray(links) ? links.slice(0, 3) : []
      }
      value.updatedAt = Date.now()
      await this.myBee.put('profile', value)
      this.emit('profile-updated')
      return value
    })
  }

  /** Reads the profile of any key (own, followed or follower), with a timeout if not synced yet. */
  async getProfile(pubKeyHex) {
    return this._runOperation(async () => {
      if (pubKeyHex === this.myPublicKeyHex) {
        const entry = await this.myBee.get('profile')
        const myProf = { publicKeyHex: this.myPublicKeyHex, ...(entry ? entry.value : {}) }
        console.log('[getProfile] Returning MY profile:', myProf.nome)
        return myProf
      }

      console.log('[getProfile] Fetching profile from:', pubKeyHex.slice(0, 16))
      // Look first in peers you follow
      let entry = this.followed.get(pubKeyHex)

      // If not found, look in followers (followerDataCache)
      if (!entry) {
        entry = this.followerDataCache.get(pubKeyHex)
      }

      console.log('[getProfile] Entry found?', !!entry)

      if (!entry) {
        console.log('[getProfile] ⚠️ Entry not found in this.followed nor in this.followerDataCache')
        return null
      }

      const result = await withTimeout(entry.bee.get('profile'), this.readTimeoutMs, null)
      // A synced profile ALWAYS has `nome` (the app creates one with a default).
      // If the value didn't arrive (block not downloaded yet / partial copy) or
      // the object is empty, the peer is "syncing" — do NOT return a profile
      // without a name, otherwise the UI shows "sem nome" instead of "sincronizando…".
      const value = result && result.value
      const synced = !!value && typeof value === 'object' && value.nome !== undefined
      const finalProfile = synced
        ? { publicKeyHex: pubKeyHex, ...value }
        : { publicKeyHex: pubKeyHex, sincronizando: true }
      console.log('[getProfile] ✓ Profile returned:', { nome: finalProfile.nome, sincronizando: finalProfile.sincronizando, pubKeyHex: pubKeyHex.slice(0, 16) })
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
   * Returns the list of users who have connected to your Hypercore.
   * Reads persistent Hyperbee records (followers!<pubkey>).
   */
  async getFollowers() {
    return this._runOperation(async () => {
      const followers = await this._loadFollowersFromRecords()
      console.log(`[getFollowers] Returning ${followers.length} followers (keys: ${followers.map(f => f.publicKeyHex.slice(0, 12)).join(', ')})`)
      return followers
    })
  }

  /**
   * Returns the SOCIAL GRAPH of a user: who they follow (the followList stored
   * in their own profile) and who follows them (the followers!<pubkey> records
   * in their own Hyperbee). Cores are public in the P2P model, so this reads
   * the user's own bee directly — the same path used by the transitive search.
   *
   * @param {string} pubKeyHex - the user whose social graph we want
   * @returns {Promise<{publicKeyHex, nome, following: string[], followers: string[], sincronizando: boolean}|null>}
   */
  async getUserSocial(pubKeyHex) {
    return this._runOperation(async () => {
      // My own social graph — read directly from my bee.
      if (pubKeyHex === this.myPublicKeyHex) {
        const myProfile = await this.myBee.get('profile')
        const value = myProfile && myProfile.value
        const following = (value && Array.isArray(value.followList)) ? value.followList : []
        const followerRecords = await this._loadFollowersFromRecords()
        return {
          publicKeyHex: this.myPublicKeyHex,
          nome: (value && value.nome) || null,
          following,
          followers: followerRecords.map((f) => f.publicKeyHex),
          sincronizando: false
        }
      }

      // Other users: open their core on demand if not loaded yet (same path as
      // the transitive search, no follow-request is sent).
      let entry = this.followed.get(pubKeyHex) || this.followerDataCache.get(pubKeyHex)
      if (!entry) {
        try {
          entry = await this._loadFollowerData(pubKeyHex, true)
        } catch (err) {
          return null
        }
      }
      if (!entry) return null

      const profileResult = await withTimeout(entry.bee.get('profile'), this.readTimeoutMs, null)
      const value = profileResult && profileResult.value
      const following = (value && Array.isArray(value.followList)) ? value.followList : []

      // Followers of this user (followers!<pubkey> records in their bee).
      let followers = []
      try {
        const stream = entry.bee.createReadStream({
          gte: FOLLOWERS_PREFIX,
          lt: FOLLOWERS_PREFIX + '\uffff'
        })
        const records = await collectWithTimeout(stream, this.readTimeoutMs)
        followers = records
          .filter((e) => e.value && e.value.isActive)
          .map((e) => pubKeyFromFollowerKey(e.key))
      } catch (err) {
        // Partial/offline copy — return what we have.
      }

      return {
        publicKeyHex: pubKeyHex,
        nome: value && value.nome,
        following,
        followers,
        sincronizando: !value || value.nome === undefined
      }
    })
  }

  /**
   * Searches users TRANSITIVELY over the follow graph.
   *
   * Starting from who this node follows (degree 1) and its followers, it walks
   * the graph in BOTH directions — the followLists (who each profile follows)
   * and the follower records (who follows each profile) — loading profiles on
   * demand (opens the user's core and reads the profile), up to maxDepth hops.
   * Thus, in an Alice→Bob→Carol→Dave scenario, any node finds the others: Alice
   * finds Carol (via Bob) and Dave (via Carol); Dave finds Bob and Alice by
   * crossing followers in reverse — there is always a common point.
   *
   * @param {string} query - term to match (name, bio or key prefix)
   * @param {{ maxDepth?: number, maxResults?: number, timeoutMs?: number }} opts
   * @returns {Promise<Array<{publicKeyHex, nome, bio, depth, via}>>}
   */
  async searchUsers(query, { maxDepth = 3, maxResults = 30, timeoutMs = 6000 } = {}) {
    return this._runOperation(async () => {
      const q = String(query || '').trim().toLowerCase()
      if (!q) return []

      const resultMap = new Map()
      const visited = new Set()
      const queue = []

      const matches = (profile) => {
        const nome = String(profile.nome || '').toLowerCase()
        const bio = String(profile.bio || '').toLowerCase()
        return nome.includes(q) || bio.includes(q) || String(profile.publicKeyHex).toLowerCase().includes(q)
      }

      // Reads a key's profile, opening the core on demand if it's not loaded
      // yet (same path as the follower auto-load).
      const loadProfile = async (key, via) => {
        let entry = this.followed.get(key) || this.followerDataCache.get(key)
        if (!entry) {
          try {
            entry = await this._loadFollowerData(key, true)
          } catch {
            return null
          }
        }
        if (!entry) return null
        const result = await withTimeout(entry.bee.get('profile'), timeoutMs, null)
        const value = result && result.value
        if (!value || value.nome === undefined) return null

        // Profile's followers (followers!<pubkey> records) — allows crossing the
        // chain in REVERSE (e.g.: Dave discovers Bob via Carol's followers, and
        // Alice via Bob's followers).
        let followers = []
        try {
          const stream = entry.bee.createReadStream({
            gte: FOLLOWERS_PREFIX,
            lt: FOLLOWERS_PREFIX + '\uffff'
          })
          const records = await collectWithTimeout(stream, timeoutMs)
          followers = records
            .filter((e) => e.value && e.value.isActive)
            .map((e) => pubKeyFromFollowerKey(e.key))
        } catch {
          // No readable followers (offline/partial) — continue forward only.
        }
        return {
          publicKeyHex: key,
          nome: value.nome,
          bio: value.bio || '',
          avatar: value.avatar || null,
          links: value.links || [],
          followList: value.followList || [],
          followers,
          via
        }
      }

      // Own profile (degree 0)
      const myProfile = await this.getProfile(this.myPublicKeyHex)
      if (myProfile && matches({ publicKeyHex: this.myPublicKeyHex, nome: myProfile.nome, bio: myProfile.bio })) {
        resultMap.set(this.myPublicKeyHex, {
          publicKeyHex: this.myPublicKeyHex,
          nome: myProfile.nome,
          bio: myProfile.bio || '',
          depth: 0,
          via: null
        })
      }

      // Seeds (degree 1): who I follow + my followers
      const following = await this.getFollowingList()
      for (const p of following) queue.push({ key: p.publicKeyHex, depth: 1, via: null })
      const followers = await this.getFollowers()
      for (const f of followers) queue.push({ key: f.publicKeyHex, depth: 1, via: null })

      // BFS over the follow chain (loads profiles and explores the followLists)
      let index = 0
      while (index < queue.length && resultMap.size < maxResults) {
        const { key, depth, via } = queue[index++]
        if (visited.has(key) || key === this.myPublicKeyHex) continue
        visited.add(key)

        const profile = await loadProfile(key, via)
        if (!profile) continue

        if (matches(profile) && !resultMap.has(key)) {
          resultMap.set(key, {
            publicKeyHex: key,
            nome: profile.nome,
            bio: profile.bio,
            depth,
            via
          })
        }

        if (depth < maxDepth) {
          // Crosses in BOTH directions: who this profile follows (followList) and
          // who follows it (followers) — so any node in the chain finds the
          // others, regardless of the direction of the follows.
          const neighbors = new Set([...profile.followList, ...profile.followers])
          for (const next of neighbors) {
            if (next && next !== this.myPublicKeyHex && !visited.has(next)) {
              queue.push({ key: next, depth: depth + 1, via: key })
            }
          }
        }
      }

      return [...resultMap.values()]
    })
  }

  /** Returns all posts of a specific user (followed or follower). */
  async getPostsOf(pubKeyHex) {
    return this._runOperation(async () => {
      if (pubKeyHex === this.myPublicKeyHex) {
        return this._postsFrom(pubKeyHex, this.myBee)
      }
      // Look first in peers you follow
      let entry = this.followed.get(pubKeyHex)

      // If not found, look in followers
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

  /** Builds the feed: own posts + posts from people you follow, most recent first. */
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

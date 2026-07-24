'use strict'
const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const dhtLib = require('./dht')
const hashchain = require('./hashchain')
const { Identity } = require('./identity')

const MAX_BACKFILL_CHAPTERS = 25 // limite de segurança para não "andar pra trás" indefinidamente
const MAX_FOLLOWING_IN_POINTER = 10 // orçamento de bytes do BEP44 (~1000 bytes) é limitado
const MAX_DISPLAY_NAME_LEN = 40

/**
 * Constrói o ponteiro público (BEP44) com o estado mais recente da cadeia
 * própria: até onde ela vai (chainSeq/chainHash), qual o capítulo mais novo
 * disponível via torrent (para os seguidores baixarem), o nome de exibição
 * (opcional) e uma amostra de quem você segue.
 *
 * Essa amostra de "quem eu sigo" é a base da busca de usuários: como não há
 * nenhum diretório central, cada pessoa descobre novos usuários por gossip
 * ("amigo de amigo") ao sincronizar quem ela já segue.
 */
function buildOwnPointer (store) {
  const chain = store.data.ownChain
  const chapters = readOwnChapterIndex()
  const last = chain[chain.length - 1]
  if (!last) return null
  const lastChapter = chapters[chapters.length - 1]
  const displayName = (store.data.profile && store.data.profile.displayName || '').slice(0, MAX_DISPLAY_NAME_LEN)
  const following = [...store.data.follows]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, MAX_FOLLOWING_IN_POINTER)
    .map(f => f.pubkeyHex)
  return {
    chainSeq: last.seq,
    chainHash: last.hash,
    latest: lastChapter ? { start: lastChapter.start, end: lastChapter.end, infohash: lastChapter.infohash } : null,
    prevInfohash: lastChapter ? lastChapter.prevInfohash : '',
    displayName,
    following,
    ts: Date.now()
  }
}

function readOwnChapterIndex () {
  const p = paths.chaptersOwnIndex()
  if (!fs.existsSync(p)) return []
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return [] }
}

async function publishOwnPointer (dht, identity, store) {
  const pointer = buildOwnPointer(store)
  if (!pointer) {
    console.log('[discovery] sem posts para publicar ainda')
    return null
  }
  if (!pointer.latest) {
    console.log('[discovery] capítulo aberto ainda não foi selado, nada a publicar')
    return null
  }
  console.log('[discovery] publicando pointer próprio:', { chainSeq: pointer.chainSeq, latestInfohash: pointer.latest.infohash.slice(0, 8) })
  
  try {
    const result = await dhtLib.publishPointer(dht, identity, pointer)
    console.log('[discovery] pointer publicado com sucesso no DHT')
    return result
  } catch (err) {
    // Em redes isoladas (sem DHT), descoberta será via LSD/PEX quando peers se conectarem
    console.warn('[discovery] DHT indisponível:', err.message)
    console.log('[discovery] posts serão descobertos via LSD/PEX quando peers se conectarem na mesma rede')
    return null
  }
}

/**
 * Consulta o DHT pelo estado de um usuário seguido e, se houver novidade,
 * baixa os capítulos que faltam (via WebTorrent), verifica a cadeia de
 * assinaturas/hashes e ingere os posts no cache local do feed.
 */
async function pollFollow ({ dht, torrentClient, store }, follow) {
  const startTime = Date.now()
  const shortKey = follow.pubkeyHex.slice(0, 8)
  console.log(`[discovery] poll iniciado para follow ${shortKey}`)
  
  let resolved
  try {
    resolved = await dhtLib.resolvePointer(dht, follow.pubkeyHex)
  } catch (err) {
    console.log(`[discovery] pointer não encontrado via DHT para ${shortKey} (pode estar via LSD/PEX)`)
    resolved = null
  }
  
  follow.lastPolledAt = Date.now()
  
  if (!resolved || !resolved.pointer) {
    console.log(`[discovery] pointer não encontrado para ${shortKey} (esperado em cold-start ou rede isolada)`)
    return { updated: false }
  }

  const { pointer } = resolved
  console.log(`[discovery] pointer resolvido para ${shortKey}:`, { chainSeq: pointer.chainSeq, hasLatest: !!pointer.latest })
  
  // Nome de exibição e amostra de "quem essa pessoa segue" chegam mesmo que a
  // cadeia de posts não tenha novidade — é assim que a busca de usuários
  // (gossip amigo-de-amigo) se propaga pela rede.
  ingestProfileGossip(store, follow, pointer)

  if (!pointer.latest) {
    console.log(`[discovery] ${shortKey} não tem capítulo publicado ainda`)
    return { updated: false }
  }
  
  if (follow.lastChainHash === pointer.chainHash) {
    console.log(`[discovery] ${shortKey} sem novidades (mesmo chainHash)`)
    return { updated: false }
  }

  console.log(`[discovery] ${shortKey} tem novidade! chainHash anterior: ${follow.lastChainHash ? follow.lastChainHash.slice(0, 8) : '(nenhum)'} → novo: ${pointer.chainHash.slice(0, 8)}...`)

  // Monta a lista de capítulos a baixar andando pelo encadeamento prevInfohash
  // de trás pra frente, até achar o último capítulo já conhecido (ou o limite).
  const toFetch = []
  let cursor = pointer.latest
  let safety = 0
  while (cursor && cursor.infohash && cursor.infohash !== follow.lastInfohash && safety < MAX_BACKFILL_CHAPTERS) {
    toFetch.unshift(cursor)
    if (!cursor.prevInfohash) break
    cursor = { infohash: cursor.prevInfohash }
    safety++
  }

  console.log(`[discovery] ${shortKey} precisa baixar ${toFetch.length} capítulo(s)`)

  const destBase = path.join(paths.cacheRoot(), follow.pubkeyHex)
  let ingestedAny = false
  let prevLastPost = findLastKnownPost(store, follow.pubkeyHex)

  for (let idx = 0; idx < toFetch.length; idx++) {
    const item = toFetch[idx]
    const destDir = path.join(destBase, item.infohash)
    let torrent
    try {
      console.log(`[discovery] baixando capítulo ${idx + 1}/${toFetch.length} (${item.infohash.slice(0, 8)}...) de ${shortKey}`)
      torrent = await torrentClient.downloadChapter(item.infohash, destDir)
      console.log(`[discovery] capítulo ${item.infohash.slice(0, 8)} baixado com sucesso`)
    } catch (err) {
      console.error(`[discovery] falha ao baixar capítulo ${item.infohash.slice(0, 8)} de ${shortKey}:`, err.message)
      break // para no primeiro erro; tenta de novo no próximo poll
    }

    const chapterJsonPath = findChapterJson(destDir)
    if (!chapterJsonPath) {
      console.error('[discovery] chapter.json não encontrado em', destDir)
      break
    }
    
    const chapter = JSON.parse(fs.readFileSync(chapterJsonPath, 'utf8'))

    if (chapter.pubkeyHex !== follow.pubkeyHex) {
      console.error('[discovery] capítulo com pubkey divergente, ignorando')
      break
    }

    const computedHash = require('crypto').createHash('sha256').update(JSON.stringify(chapter.posts)).digest('hex')
    if (computedHash !== chapter.chapterHash) {
      console.error('[discovery] chapterHash não confere, descartando')
      break
    }
    
    const validChapterSig = Identity.verify(Buffer.from(chapter.chapterHash, 'hex'), Buffer.from(chapter.sig, 'hex'), Buffer.from(follow.pubkeyHex, 'hex'))
    if (!validChapterSig) {
      console.error('[discovery] assinatura do capítulo inválida, descartando')
      break
    }

    const verifyResult = hashchain.verifySequence(chapter.posts, Identity.verify, prevLastPost)
    if (!verifyResult.ok) {
      console.error('[discovery] cadeia de posts inválida:', verifyResult.reason)
      break
    }

    console.log(`[discovery] ${shortKey} capítulo ${item.infohash.slice(0, 8)} verificado: ${chapter.posts.length} posts, ingesting...`)
    for (const post of chapter.posts) {
      store.data.feedCache.push({ ...post })
    }
    prevLastPost = chapter.posts[chapter.posts.length - 1]
    follow.lastInfohash = item.infohash
    follow.lastSeq = prevLastPost.seq
    follow.lastChainHash = prevLastPost.hash
    ingestedAny = true
  }

  if (ingestedAny) {
    dedupeFeedCache(store)
    await store.save()
    const elapsedMs = Date.now() - startTime
    console.log(`[discovery] poll de ${shortKey} concluído com sucesso em ${elapsedMs}ms: ${toFetch.length} capítulo(s), ${prevLastPost ? prevLastPost.seq + 1 : '?'} posts totais`)
  }
  return { updated: ingestedAny }
}

function findChapterJson (dir) {
  if (!fs.existsSync(dir)) return null
  const direct = path.join(dir, 'chapter.json')
  if (fs.existsSync(direct)) return direct
  // WebTorrent grava dentro de uma subpasta com o nome da pasta original selada
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.isDirectory()) {
      const nested = path.join(dir, e.name, 'chapter.json')
      if (fs.existsSync(nested)) return nested
    }
  }
  return null
}

function findLastKnownPost (store, pubkeyHex) {
  const posts = store.data.feedCache.filter(p => p.pubkeyHex === pubkeyHex).sort((a, b) => a.seq - b.seq)
  return posts.length ? posts[posts.length - 1] : null
}

function dedupeFeedCache (store) {
  const seen = new Set()
  store.data.feedCache = store.data.feedCache.filter(p => {
    const key = `${p.pubkeyHex}:${p.seq}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Atualiza o diretório local de usuários conhecidos ("knownUsers") a partir
 * do ponteiro de um follow: o próprio nome de exibição dele, e a amostra de
 * quem ELE segue (gossip amigo-de-amigo). Não depende de nenhum servidor de
 * busca central — a rede de descoberta é o próprio grafo social.
 */
function ingestProfileGossip (store, follow, pointer) {
  if (typeof pointer.displayName === 'string') follow.remoteDisplayName = pointer.displayName || null
  upsertKnownUser(store, follow.pubkeyHex, follow.remoteDisplayName || null, 'direct')
  if (Array.isArray(pointer.following)) {
    for (const pubkeyHex of pointer.following) {
      if (typeof pubkeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkeyHex)) continue
      upsertKnownUser(store, pubkeyHex, null, follow.pubkeyHex)
    }
  }
}

function upsertKnownUser (store, pubkeyHex, displayName, discoveredVia) {
  const list = store.data.knownUsers
  let entry = list.find(u => u.pubkeyHex === pubkeyHex)
  if (!entry) {
    entry = { pubkeyHex, displayName: displayName || null, discoveredVia, lastSeen: Date.now() }
    list.push(entry)
  } else {
    if (displayName) entry.displayName = displayName
    entry.lastSeen = Date.now()
  }
}

/**
 * Busca local de usuários: combina quem você já segue com o diretório
 * "knownUsers" descoberto por gossip (amigo-de-amigo). Sem consulta, retorna
 * os conhecidos mais recentes; com consulta, filtra por nome ou prefixo da
 * chave pública.
 */
function searchUsers (store, ownPubkeyHex, query, limit = 30) {
  const q = (query || '').trim().toLowerCase()
  const byKey = new Map()
  const add = entry => {
    if (entry.pubkeyHex === ownPubkeyHex) return
    const existing = byKey.get(entry.pubkeyHex)
    if (!existing || (!existing.displayName && entry.displayName)) byKey.set(entry.pubkeyHex, entry)
  }
  for (const f of store.data.follows) {
    add({ pubkeyHex: f.pubkeyHex, displayName: f.remoteDisplayName || null, alias: f.alias, discoveredVia: 'direct', lastSeen: f.lastPolledAt || f.addedAt })
  }
  for (const u of store.data.knownUsers) {
    add({ pubkeyHex: u.pubkeyHex, displayName: u.displayName, alias: null, discoveredVia: u.discoveredVia, lastSeen: u.lastSeen })
  }
  const followingSet = new Set(store.data.follows.map(f => f.pubkeyHex))
  let results = [...byKey.values()]
  if (q) {
    results = results.filter(u =>
      (u.displayName && u.displayName.toLowerCase().includes(q)) ||
      (u.alias && u.alias.toLowerCase().includes(q)) ||
      u.pubkeyHex.toLowerCase().startsWith(q)
    )
  }
  results.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
  return results.slice(0, limit).map(u => ({
    pubkeyHex: u.pubkeyHex,
    displayName: u.displayName || null,
    alias: u.alias || null,
    isFollowing: followingSet.has(u.pubkeyHex),
    discoveredVia: u.discoveredVia
  }))
}

module.exports = { buildOwnPointer, publishOwnPointer, pollFollow, searchUsers }

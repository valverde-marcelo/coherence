'use strict'
const crypto = require('crypto')

const GENESIS_HASH = '0'.repeat(64)

/**
 * "Hash-chain" pessoal assinada — a ideia boa de blockchain (integridade e
 * histórico verificável de forma independente) sem o custo/latência de um
 * consenso global, que uma rede social não precisa: cada usuário é o único
 * autoridade sobre sua própria cadeia.
 *
 * Cada post referencia o hash do post anterior (prevHash) e é assinado com a
 * chave privada ed25519 do autor. Qualquer peer pode verificar, offline, que:
 *   1) o post foi de fato criado pelo dono da chave pública (assinatura)
 *   2) a ordem/histórico não foi adulterado (encadeamento de hashes)
 */

function canonicalize (post) {
  // Serialização determinística (ordem de campos fixa) usada para hash/assinatura.
  const media = (post.media || []).map(m => `${m.sha256}:${m.name}:${m.mime}:${m.size}`).join(',')
  return `${post.seq}|${post.ts}|${post.type}|${post.text || ''}|${media}|${post.prevHash}|${post.pubkeyHex}`
}

function computeHash (post) {
  return crypto.createHash('sha256').update(canonicalize(post)).digest('hex')
}

/**
 * Cria e assina o próximo post da cadeia do usuário.
 * @param {Identity} identity
 * @param {Array} chain - cadeia local existente (ownChain), ordenada por seq crescente
 * @param {{type:string, text?:string, media?:Array}} input
 */
function createSignedPost (identity, chain, input) {
  const last = chain[chain.length - 1]
  const seq = last ? last.seq + 1 : 0
  const prevHash = last ? last.hash : GENESIS_HASH
  const post = {
    seq,
    ts: Date.now(),
    type: input.type,
    text: input.text || '',
    media: input.media || [],
    prevHash,
    pubkeyHex: identity.publicKeyHex
  }
  post.hash = computeHash(post)
  post.sig = identity.sign(Buffer.from(post.hash, 'hex')).toString('hex')
  return post
}

/**
 * Verifica um único post: assinatura válida e hash bate com o conteúdo.
 */
function verifyPost (post, verifyFn) {
  const expectedHash = computeHash(post)
  if (expectedHash !== post.hash) return false
  return verifyFn(Buffer.from(post.hash, 'hex'), Buffer.from(post.sig, 'hex'), Buffer.from(post.pubkeyHex, 'hex'))
}

/**
 * Verifica encadeamento entre dois posts consecutivos da mesma cadeia.
 */
function verifyLink (prevPost, post) {
  const expectedPrevHash = prevPost ? prevPost.hash : GENESIS_HASH
  const expectedSeq = prevPost ? prevPost.seq + 1 : 0
  return post.prevHash === expectedPrevHash && post.seq === expectedSeq
}

/**
 * Verifica uma sequência (array) de posts em ordem, incluindo o elo com o
 * último post já conhecido localmente (pode ser null se for o primeiro contato).
 */
function verifySequence (posts, verifyFn, knownPrev = null) {
  let prev = knownPrev
  for (const post of posts) {
    if (!verifyPost(post, verifyFn)) return { ok: false, reason: `assinatura/hash inválida no seq ${post.seq}` }
    if (prev && !verifyLink(prev, post)) return { ok: false, reason: `encadeamento quebrado no seq ${post.seq}` }
    prev = post
  }
  return { ok: true }
}

module.exports = { GENESIS_HASH, computeHash, createSignedPost, verifyPost, verifyLink, verifySequence, canonicalize }

'use strict'
const fs = require('fs')
const path = require('path')
const paths = require('./paths')

/**
 * Verifica se um post foi selado em um capítulo publicado
 */
function isPostSealed (ownChainSeq) {
  const indexPath = paths.chaptersOwnIndex()
  if (!fs.existsSync(indexPath)) return false
  
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    // Verifica se o seq do post cai dentro de algum range de capítulo selado
    return index.some(chapter => ownChainSeq >= chapter.start && ownChainSeq <= chapter.end)
  } catch {
    return false
  }
}

/**
 * Monta o feed agregando a cadeia própria + os posts já ingeridos dos
 * usuários seguidos (feedCache), ordenado do mais novo para o mais antigo.
 */
function getFeed (store, identity) {
  const own = store.data.ownChain.map(p => ({ 
    ...p, 
    pubkeyHex: identity.publicKeyHex, 
    isOwn: true,
    sealed: isPostSealed(p.seq)
  }))
  const others = store.data.feedCache.map(p => ({ ...p, isOwn: false, sealed: true }))
  const combined = [...own, ...others]
  
  // Deduplica: remove posts duplicados (mesmo pubkey + seq)
  const seen = new Set()
  const deduped = combined.filter(p => {
    const key = `${p.pubkeyHex}:${p.seq}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  
  return deduped.sort((a, b) => b.ts - a.ts)
}

function findFileRecursive (rootDir, predicate) {
  if (!fs.existsSync(rootDir)) return null
  const stack = [rootDir]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (predicate(e.name)) return full
    }
  }
  return null
}

/**
 * Resolve o caminho em disco de um anexo de mídia (por sha256), buscando na
 * cadeia própria (aberta/selada) ou no cache do usuário seguido.
 */
function resolveMediaPath (pubkeyHex, isOwn, sha256) {
  const matches = name => name.startsWith(sha256)
  if (isOwn) {
    const inOpen = findFileRecursive(path.join(paths.chaptersOwnOpen(), 'media'), matches)
    if (inOpen) return inOpen
    return findFileRecursive(paths.chaptersOwnSealed(), matches)
  }
  return findFileRecursive(path.join(paths.cacheRoot(), pubkeyHex), matches)
}

module.exports = { getFeed, resolveMediaPath, isPostSealed }

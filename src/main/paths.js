'use strict'
const path = require('path')
const fs = require('fs')
const { app } = require('electron')

// Raiz de dados do usuário para este app (identidade, chain, cache, torrents)
// Suporta múltiplas instâncias com COHERENCE_USER_DATA env var ou COHERENCE_INSTANCE
function root () {
  // Permitir override via variável de ambiente (para testes com múltiplos usuários)
  if (process.env.COHERENCE_USER_DATA) {
    return process.env.COHERENCE_USER_DATA
  }
  
  // Ou usar COHERENCE_INSTANCE para criar diretórios nomeados (ex: user1, user2)
  if (process.env.COHERENCE_INSTANCE) {
    const base = app.getPath('userData')
    return path.join(base, 'p2p-social', process.env.COHERENCE_INSTANCE)
  }
  
  const base = app.getPath('userData')
  return path.join(base, 'p2p-social')
}

const P = {
  root,
  identityFile: () => path.join(root(), 'identity.json'),
  identityKeyFile: () => path.join(root(), 'identity.key'),
  dbFile: () => path.join(root(), 'db.json'),
  chaptersOwnRoot: () => path.join(root(), 'chapters', 'own'),
  chaptersOwnOpen: () => path.join(root(), 'chapters', 'own', 'open'),
  chaptersOwnSealed: () => path.join(root(), 'chapters', 'own', 'sealed'),
  chaptersOwnIndex: () => path.join(root(), 'chapters', 'own', 'index.json'),
  cacheRoot: () => path.join(root(), 'chapters', 'cache'),
  backupsRoot: () => path.join(root(), 'backups')
}

function ensureDir (p) {
  fs.mkdirSync(p, { recursive: true })
}

function ensureAllDirs () {
  ensureDir(root())
  ensureDir(P.chaptersOwnOpen())
  ensureDir(path.join(P.chaptersOwnOpen(), 'media'))
  ensureDir(P.chaptersOwnSealed())
  ensureDir(P.cacheRoot())
}

module.exports = { ...P, ensureDir, ensureAllDirs }

#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')
const { readIdentity, listUserKeys, userDataDir } = require('../src/user-data')

/**
 * Script para limpar todos os dados do usuário (chaves, caches, perfil, posts, etc.)
 * e resetar a aplicação para o estado inicial.
 */

const dataRoots = [
  path.join(os.homedir(), 'Documents', 'coherence-data'),
  path.join(os.homedir(), 'Documentos', 'coherence-data'),
  process.env.OneDrive && path.join(process.env.OneDrive, 'Documents', 'coherence-data'),
  process.env.OneDrive && path.join(process.env.OneDrive, 'Documentos', 'coherence-data'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'p2p-social')
].filter(Boolean)

const resetAll = process.argv.includes('--all')
const requestedKeyArg = process.argv.find((arg) => arg.startsWith('--user-key='))
const requestedKey = requestedKeyArg ? requestedKeyArg.slice(11) : null
if (requestedKey && !/^[0-9a-f]{64}$/i.test(requestedKey)) {
  console.error('❌ --user-key precisa ser uma chave pública hexadecimal de 64 caracteres.')
  process.exit(1)
}

function pathsToReset(dataRoot) {
  if (resetAll) return [dataRoot]
  const legacyIdentity = readIdentity(path.join(dataRoot, 'identity.json'))
  if (legacyIdentity) return [dataRoot]
  const keys = listUserKeys(dataRoot)
  const key = requestedKey || (keys.length === 1 ? keys[0] : null)
  if (!key) throw new Error('Não foi possível identificar o usuário atual. Use --user-key=<chave-publica> ou npm run reset-all.')
  return [userDataDir(dataRoot, key)]
}

console.log(resetAll ? '🔄 Limpando dados de todos os usuários...' : '🔄 Limpando dados do usuário atual...')
const dataPaths = dataRoots.flatMap(pathsToReset)
dataPaths.forEach((dataPath) => console.log(`📁 Caminho: ${dataPath}`))

const existingPaths = dataPaths.filter((dataPath) => fs.existsSync(dataPath))

if (existingPaths.length === 0) {
  console.log('✅ Nenhum dado para limpar (pasta não existe)')
  process.exit(0)
}

try {
  existingPaths.forEach((dataPath) => {
    fs.rmSync(dataPath, { recursive: true, force: true })
  })
  console.log('✅ Dados removidos com sucesso!')
  console.log('🆕 A aplicação será resetada na próxima inicialização.')
  console.log('⏳ Execute: npm start')
  process.exit(0)
} catch (err) {
  console.error('❌ Erro ao limpar dados:', err.message)
  process.exit(1)
}

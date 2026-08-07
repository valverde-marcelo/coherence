#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * Script para limpar todos os dados do usuário (chaves, caches, perfil, posts, etc.)
 * e resetar a aplicação para o estado inicial.
 */

const dataPaths = [
  path.join(os.homedir(), 'Documents', 'coherence-data'),
  path.join(os.homedir(), 'Documentos', 'coherence-data'),
  process.env.OneDrive && path.join(process.env.OneDrive, 'Documents', 'coherence-data'),
  process.env.OneDrive && path.join(process.env.OneDrive, 'Documentos', 'coherence-data'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'p2p-social')
].filter(Boolean)

console.log('🔄 Limpando dados da aplicação P2P Social...')
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

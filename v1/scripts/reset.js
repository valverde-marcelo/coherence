#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * Script para limpar todos os dados do usuário (chaves, caches, perfil, posts, etc.)
 * e resetar a aplicação para o estado inicial.
 */

const dataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'p2p-social')

console.log('🔄 Limpando dados da aplicação P2P Social...')
console.log(`📁 Caminho: ${dataPath}`)

if (!fs.existsSync(dataPath)) {
  console.log('✅ Nenhum dado para limpar (pasta não existe)')
  process.exit(0)
}

try {
  // Remover recursivamente a pasta de dados
  fs.rmSync(dataPath, { recursive: true, force: true })
  console.log('✅ Dados removidos com sucesso!')
  console.log('🆕 A aplicação será resetada na próxima inicialização.')
  console.log('⏳ Execute: npm start')
  process.exit(0)
} catch (err) {
  console.error('❌ Erro ao limpar dados:', err.message)
  process.exit(1)
}

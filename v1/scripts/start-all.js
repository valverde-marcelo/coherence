#!/usr/bin/env node

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { listUserKeys, readIdentity } = require('../src/user-data')

/**
 * Inicia TODAS as contas locais encontradas em coherence-data, abrindo uma
 * instância Electron separada por usuário (a aplicação não usa bloqueio de
 * instância, então contas diferentes podem rodar ao mesmo tempo).
 *
 * Uso:
 *   npm run start-all
 */

const dataRoots = [
  path.join(os.homedir(), 'Documents', 'coherence-data'),
  path.join(os.homedir(), 'Documentos', 'coherence-data'),
  process.env.OneDrive && path.join(process.env.OneDrive, 'Documents', 'coherence-data'),
  process.env.OneDrive && path.join(process.env.OneDrive, 'Documentos', 'coherence-data'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'p2p-social')
].filter(Boolean)

/**
 * Encontra todas as instâncias (usuários locais) em todos os possíveis roots
 * de dados. Cada instância é identificada pela chave pública da conta. Uma
 * conta legada única (identity.json na raiz) também é incluída.
 */
function findInstances() {
  const instances = []
  const seen = new Set()
  for (const dataRoot of dataRoots) {
    if (!fs.existsSync(dataRoot)) continue
    for (const key of listUserKeys(dataRoot)) {
      if (seen.has(key)) continue
      seen.add(key)
      instances.push({ dataRoot, key })
    }
    if (instances.length === 0 && readIdentity(path.join(dataRoot, 'identity.json'))) {
      instances.push({ dataRoot, key: null })
    }
  }
  return instances
}

function main() {
  const instances = findInstances()

  if (instances.length === 0) {
    console.log('ℹ️  Nenhuma instância encontrada em coherence-data.')
    console.log('   Use "npm start -- --new-user" para criar uma nova conta.')
    process.exit(0)
  }

  // O módulo "electron", quando carregado por um script Node, exporta o
  // caminho do binário do Electron.
  const electronPath = require('electron')
  const projectRoot = path.join(__dirname, '..')

  console.log(`🚀 Iniciando ${instances.length} instância(s):`)
  for (const { dataRoot, key } of instances) {
    const label = key ? `${key.slice(0, 12)}…${key.slice(-8)}` : '(conta legada única)'
    const args = key ? ['.', '--user-key', key] : ['.']
    console.log(`   • ${label}  [${dataRoot}]`)
    const child = spawn(electronPath, args, {
      cwd: projectRoot,
      detached: true,
      stdio: 'inherit'
    })
    child.on('error', (err) => {
      console.error(`❌ Falha ao iniciar instância ${label}:`, err.message)
    })
    // Desvincula o processo filho: ele continua rodando mesmo depois que o
    // script (e o terminal) fecharem.
    child.unref()
  }

  console.log('✅ Instâncias lançadas. As janelas do Electron abrirão em instantes.')
}

main()

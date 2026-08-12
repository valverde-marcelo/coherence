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
  const logDir = path.join(os.tmpdir(), 'coherence-start-all')
  fs.mkdirSync(logDir, { recursive: true })

  console.log(`🚀 Iniciando ${instances.length} instância(s):`)
  const children = instances.map(({ dataRoot, key }) => {
    const label = key ? `${key.slice(0, 12)}…${key.slice(-8)}` : '(conta legada única)'
    const args = key ? ['.', '--user-key', key] : ['.']
    console.log(`   • ${label}  [${dataRoot}]`)

    const logFile = path.join(logDir, `${key || 'legacy'}.log`)
    const child = spawn(electronPath, args, {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let log = ''
    child.stdout.on('data', (d) => { log += d })
    child.stderr.on('data', (d) => { log += d })
    child.on('error', (err) => {
      console.error(`❌ Falha ao iniciar instância ${label}:`, err.message)
    })
    return { child, label, logFile, getLog: () => log, startedAt: Date.now() }
  })

  // Watchdog: por alguns segundos, detecta instâncias que quebram logo ao abrir
  // (ex.: erro de identidade) e mostra o log — assim o usuário vê o motivo em
  // vez de uma falha silenciosa. Depois do período, o script encerra e as
  // instâncias sobrevivem (detached + unref).
  const WATCHDOG_MS = 20000
  const watchdog = setTimeout(finish, WATCHDOG_MS)
  let remaining = children.length

  for (const entry of children) {
    entry.child.on('exit', (code, signal) => {
      writeLog(entry)
      const quickExit = Date.now() - entry.startedAt < WATCHDOG_MS
      if (quickExit && code !== 0) {
        console.error(`⚠️ Instância ${entry.label} encerrou precocemente (exit ${code ?? 'signal ' + signal}).`)
        console.error(`   Log completo: ${entry.logFile}`)
      } else if (quickExit) {
        console.log(`ℹ️ Instância ${entry.label} encerrou. Log: ${entry.logFile}`)
      }
      remaining -= 1
      if (remaining === 0) finish()
    })
  }

  function writeLog(entry) {
    const content = entry.getLog()
    if (!content) return
    try {
      fs.writeFileSync(entry.logFile, content)
    } catch (err) {
      console.error(`⚠️ Não foi possível gravar o log de ${entry.label}:`, err.message)
    }
  }

  function finish() {
    clearTimeout(watchdog)
    console.log('✅ Instâncias lançadas. As janelas abrirão em instantes.')
    console.log(`   Logs de cada instância: ${logDir}`)
    for (const entry of children) {
      writeLog(entry)
      // Desvincula processo e pipes: o pai pode sair e as instâncias continuam.
      entry.child.unref()
      entry.child.stdout?.unref()
      entry.child.stderr?.unref()
    }
  }
}

main()

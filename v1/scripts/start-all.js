#!/usr/bin/env node

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { listUserKeys, readIdentity } = require('../src/user-data')

/**
 * Starts ALL local accounts found in coherence-data, opening a separate
 * Electron instance per user (the app doesn't use an instance lock, so
 * different accounts can run at the same time).
 *
 * Usage:
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
 * Finds all instances (local users) in every possible data root. Each instance
 * is identified by the account's public key. A single legacy account
 * (identity.json at the root) is also included.
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

  // The "electron" module, when loaded by a Node script, exports the path
  // to the Electron binary.
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
    // IMPORTANT: redirects stdout/stderr to the LOG FILE (not a pipe). When the
    // parent (start-all) exits, the pipe would be closed and any console.log
    // from Electron would throw "EPIPE: broken pipe" — an uncaught error that
    // opens "Error" popups in Electron. With the fd pointing to the file, the
    // output keeps being written without breaking.
    const logFd = fs.openSync(logFile, 'a')
    const child = spawn(electronPath, args, {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    })
    child.on('error', (err) => {
      console.error(`❌ Falha ao iniciar instância ${label}:`, err.message)
    })
    return { child, label, logFile, logFd, startedAt: Date.now() }
  })

  // Watchdog: for a few seconds, detects instances that crash right on startup
  // (e.g. identity error) and shows the log — so the user sees the reason
  // instead of a silent failure. After the period, the script exits and the
  // instances survive (detached + unref).
  const WATCHDOG_MS = 20000
  const watchdog = setTimeout(finish, WATCHDOG_MS)
  let remaining = children.length

  for (const entry of children) {
    entry.child.on('exit', (code, signal) => {
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

  function finish() {
    clearTimeout(watchdog)
    console.log('✅ Instâncias lançadas. As janelas abrirão em instantes.')
    console.log(`   Logs de cada instância: ${logDir}`)
    for (const entry of children) {
      // Detaches the process and descriptors: the parent can exit and the
      // instances keep running (the log fds stay open in the child).
      entry.child.unref()
      try { fs.closeSync(entry.logFd) } catch { /* já fechado */ }
    }
  }
}

main()

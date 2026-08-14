#!/usr/bin/env node

'use strict'

// =====================================================================
// Helpers compartilhados para os scripts de CLI (start-all / reset).
//
//  - findInstances(): lista todas as contas locais em todas as possíveis
//    pastas de dados (coherence-data), deduplicadas por chave pública.
//  - promptSelect(): menu interativo (setas ↑/↓ + Enter) para escolher
//    qual(is) instância(s) usar, sempre oferecendo "todas" e "cancelar".
//    Quando o stdin não é um terminal (TTY), cai num prompt numerado.
// =====================================================================

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const readline = require('node:readline')
const { spawn } = require('node:child_process')
const { listUserKeys, readIdentity } = require('../src/user-data')

const DATA_ROOTS = [
  path.join(os.homedir(), 'Documents', 'coherence-data'),
  path.join(os.homedir(), 'Documentos', 'coherence-data'),
  process.env.OneDrive && path.join(process.env.OneDrive, 'Documents', 'coherence-data'),
  process.env.OneDrive && path.join(process.env.OneDrive, 'Documentos', 'coherence-data'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'p2p-social')
].filter(Boolean)

/**
 * Finds all instances (local users) in every possible data root. Each
 * instance is identified by the account's public key. A single legacy
 * account (identity.json at the root) is also included.
 */
function findInstances() {
  const instances = []
  const seen = new Set()
  for (const dataRoot of DATA_ROOTS) {
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

function shortKey(key) {
  return `${key.slice(0, 10)}…${key.slice(-6)}`
}

function instanceLabel(instance) {
  const { dataRoot, key } = instance
  const label = key ? `Chave ${shortKey(key)}` : '(conta legada única)'
  return `${label}  [${dataRoot}]`
}

function instanceList(instances) {
  return instances.map((inst) => `  • ${instanceLabel(inst)}`).join('\n')
}

const ALL_ACTION = { action: 'all' }
const CANCEL_ACTION = { action: 'cancel', instances: [] }

function resolveOption(option) {
  if (option.id === 'all') return ALL_ACTION
  if (option.id === 'cancel') return CANCEL_ACTION
  return { action: 'select', instances: [option.value] }
}

/**
 * Menu interativo de seleção única.
 * Retorna { action: 'all' } | { action: 'cancel', instances: [] } |
 *          { action: 'select', instances: [instância] }.
 */
async function promptSelect(instances, { title, allLabel, cancelLabel = 'Cancelar' }) {
  const options = [
    { id: 'all', label: allLabel },
    ...instances.map((inst, i) => ({ id: `inst:${i}`, label: instanceLabel(inst), value: inst })),
    { id: 'cancel', label: cancelLabel }
  ]

  if (!process.stdin.isTTY) {
    return promptSelectFallback(options)
  }

  return new Promise((resolve) => {
    const stdin = process.stdin
    const stdout = process.stdout
    readline.emitKeypressEvents(stdin)
    stdin.setRawMode(true)
    stdin.resume()

    let cursor = 0
    let closed = false

    const finish = (action) => {
      if (closed) return
      closed = true
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeAllListeners('keypress')
      stdout.write('\n')
      resolve(action)
    }

    const render = () => {
      stdout.write('\x1b[2J\x1b[H') // limpa a tela e volta ao topo
      stdout.write(`${title}\n\n`)
      options.forEach((opt, i) => {
        const marker = i === cursor ? '›' : ' '
        stdout.write(` ${marker} ${opt.label}\n`)
      })
      stdout.write('\n ↑/↓ navegar · Enter confirmar · Esc/q cancelar\n')
    }

    const onKeypress = (str, key) => {
      if (key.name === 'up') {
        cursor = (cursor - 1 + options.length) % options.length
        render()
      } else if (key.name === 'down') {
        cursor = (cursor + 1) % options.length
        render()
      } else if (key.name === 'return' || key.name === 'enter') {
        finish(resolveOption(options[cursor]))
      } else if (key.name === 'escape' || key.name === 'q') {
        finish(CANCEL_ACTION)
      } else if (key.ctrl && key.name === 'c') {
        finish(CANCEL_ACTION)
      }
    }

    stdin.on('keypress', onKeypress)
    render()
  })
}

/**
 * Fallback para quando o stdin não é um TTY (entrada redirecionada):
 * lista as opções numeradas e lê a escolha. Linha vazia / fim de entrada
 * (EOF) assume "todas" — mantém o comportamento antigo em pipelines.
 */
function promptSelectFallback(options) {
  return new Promise((resolve) => {
    let answered = false
    const done = (action) => {
      if (answered) return
      answered = true
      rl.close()
      resolve(action)
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.on('close', () => done(ALL_ACTION)) // EOF → todas

    console.log('')
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`))

    const ask = () => {
      rl.question(`\n Escolha uma opção (1-${options.length}, Enter = todas): `, (answer) => {
        const trimmed = answer.trim()
        if (trimmed === '') return done(ALL_ACTION)
        const n = Number.parseInt(trimmed, 10)
        if (Number.isInteger(n) && n >= 1 && n <= options.length) {
          return done(resolveOption(options[n - 1]))
        }
        console.log(' ❌ Invalid option.')
        ask()
      })
    }
    ask()
  })
}

const WATCHDOG_MS = 20000

/**
 * Launches every instance as a separate DETACHED Electron process (used by
 * start-all and by the "TODAS" option in `npm start`). Each instance gets its
 * own log file in %TEMP%/coherence-start-all. Includes a ~20s watchdog that
 * reports instances crashing right on startup; afterwards the script exits and
 * the windows survive (detached + unref).
 */
function launchDetached(instances) {
  // The "electron" module, when loaded by a Node script, exports the path
  // to the Electron binary.
  const electronPath = require('electron')
  const projectRoot = path.join(__dirname, '..')
  const logDir = path.join(os.tmpdir(), 'coherence-start-all')
  fs.mkdirSync(logDir, { recursive: true })

  console.log(`🚀 Starting ${instances.length} instance(s):`)
  const children = instances.map(({ dataRoot, key }) => {
    const label = key ? `${key.slice(0, 12)}…${key.slice(-8)}` : '(conta legada única)'
    const electronArgs = key ? ['.', '--user-key', key] : ['.']
    console.log(`   • ${label}  [${dataRoot}]`)

    const logFile = path.join(logDir, `${key || 'legacy'}.log`)
    // IMPORTANT: redirects stdout/stderr to the LOG FILE (not a pipe). When the
    // parent (start-all) exits, the pipe would be closed and any console.log
    // from Electron would throw "EPIPE: broken pipe" — an uncaught error that
    // opens "Error" popups in Electron. With the fd pointing to the file, the
    // output keeps being written without breaking.
    const logFd = fs.openSync(logFile, 'a')
    const child = spawn(electronPath, electronArgs, {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    })
    child.on('error', (err) => {
      console.error(`❌ Failed to start instance ${label}:`, err.message)
    })
    return { child, label, logFile, logFd, startedAt: Date.now() }
  })

  // Watchdog: for a few seconds, detects instances that crash right on startup
  // (e.g. identity error) and shows the log — so the user sees the reason
  // instead of a silent failure. After the period, the script exits and the
  // instances survive (detached + unref).
  const watchdog = setTimeout(finish, WATCHDOG_MS)
  let remaining = children.length

  for (const entry of children) {
    entry.child.on('exit', (code, signal) => {
      const quickExit = Date.now() - entry.startedAt < WATCHDOG_MS
      if (quickExit && code !== 0) {
        console.error(`⚠️ Instance ${entry.label} exited prematurely (exit ${code ?? 'signal ' + signal}).`)
        console.error(`   Full log: ${entry.logFile}`)
      } else if (quickExit) {
        console.log(`ℹ️ Instance ${entry.label} exited. Log: ${entry.logFile}`)
      }
      remaining -= 1
      if (remaining === 0) finish()
    })
  }

  function finish() {
    clearTimeout(watchdog)
    console.log('✅ Instances launched. The windows will open shortly.')
    console.log(`   Logs of each instance: ${logDir}`)
    for (const entry of children) {
      // Detaches the process and descriptors: the parent can exit and the
      // instances keep running (the log fds stay open in the child).
      entry.child.unref()
      try { fs.closeSync(entry.logFd) } catch { /* já fechado */ }
    }
  }
}

module.exports = {
  DATA_ROOTS,
  findInstances,
  shortKey,
  instanceLabel,
  instanceList,
  ALL_ACTION,
  CANCEL_ACTION,
  promptSelect,
  launchDetached
}

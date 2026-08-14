#!/usr/bin/env node

'use strict'

const path = require('node:path')
const { spawn } = require('node:child_process')
const { findInstances, promptSelect, launchDetached, instanceList } = require('./instances')

/**
 * Foreground launcher used by `npm start` (Electron in the foreground,
 * exactly like the original `electron .`).
 *
 * When there is more than one local account it shows the SAME selection menu
 * as `npm run start-all`, letting the user choose which account to open
 * (or open all of them / cancel). With a single account — or when
 * `--new-user` / `--user-key=<chave>` is passed — it launches Electron
 * directly without asking.
 *
 * Usage:
 *   npm start                            → abre a conta única ou mostra o menu
 *   npm start -- --select                → força o menu de seleção
 *   npm start -- --user-key=<chave>      → abre uma conta específica
 *   npm start -- --new-user              → fluxo de nova conta (sem menu)
 */

const args = process.argv.slice(2)

const requestedKeyEq = args.find((arg) => arg.startsWith('--user-key='))
const requestedKeyArg = requestedKeyEq
  ? requestedKeyEq.slice(11)
  : args.includes('--user-key') ? args[args.indexOf('--user-key') + 1] : null
const requestedKey = requestedKeyArg ? requestedKeyArg.toLowerCase() : null
const forceSelect = args.includes('--select')
const newUser = args.includes('--new-user')

if (requestedKey && !/^[0-9a-f]{64}$/i.test(requestedKey)) {
  console.error('❌ --user-key must be a 64-character hexadecimal public key.')
  process.exit(1)
}

/**
 * Launches a single Electron process in the foreground (inherits stdio), so
 * `npm start` behaves exactly like the original `electron .`: output goes to
 * the terminal and the command exits when the window closes.
 */
function launchElectron(electronArgs = []) {
  const electronPath = require('electron')
  const projectRoot = path.join(__dirname, '..')
  const child = spawn(electronPath, ['.', ...electronArgs], {
    cwd: projectRoot,
    stdio: 'inherit'
  })
  child.on('error', (err) => {
    console.error('❌ Failed to start Electron:', err.message)
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0))
  })
}

async function choosePlan(instances) {
  if (newUser) return { launch: 'direct', args: ['--new-user'] }
  if (requestedKey) {
    const match = instances.find((i) => i.key === requestedKey)
    if (!match) {
      console.error(`❌ No instance found for key ${requestedKey}.`)
      console.error('   Available instances:')
      console.error(instanceList(instances))
      process.exit(1)
    }
    return { launch: 'one', instance: match }
  }
  if (instances.length === 1 && !forceSelect) {
    return { launch: 'one', instance: instances[0] }
  }

  // Multiple instances → the same menu as `npm run start-all`.
  const choice = await promptSelect(instances, {
    title: `🚀 ${instances.length} instâncias encontradas — qual deseja iniciar?`,
    allLabel: `✨ Iniciar TODAS (${instances.length})`
  })
  if (choice.action === 'cancel') {
    console.log('👋 No instance was started.')
    process.exit(0)
  }
  if (choice.action === 'all') return { launch: 'all', instances }
  return { launch: 'one', instance: choice.instances[0] }
}

async function main() {
  const instances = findInstances()

  // No local account: launch plain `electron .` so the app shows the
  // new-account setup flow (same as the original `npm start`).
  if (instances.length === 0) {
    launchElectron(newUser ? ['--new-user'] : [])
    return
  }

  const plan = await choosePlan(instances)
  if (plan.launch === 'direct') {
    launchElectron(plan.args)
  } else if (plan.launch === 'all') {
    console.log('✨ Opening all instances in the background (equivalent to npm run start-all).')
    launchDetached(plan.instances)
  } else if (plan.launch === 'one') {
    launchElectron(plan.instance.key ? ['--user-key', plan.instance.key] : [])
  }
}

main()

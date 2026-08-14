#!/usr/bin/env node

'use strict'

const { findInstances, promptSelect, launchDetached, instanceList } = require('./instances')

/**
 * Starts local accounts found in coherence-data, opening a separate
 * DETACHED Electron instance per user (the app doesn't use an instance
 * lock, so different accounts can run at the same time).
 *
 * Usage:
 *   npm run start-all                      → menu de seleção quando há várias contas
 *   npm run start-all -- --all             → inicia TODAS (sem perguntar)
 *   npm run start-all -- --select          → força o menu de seleção
 *   npm run start-all -- --user-key=<chave> → inicia uma conta específica
 */

const args = process.argv.slice(2)
const requestedKeyArg = args.find((arg) => arg.startsWith('--user-key='))
const requestedKey = requestedKeyArg ? requestedKeyArg.slice(11).toLowerCase() : null
const forceSelect = args.includes('--select')
const startAll = args.includes('--all')

if (requestedKey && !/^[0-9a-f]{64}$/i.test(requestedKey)) {
  console.error('❌ --user-key must be a 64-character hexadecimal public key.')
  process.exit(1)
}

async function chooseInstances(instances) {
  if (requestedKey) {
    const match = instances.find((i) => i.key === requestedKey)
    if (!match) {
      console.error(`❌ No instance found for key ${requestedKey}.`)
      console.error('   Available instances:')
      console.error(instanceList(instances))
      process.exit(1)
    }
    return [match]
  }
  if (startAll || (instances.length === 1 && !forceSelect)) return instances

  const choice = await promptSelect(instances, {
    title: `🚀 ${instances.length} instâncias encontradas — qual deseja iniciar?`,
    allLabel: `✨ Iniciar TODAS (${instances.length})`
  })
  if (choice.action === 'cancel') {
    console.log('👋 No instance was started.')
    process.exit(0)
  }
  return choice.action === 'all' ? instances : choice.instances
}

async function main() {
  const instances = findInstances()

  if (instances.length === 0) {
    console.log('ℹ️  No instance found in coherence-data.')
    console.log('   Use "npm start -- --new-user" to create a new account.')
    process.exit(0)
  }

  const toStart = await chooseInstances(instances)
  launchDetached(toStart)
}

main()

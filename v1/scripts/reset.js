#!/usr/bin/env node

'use strict'

const fs = require('node:fs')
const readline = require('node:readline')
const { findInstances, promptSelect, instanceList } = require('./instances')
const { userDataDir } = require('../src/user-data')

/**
 * Script to clear the user's data (keys, caches, profile, posts, etc.)
 * and reset the application to its initial state.
 *
 * Usage:
 *   npm run reset                      → reset da conta única, ou menu de seleção
 *   npm run reset -- --select          → força o menu de seleção
 *   npm run reset -- --user-key=<chave> → reset de uma conta específica
 *   npm run reset -- --yes             → confirma automaticamente (sem pergunta)
 *   npm run reset-all                  → reset de TODAS as contas (equivale a --all)
 */

const args = process.argv.slice(2)
const resetAll = args.includes('--all')
const forceSelect = args.includes('--select')
const forceYes = args.includes('--yes') || args.includes('-y')
const requestedKeyArg = args.find((arg) => arg.startsWith('--user-key='))
const requestedKey = requestedKeyArg ? requestedKeyArg.slice(11).toLowerCase() : null

if (requestedKey && !/^[0-9a-f]{64}$/i.test(requestedKey)) {
  console.error('❌ --user-key must be a 64-character hexadecimal public key.')
  process.exit(1)
}

/** Caminhos a apagar para um conjunto de instâncias (deduplicados). */
function pathsForInstances(instances) {
  const paths = new Set()
  for (const { dataRoot, key } of instances) {
    paths.add(key ? userDataDir(dataRoot, key) : dataRoot)
  }
  return [...paths]
}

async function confirmDestructive() {
  if (forceYes) return true
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(
      '\n ⚠️  Esta ação é IRREVERSÍVEL (apaga identidade, perfil, posts e configurações).\n     Digite "s"/"sim" para confirmar, ou Enter para cancelar: ',
      (answer) => {
        rl.close()
        const a = answer.trim().toLowerCase()
        resolve(a === 's' || a === 'sim' || a === 'y' || a === 'yes')
      }
    )
  })
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
  if (resetAll || (instances.length === 1 && !forceSelect)) return instances

  const choice = await promptSelect(instances, {
    title: `🔄 ${instances.length} instâncias encontradas — qual deseja resetar?`,
    allLabel: `⚠️  Resetar TODAS (${instances.length})`
  })
  if (choice.action === 'cancel') {
    console.log('👋 No instance was reset.')
    process.exit(0)
  }
  return choice.action === 'all' ? instances : choice.instances
}

async function main() {
  const instances = findInstances()

  if (instances.length === 0) {
    console.log('ℹ️  No instance found in coherence-data.')
    process.exit(0)
  }

  const toReset = await chooseInstances(instances)
  const dataPaths = pathsForInstances(toReset)

  console.log(`🔄 Clearing data of ${toReset.length} instance(s):`)
  dataPaths.forEach((dataPath) => console.log(`📁 Path: ${dataPath}`))

  const existingPaths = dataPaths.filter((dataPath) => fs.existsSync(dataPath))

  if (existingPaths.length === 0) {
    console.log('✅ No data to clear (folder does not exist)')
    process.exit(0)
  }

  if (!(await confirmDestructive())) {
    console.log('👋 Operation canceled. No data was removed.')
    process.exit(0)
  }

  try {
    existingPaths.forEach((dataPath) => {
      fs.rmSync(dataPath, { recursive: true, force: true })
    })
    console.log('✅ Data removed successfully!')
    console.log('🆕 The application will be reset on the next startup.')
    console.log('⏳ Run: npm start')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error clearing data:', err.message)
    process.exit(1)
  }
}

main()

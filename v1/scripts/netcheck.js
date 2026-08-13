#!/usr/bin/env node
'use strict'

// =====================================================================
// P2P connectivity diagnostics between two machines / networks.
//
// Goal: isolate whether the communication problem is the P2P layer (NAT/firewall)
// or the application itself. Uses only hyperswarm + corestore + hypercore
// (the SAME network path as the app), without any interface/UI.
//
// Usage:
//   Machine A (network 1):  node scripts/netcheck.js seed
//   Machine B (network 2):  node scripts/netcheck.js probe <hex-key-64> [timeoutSec]
//
// - The "seed" creates a core with a payload, announces the topic and stays up.
// - The "probe" tries to find the seeder, connect and download the payload.
//
// Result:
//   PROBE "OK"           -> the P2P layer works between the networks; the problem
//                           is in the app/config (opening instances, keys etc.).
//   PROBE "FAILED"       -> NAT/firewall blocking hole punching. See the
//                           checks at the end of the file.
// =====================================================================

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const { keyPair } = require('hypercore-crypto')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'))
}

// ---------------------------------------------------------------------
// SEED MODE — announces a core with a payload and waits for peers
// ---------------------------------------------------------------------
async function seed(payload) {
  const store = new Corestore(path.join(tmpDir('netcheck-seed'), 'corestore'))
  const swarm = new Hyperswarm({})
  await store.ready()

  const core = store.get({ keyPair: keyPair() })
  await core.ready()
  await core.append(payload)
  console.log('[seed] core criado, length:', core.length)

  swarm.join(core.discoveryKey, { server: true, client: true })
  swarm.on('connection', (socket) => {
    try { store.replicate(socket) } catch (e) { console.log('[seed] replicate err:', e.message) }
  })
  core.on('peer-add', () => console.log('[seed] ✔ PEER CONECTOU! total:', core.peers.length))
  core.on('peer-remove', () => console.log('[seed] peer saiu, total:', core.peers.length))
  swarm.on('error', (e) => console.log('[seed] swarm error:', e.message))

  console.log('')
  console.log('============================================================')
  console.log('  CHAVE PARA COLAR NA MÁQUINA B (probe):')
  console.log('  ' + core.key.toString('hex'))
  console.log('============================================================')
  console.log('')
  console.log('[seed] Aguardando peers por até 5 minutos... (Ctrl+C para sair)')
  await sleep(300000)
}

// ---------------------------------------------------------------------
// PROBE MODE — tries to find the seeder, connect and download the payload
// ---------------------------------------------------------------------
async function probe(keyHex, timeoutMs) {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    console.error('Chave inválida — use a chave hex de 64 caracteres exibida pelo seed.')
    process.exit(1)
  }

  const store = new Corestore(path.join(tmpDir('netcheck-probe'), 'corestore'))
  const swarm = new Hyperswarm({})
  await store.ready()

  const core = store.get({ key: Buffer.from(keyHex, 'hex'), writable: false })
  await core.ready()

  swarm.join(core.discoveryKey, { server: true, client: true })
  swarm.on('connection', (socket) => {
    try { store.replicate(socket) } catch (e) { console.log('[probe] replicate err:', e.message) }
  })
  core.on('peer-add', () => console.log('[probe] ✔ PEER CONECTOU! total:', core.peers.length))
  swarm.on('error', (e) => console.log('[probe] swarm error:', e.message))

  console.log('[probe] Procurando seeder por', Math.round(timeoutMs / 1000), 's...')

  const start = Date.now()
  while (Date.now() - start < timeoutMs && core.peers.length === 0) {
    await sleep(500)
  }

  const connected = core.peers.length > 0
  console.log('[probe] Conectou a algum peer?', connected ? 'SIM' : 'NÃO')

  let downloaded = false
  let data = null
  if (connected) {
    await Promise.race([
      core.update({ wait: true }),
      sleep(15000)
    ])
    console.log('[probe] length do core após update:', core.length)
    if (core.length > 0) {
      const ok = await Promise.race([
        core.download({ start: 0, end: core.length }).done().then(() => true),
        sleep(20000).then(() => false)
      ])
      console.log('[probe] Download completo?', ok ? 'SIM' : 'NÃO')
      if (ok) {
        data = await core.get(0).catch(() => null)
        downloaded = !!data
        console.log('[probe] Dados recebidos:', data ? data.toString() : null)
      }
    }
  }

  console.log('')
  console.log('============================================================')
  if (connected && downloaded) {
    console.log('  RESULTADO: OK ✔  — a camada P2P FUNCIONA entre as redes.')
    console.log('  O problema está no app/config, não no NAT.')
  } else {
    console.log('  RESULTADO: FALHOU ✘ — não conectou/baixou.')
    console.log('  Provável causa: NAT/firewall bloqueando o hole-punching.')
  }
  console.log('============================================================')
  console.log('')
  console.log('Checagens rápidas:')
  console.log('  1) CGNAT: seu IP público começa com 100.64.x.x? (rodar na máquina B)')
  console.log('     Invoke-RestMethod https://api.ipify.org')
  console.log('  2) Firewall/antivírus permitindo o Node/Electron (entrada E saída UDP).')
  console.log('  3) Roteador com UPnP/NAT-FullCone habilitado.')
  console.log('  4) Teste as DUAS máquinas na MESMA rede — se conectar, é NAT entre redes.')

  await swarm.destroy().catch(() => {})
  await store.close().catch(() => {})
  process.exit(connected && downloaded ? 0 : 1)
}

// ---------------------------------------------------------------------

const mode = process.argv[2]
if (mode === 'seed') {
  const payload = process.argv[3] || 'coherence-netcheck-' + Date.now()
  seed(payload).catch((e) => { console.error('[seed] ERRO:', e); process.exit(1) })
} else if (mode === 'probe') {
  const key = process.argv[3]
  const timeout = (parseInt(process.argv[4] || '90', 10)) * 1000
  probe(key, timeout).catch((e) => { console.error('[probe] ERRO:', e); process.exit(1) })
} else {
  console.log('Uso:')
  console.log('  Máquina A: node scripts/netcheck.js seed')
  console.log('  Máquina B: node scripts/netcheck.js probe <chave-hex-64> [timeoutSeg]')
  process.exit(1)
}

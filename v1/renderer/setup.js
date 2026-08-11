'use strict'

const setupEls = {
  screen: document.getElementById('setup-screen'),
  locale: document.getElementById('setup-locale'),
  importButton: document.getElementById('setup-import'),
  createButton: document.getElementById('setup-create'),
  createForm: document.getElementById('setup-create-form'),
  username: document.getElementById('setup-username'),
  error: document.getElementById('setup-error'),
  status: document.getElementById('setup-status'),
  actions: document.querySelector('.setup-actions'),
  createForm: document.getElementById('setup-create-form'),
  recovery: document.getElementById('setup-recovery'),
  recoveryStatus: document.getElementById('setup-recovery-status'),
  recoveryMeta: document.getElementById('setup-recovery-meta'),
  recoveryAnim: document.getElementById('setup-recovery-anim'),
  startFromZero: document.getElementById('setup-start-from-zero'),
  cancelRecovery: document.getElementById('setup-cancel-recovery')
}

let recoveryMonitorTimer = null
let recoveryPhase = 'searching'
let recoveryStalled = false

function setupError(message) {
  setupEls.error.textContent = message
  setupEls.error.hidden = false
}

function setupStatus(message) {
  setupEls.status.textContent = message
  setupEls.status.hidden = false
}

function setBusy(busy) {
  setupEls.importButton.disabled = busy
  setupEls.createButton.disabled = busy
  setupEls.locale.disabled = busy
  setupEls.username.disabled = busy
}

function setRecoveryPhase(phase) {
  recoveryPhase = phase === 'syncing' ? 'syncing' : phase === 'stalled' ? 'stalled' : 'searching'
  if (recoveryPhase === 'stalled') recoveryStalled = true
  // Depois de avisar que o seeder está incompleto, não deixa os eventos
  // 'syncing' subsequentes (o loop continua tentando) sobrescreverem o aviso.
  if (recoveryPhase === 'syncing' && recoveryStalled) return
  setupEls.recoveryStatus.textContent = recoveryPhase === 'syncing'
    ? window.coherenceI18n.text('seederFound')
    : recoveryPhase === 'stalled'
      ? window.coherenceI18n.text('seederIncomplete')
      : window.coherenceI18n.text('searchingSeeders')
}

function updateRecoveryBlips(peers) {
  const blips = setupEls.recoveryAnim.querySelectorAll('.recovery-anim__blip')
  blips.forEach((blip, i) => { blip.hidden = i >= Math.min(peers, 3) })
}

function updateRecoveryMeta(peers) {
  setupEls.recoveryMeta.textContent = window.coherenceI18n.text('recoveryPeers').replace('{n}', String(peers))
}

function showRecovery(state) {
  window.__coherenceSetupActive = true
  setupEls.screen.hidden = false
  setupEls.actions.hidden = true
  setupEls.createForm.hidden = true
  setupEls.recovery.hidden = false
  setupEls.recoveryAnim.classList.add('recovery-anim--active')
  setRecoveryPhase(state)
  updateRecoveryBlips(0)
  setupEls.recoveryMeta.hidden = false
  updateRecoveryMeta(0)
  startRecoveryMonitor()
}

function startRecoveryMonitor() {
  if (recoveryMonitorTimer) return
  recoveryMonitorTimer = setInterval(async () => {
    try {
      const state = await window.p2p.setup.getState()
      if (state === 'ready') {
        clearInterval(recoveryMonitorTimer)
        recoveryMonitorTimer = null
        window.location.reload()
        return
      }
      const info = await window.p2p.setup.getRecoveryStatus()
      const peers = Math.max(info.peerCount || 0, info.corePeers || 0)
      updateRecoveryMeta(peers)
      updateRecoveryBlips(peers)
    } catch {
      // O processo principal pode estar encerrando após o cancelamento.
    }
  }, 1000)
}

async function bootSetup() {
  const settings = await window.p2p.setup.getSettings()
  setupEls.locale.value = settings.locale || 'pt-BR'
  window.coherenceI18n.apply(setupEls.locale.value)

  const hasIdentity = await window.p2p.setup.checkIdentity()
  if (hasIdentity) {
    const result = await window.p2p.setup.startApp()
    if (result && result.state === 'recovery') {
      showRecovery('searching')
      return
    }
    setupEls.screen.hidden = true
    return
  }

  window.__coherenceSetupActive = true
  setupEls.screen.hidden = false
}

window.p2p.on('recovery-updated', (result) => {
  if (result.state === 'recovered') {
    window.location.reload()
    return
  }
  if (result.state === 'waiting') {
    // Voltou a procurar seeders (dados sumiram da rede): limpa o aviso anterior.
    recoveryStalled = false
    setRecoveryPhase('searching')
    return
  }
  if (result.state === 'stalled') {
    setRecoveryPhase('stalled')
    return
  }
  if (result.state === 'syncing') {
    setRecoveryPhase('syncing')
  }
})

setupEls.startFromZero.addEventListener('click', async () => {
  setupEls.startFromZero.disabled = true
  setupEls.recoveryStatus.textContent = window.coherenceI18n.text('startingFromZero')
  try {
    await window.p2p.setup.startFromZero()
    window.location.reload()
  } catch (error) {
    setupError(error.message)
    setupEls.startFromZero.disabled = false
  }
})

setupEls.cancelRecovery.addEventListener('click', async () => {
  setupEls.cancelRecovery.disabled = true
  setupEls.startFromZero.disabled = true
  setupEls.recoveryStatus.textContent = window.coherenceI18n.text('closing')
  try {
    await window.p2p.setup.cancelRecovery()
  } catch (error) {
    setupError(error.message)
    setupEls.cancelRecovery.disabled = false
    setupEls.startFromZero.disabled = false
  }
})

setupEls.locale.addEventListener('change', async () => {
  const settings = await window.p2p.setup.setSettings({ locale: setupEls.locale.value })
  window.coherenceI18n.apply(settings.locale)
})

setupEls.createButton.addEventListener('click', () => {
  setupEls.createForm.hidden = false
  setupEls.username.focus()
})

setupEls.importButton.addEventListener('click', async () => {
  setupEls.error.hidden = true
  setBusy(true)
  setupStatus(window.coherenceI18n.text('imported'))
  try {
    const result = await window.p2p.setup.importIdentity()
    if (result.canceled) {
      setupEls.status.hidden = true
      return
    }
    window.location.reload()
  } catch (error) {
    setupError(window.coherenceI18n.text('importError'))
  } finally {
    setBusy(false)
  }
})

setupEls.createForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  setupEls.error.hidden = true
  const username = setupEls.username.value.trim()
  if (!/^[\p{L}\p{N} _.-]{1,30}$/u.test(username)) {
    setupError(window.coherenceI18n.text('invalidName'))
    return
  }
  setBusy(true)
  setupStatus(window.coherenceI18n.text('creating'))
  try {
    await window.p2p.setup.createIdentity(username)
    window.location.reload()
  } catch (error) {
    setupError(window.coherenceI18n.text('createError'))
    setBusy(false)
  }
})

window.coherenceSetupReady = bootSetup().catch((error) => {
  setupError(error.message)
  throw error
})

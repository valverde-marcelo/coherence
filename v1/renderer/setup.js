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
  startFromZero: document.getElementById('setup-start-from-zero')
}

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

function showRecovery(state) {
  window.__coherenceSetupActive = true
  setupEls.screen.hidden = false
  setupEls.actions.hidden = true
  setupEls.createForm.hidden = true
  setupEls.recovery.hidden = false
  setupEls.recoveryStatus.textContent = state === 'expired'
    ? window.coherenceI18n.text('recoveryExpired')
    : window.coherenceI18n.text('recoveringIdentity')
}

async function bootSetup() {
  const settings = await window.p2p.setup.getSettings()
  setupEls.locale.value = settings.locale || 'pt-BR'
  window.coherenceI18n.apply(setupEls.locale.value)

  const hasIdentity = await window.p2p.setup.checkIdentity()
  if (hasIdentity) {
    const result = await window.p2p.setup.startApp()
    if (result && result.state === 'recovery') {
      showRecovery('waiting')
      return
    }
    if (result && result.state === 'recovery-expired') {
      showRecovery('expired')
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
  if (result.state === 'expired') showRecovery('expired')
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

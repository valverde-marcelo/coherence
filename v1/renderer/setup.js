'use strict'

const setupEls = {
  screen: document.getElementById('setup-screen'),
  locale: document.getElementById('setup-locale'),
  importButton: document.getElementById('setup-import'),
  createButton: document.getElementById('setup-create'),
  createForm: document.getElementById('setup-create-form'),
  username: document.getElementById('setup-username'),
  error: document.getElementById('setup-error'),
  status: document.getElementById('setup-status')
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

async function bootSetup() {
  const settings = await window.p2p.setup.getSettings()
  setupEls.locale.value = settings.locale || 'pt-BR'
  window.coherenceI18n.apply(setupEls.locale.value)

  const hasIdentity = await window.p2p.setup.checkIdentity()
  if (hasIdentity) {
    await window.p2p.setup.startApp()
    setupEls.screen.hidden = true
    return
  }

  window.__coherenceSetupActive = true
  setupEls.screen.hidden = false
}

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

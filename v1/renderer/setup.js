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
  termsLink: document.getElementById('setup-terms-link'),
  termsAccept: document.getElementById('setup-terms-accept'),
  termsError: document.getElementById('setup-terms-error'),
  confirm: document.getElementById('setup-confirm'),
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

/** Opens a modal (popup) with the Terms of Use in the active locale. */
function openTermsModal() {
  const t = (key) => window.coherenceI18n.text(key)
  const items = window.coherenceI18n.dictionaries[window.coherenceI18n.locale].terms || []

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.setAttribute('role', 'presentation')

  const dialog = document.createElement('section')
  dialog.className = 'terms-modal'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'terms-modal-title')

  const header = document.createElement('header')
  header.className = 'terms-modal__header'
  const title = document.createElement('h2')
  title.id = 'terms-modal-title'
  title.textContent = t('termsTitle')
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'btn btn--ghost btn--tiny'
  closeBtn.textContent = t('close')
  closeBtn.addEventListener('click', close)
  header.appendChild(title)
  header.appendChild(closeBtn)
  dialog.appendChild(header)

  const body = document.createElement('div')
  body.className = 'terms-modal__body'
  for (const item of items) {
    const heading = document.createElement('div')
    heading.className = 'setup-terms__h'
    heading.textContent = item.h
    const paragraph = document.createElement('p')
    paragraph.className = 'setup-terms__p'
    paragraph.textContent = item.p
    body.appendChild(heading)
    body.appendChild(paragraph)
  }
  dialog.appendChild(body)
  overlay.appendChild(dialog)

  function close() {
    overlay.remove()
    setupEls.termsLink.focus()
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close()
  })
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  })
  document.body.appendChild(overlay)
  closeBtn.focus()
}

/**
 * The user may only create/import an identity after confirming they read the
 * Terms of Use. Every entry point (create button, import button, and the
 * "confirm" submit inside the create form) is disabled until the checkbox is
 * checked; the handlers also re-verify it as a hard guard.
 */
function updateTermsGate() {
  const accepted = setupEls.termsAccept.checked
  setupEls.importButton.disabled = !accepted
  setupEls.createButton.disabled = !accepted
  if (setupEls.confirm) setupEls.confirm.disabled = !accepted
  if (accepted) setupEls.termsError.hidden = true
}

function termsBlocked() {
  if (setupEls.termsAccept.checked) return false
  setupEls.termsError.textContent = window.coherenceI18n.text('termsError')
  setupEls.termsError.hidden = false
  setupEls.termsAccept.focus()
  return true
}

function setBusy(busy) {
  setupEls.importButton.disabled = busy
  setupEls.createButton.disabled = busy
  setupEls.locale.disabled = busy
  setupEls.username.disabled = busy
  if (setupEls.confirm) setupEls.confirm.disabled = busy
  // When the busy state ends, re-apply the terms gate so the actions stay
  // locked unless the Terms of Use were accepted.
  if (!busy) updateTermsGate()
}

function buildStalledMessage(info) {
  const t = (key) => window.coherenceI18n.text(key)
  let message = t('seederIncomplete')
  if (!info) return message
  const lines = []
  if (typeof info.downloaded === 'number' && typeof info.length === 'number' && info.length > 0) {
    lines.push(t('recoveryProgress')
      .replace('{have}', String(info.downloaded))
      .replace('{length}', String(info.length)))
  }
  if (Array.isArray(info.peers) && info.peers.length > 0) {
    const complete = info.peers.filter((p) => p.complete).length
    const empty = info.peers.filter((p) => p.empty).length
    const partial = info.peers.length - complete - empty
    lines.push(t('recoveryPeersInfo')
      .replace('{peers}', String(info.peers.length))
      .replace('{complete}', String(complete)))
    lines.push(t('recoveryPeersBreakdown')
      .replace('{complete}', String(complete))
      .replace('{partial}', String(partial))
      .replace('{empty}', String(empty)))
  }
  if (lines.length > 0) message += '\n' + lines.join('\n')
  return message
}

function setRecoveryPhase(phase, info) {
  recoveryPhase = phase === 'syncing' ? 'syncing' : phase === 'stalled' ? 'stalled' : 'searching'
  if (recoveryPhase === 'stalled') recoveryStalled = true
  // After warning that the seeder is incomplete, don't let subsequent 'syncing'
  // events (the loop keeps trying) overwrite the warning.
  if (recoveryPhase === 'syncing' && recoveryStalled) return
  setupEls.recoveryStatus.textContent = recoveryPhase === 'syncing'
    ? window.coherenceI18n.text('seederFound')
    : recoveryPhase === 'stalled'
      ? buildStalledMessage(info)
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
      // The main process may be shutting down after the cancellation.
    }
  }, 1000)
}

async function bootSetup() {
  const settings = await window.p2p.setup.getSettings()
  setupEls.locale.value = settings.locale || 'pt-BR'
  window.coherenceI18n.apply(setupEls.locale.value)
  // If the Terms of Use were accepted in a previous visit (and the user came
  // back to this screen), keep the checkbox checked.
  setupEls.termsAccept.checked = !!settings.termsAccepted
  updateTermsGate()

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
    // Went back to looking for seeders (data vanished from the network): clear the previous warning.
    recoveryStalled = false
    setRecoveryPhase('searching')
    return
  }
  if (result.state === 'stalled') {
    setRecoveryPhase('stalled', result)
    return
  }
  if (result.state === 'syncing') {
    // A new seeder joined the network during the stall (resetStall comes from the
    // backend): clear the warning and go back to showing "downloading data…".
    if (result.resetStall) recoveryStalled = false
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

setupEls.termsAccept.addEventListener('change', updateTermsGate)

setupEls.termsLink.addEventListener('click', (event) => {
  event.preventDefault()
  openTermsModal()
})

setupEls.createButton.addEventListener('click', () => {
  setupEls.createForm.hidden = false
  setupEls.username.focus()
})

setupEls.importButton.addEventListener('click', async () => {
  if (termsBlocked()) return
  setupEls.error.hidden = true
  setBusy(true)
  setupStatus(window.coherenceI18n.text('imported'))
  try {
    const result = await window.p2p.setup.importIdentity()
    if (result.canceled) {
      setupEls.status.hidden = true
      return
    }
    try {
      await window.p2p.setup.setSettings({ termsAccepted: true })
    } catch { /* best effort — acceptance is already enforced by the UI gate */ }
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
  if (termsBlocked()) return
  const username = setupEls.username.value.trim()
  if (!/^[\p{L}\p{N} _.-]{1,30}$/u.test(username)) {
    setupError(window.coherenceI18n.text('invalidName'))
    return
  }
  setBusy(true)
  setupStatus(window.coherenceI18n.text('creating'))
  try {
    await window.p2p.setup.createIdentity(username)
    try {
      await window.p2p.setup.setSettings({ termsAccepted: true })
    } catch { /* best effort */ }
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

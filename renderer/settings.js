'use strict'

const el = id => document.getElementById(id)

// i18n helper
async function t (key, defaultValue = '') {
  return await window.api.i18n.t(key, defaultValue)
}

async function applyTranslations () {
  document.querySelectorAll('[data-i18n]').forEach(async elem => {
    const key = elem.dataset.i18n
    elem.textContent = await t(key)
  })

  document.querySelectorAll('[data-i18n-placeholder]').forEach(async elem => {
    const key = elem.dataset.i18nPlaceholder
    elem.placeholder = await t(key)
  })
}

let pendingFile = null

async function init () {
  await applyTranslations()

  // Back button
  el('back-btn').addEventListener('click', () => {
    window.location.href = 'index.html'
  })

  // Export password toggle
  el('export-use-password').addEventListener('change', (e) => {
    el('export-password').style.display = e.target.checked ? 'block' : 'none'
  })

  // Import password toggle
  el('import-use-password').addEventListener('change', (e) => {
    el('import-password').style.display = e.target.checked ? 'block' : 'none'
  })

  // Auto-backup toggle
  el('auto-backup-enabled').addEventListener('change', (e) => {
    el('auto-backup-interval-row').style.display = e.target.checked ? 'flex' : 'none'
    if (e.target.checked) {
      saveSettings()
    }
  })

  // Auto-backup interval change
  el('auto-backup-interval').addEventListener('change', () => {
    saveSettings()
  })

  // Export backup button
  el('export-backup-btn').addEventListener('click', onExportBackup)

  // Import backup button
  el('import-backup-btn').addEventListener('click', onImportBackup)

  // Open backups folder button
  el('open-backups-folder-btn').addEventListener('click', onOpenBackupsFolder)

  // Load settings
  await loadSettings()
}

async function onExportBackup () {
  const usePassword = el('export-use-password').checked
  const password = usePassword ? el('export-password').value : null

  if (usePassword && !password) {
    showResult('export-result', 'error', 'Por favor, digite uma senha')
    return
  }

  showResult('export-result', '', 'Exportando backup…')
  el('export-backup-btn').disabled = true

  try {
    const backupData = await window.api.backup.exportBackup(password)
    const blob = new Blob([new Uint8Array(backupData)], { type: 'application/zip' })

    // Trigger download
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const timestamp = new Date().toISOString().split('T')[0]
    link.href = url
    link.download = `coherence-backup-${timestamp}.zip`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    showResult('export-result', 'success', '✓ Backup exportado com sucesso! Arquivo salvo.')
    el('export-password').value = ''
    el('export-use-password').checked = false
    el('export-password').style.display = 'none'
  } catch (err) {
    showResult('export-result', 'error', `Erro ao exportar: ${err.message}`)
  } finally {
    el('export-backup-btn').disabled = false
  }
}

async function onImportBackup () {
  // Create hidden file input
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.zip'
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const usePassword = el('import-use-password').checked
    const password = usePassword ? el('import-password').value : null

    if (usePassword && !password) {
      showResult('import-result', 'error', 'Por favor, digite a senha do backup')
      return
    }

    showResult('import-result', '', 'Importando backup…')
    el('import-backup-btn').disabled = true

    try {
      const arrayBuffer = await file.arrayBuffer()
      const zipData = Array.from(new Uint8Array(arrayBuffer))

      const result = await window.api.backup.importBackup(zipData, password)

      if (result.ok) {
        const msg = `✓ Backup importado com sucesso!\n` +
          `Identidade: ${result.imported.publicKeyHex.slice(0, 16)}…\n` +
          `Posts: ${result.imported.postsCount} | Seguindo: ${result.imported.followsCount}`
        showResult('import-result', 'success', msg)

        el('import-password').value = ''
        el('import-use-password').checked = false
        el('import-password').style.display = 'none'

        // Reload app after 2 seconds
        setTimeout(() => {
          window.location.href = 'index.html'
        }, 2000)
      } else {
        showResult('import-result', 'error', `Erro ao importar: ${result.reason}`)
      }
    } catch (err) {
      showResult('import-result', 'error', `Erro ao processar arquivo: ${err.message}`)
    } finally {
      el('import-backup-btn').disabled = false
    }
  })
  input.click()
}

async function onOpenBackupsFolder () {
  await window.api.backup.openBackupsFolder()
}

function showResult (elementId, type, message) {
  const elem = el(elementId)
  elem.textContent = message
  elem.className = 'progress show ' + type
  if (type === '') {
    elem.className = 'progress show'
  }
}

async function loadSettings () {
  // TODO: Carregar de IPC quando implementado
  // Por enquanto, apenas UI padrão
}

async function saveSettings () {
  // TODO: Salvar via IPC quando implementado
}

document.addEventListener('DOMContentLoaded', init)

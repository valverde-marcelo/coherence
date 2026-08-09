'use strict'

window.coherenceConfirm = function confirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm }) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.setAttribute('role', 'presentation')

  const dialog = document.createElement('section')
  dialog.className = 'confirm-dialog'
  dialog.setAttribute('role', 'alertdialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'confirm-dialog-title')
  dialog.innerHTML = `
    <h2 id="confirm-dialog-title"></h2>
    <p class="confirm-dialog-message"></p>
    <div class="modal-actions">
      <button type="button" class="btn btn--ghost confirm-cancel"></button>
      <button type="button" class="btn btn--danger confirm-submit"></button>
    </div>
  `
  dialog.querySelector('h2').textContent = title
  dialog.querySelector('.confirm-dialog-message').textContent = message
  dialog.querySelector('.confirm-cancel').textContent = cancelLabel
  dialog.querySelector('.confirm-submit').textContent = confirmLabel

  const close = () => overlay.remove()
  dialog.querySelector('.confirm-cancel').addEventListener('click', close)
  dialog.querySelector('.confirm-submit').addEventListener('click', async () => {
    dialog.querySelector('.confirm-submit').disabled = true
    await onConfirm()
    close()
  })
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close()
  })
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)
  dialog.querySelector('.confirm-cancel').focus()
}

'use strict'

const accountsEl = document.getElementById('accounts')

window.pickerApi.onAccounts((keys) => {
  accountsEl.innerHTML = ''
  keys.forEach((key, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'account'
    const short = key.length > 18 ? key.slice(0, 16) + '…' : key
    button.innerHTML =
      '<span class="badge">' + (index + 1) + '</span>' +
      '<span><div>Conta ' + (index + 1) + '</div><div class="key">' + short + '</div></span>'
    button.addEventListener('click', () => window.pickerApi.choose(key))
    accountsEl.appendChild(button)
  })
})

document.getElementById('new-account').addEventListener('click', () => window.pickerApi.choose('__new__'))
document.getElementById('cancel').addEventListener('click', () => window.pickerApi.cancel())

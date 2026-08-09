'use strict'

window.coherenceSettings = {
  els: {},
  open() {
    this.els.modal.hidden = false
    this.selectTab('settings')
    this.els.locale.value = window.coherenceI18n.locale
  },
  close() {
    this.els.modal.hidden = true
  },
  selectTab(tab) {
    this.els.tabs.forEach((button) => button.classList.toggle('tab-btn--active', button.dataset.tab === tab))
    this.els.panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== tab })
    if (tab === 'about') window.coherenceAbout.render(this.els.about)
    if (tab === 'faq') window.coherenceFaq.render(this.els.faq)
  },
  async exportIdentity() {
    this.setStatus('exportingIdentity')
    try {
      const result = await window.p2p.exportIdentity()
      this.setStatus(result.success ? 'exportSuccess' : 'exportCanceled')
    } catch {
      this.setStatus('exportError')
    }
  },
  async resetApp() {
    window.coherenceConfirm({
      title: window.coherenceI18n.text('resetConfirmTitle'),
      message: window.coherenceI18n.text('resetConfirmMessage'),
      confirmLabel: window.coherenceI18n.text('confirmReset'),
      cancelLabel: window.coherenceI18n.text('cancel'),
      onConfirm: async () => {
        this.setStatus('resetting')
        const result = await window.p2p.resetApp()
        if (!result.success) this.setStatus('resetError')
      }
    })
  },
  setStatus(key) {
    this.els.status.textContent = window.coherenceI18n.text(key)
    this.els.status.hidden = false
  },
  init() {
    this.els = {
      modal: document.getElementById('settings-modal'),
      locale: document.getElementById('settings-locale'),
      status: document.getElementById('settings-status'),
      about: document.getElementById('about-panel'),
      faq: document.getElementById('faq-panel'),
      tabs: [...document.querySelectorAll('[data-settings-tab]')],
      panels: [...document.querySelectorAll('[data-settings-panel]')]
    }
    document.getElementById('open-settings-btn').addEventListener('click', () => this.open())
    document.getElementById('close-settings-btn').addEventListener('click', () => this.close())
    this.els.modal.addEventListener('click', (event) => { if (event.target === this.els.modal) this.close() })
    this.els.tabs.forEach((button) => button.addEventListener('click', () => this.selectTab(button.dataset.tab)))
    this.els.locale.addEventListener('change', async () => {
      const settings = await window.p2p.setup.setSettings({ locale: this.els.locale.value })
      window.coherenceI18n.apply(settings.locale)
      this.els.locale.value = settings.locale
      if (!this.els.faq.hidden) window.coherenceFaq.render(this.els.faq)
    })
    document.getElementById('export-identity-btn').addEventListener('click', () => this.exportIdentity())
    document.getElementById('reset-app-btn').addEventListener('click', () => this.resetApp())
  }
}

window.coherenceSettingsReady = (() => {
  window.coherenceSettings.init()
})()

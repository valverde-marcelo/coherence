'use strict'

window.coherenceAbout = {
  async render(container) {
    container.innerHTML = `
      <div class="about-grid">
        <div>
          <p class="eyebrow" data-i18n="aboutProject">projeto</p>
          <h2>Coherence</h2>
          <p data-i18n="aboutDescription"></p>
          <p class="about-version"><span data-i18n="aboutVersion">versão</span> <strong id="about-version-value">...</strong></p>
          <a href="https://github.com/valverde-marcelo/coherence" class="about-link" id="about-github" data-i18n="aboutGithub">repositório no GitHub</a>
        </div>
        <div>
          <p class="eyebrow" data-i18n="aboutStackTitle">tecnologia</p>
          <ul class="about-stack">
            <li>Node.js</li><li>Electron</li><li>Hypercore / Hyperbee</li><li>Hyperswarm / Corestore</li><li>Protomux</li>
          </ul>
        </div>
        <div class="donation-block">
          <div class="donation-copy">
            <p data-i18n="donationCaption">Contribua com o desenvolvimento</p>
            <button id="donation-paypal" type="button" class="btn btn--accent btn--small" hidden data-i18n="donatePaypal">doar via PayPal</button>
            <div id="donation-coins" class="donation-coins"></div>
            <p id="donation-address" class="donation-address" hidden></p>
          </div>
          <img id="donation-qr" class="donation-qr" alt="" />
        </div>
      </div>
    `
    container.querySelector('#about-github').addEventListener('click', (event) => {
      event.preventDefault()
      window.p2p.openExternal('https://github.com/valverde-marcelo/coherence')
    })

    const [version, donation] = await Promise.all([
      window.p2p.getAppVersion(),
      window.p2p.getDonationInfo()
    ])
    container.querySelector('#about-version-value').textContent = version

    const qrEl = container.querySelector('#donation-qr')
    const addressEl = container.querySelector('#donation-address')
    const coinsEl = container.querySelector('#donation-coins')
    const paypalBtn = container.querySelector('#donation-paypal')

    const showQr = async (content, label) => {
      qrEl.src = await window.p2p.getDonationQr(content)
      qrEl.alt = label || content
      addressEl.textContent = label || ''
      addressEl.hidden = !label
    }

    const paypal = typeof donation.paypalUrl === 'string' && donation.paypalUrl ? donation.paypalUrl : ''
    const crypto = Array.isArray(donation.crypto) ? donation.crypto : []

    if (paypal) {
      paypalBtn.hidden = false
      paypalBtn.addEventListener('click', () => window.p2p.openExternal(paypal))
    }

    if (crypto.length > 0) {
      crypto.forEach((item, index) => {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'donation-coin' + (index === 0 ? ' donation-coin--active' : '')
        chip.textContent = item.coin || item.address
        chip.addEventListener('click', () => {
          coinsEl.querySelectorAll('.donation-coin').forEach((c) => c.classList.remove('donation-coin--active'))
          chip.classList.add('donation-coin--active')
          showQr(item.address, item.coin)
        })
        coinsEl.appendChild(chip)
      })
      await showQr(crypto[0].address, crypto[0].coin)
    } else {
      // Fallback: QR to the GitHub repo until donation addresses are configured.
      qrEl.src = await window.p2p.getDonationQr('https://github.com/valverde-marcelo/coherence')
      qrEl.alt = 'Coherence'
    }

    window.coherenceI18n.apply(window.coherenceI18n.locale)
  }
}

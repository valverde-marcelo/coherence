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
          <img id="donation-qr" class="donation-qr" alt="" />
          <p data-i18n="donationCaption">Contribua com o desenvolvimento</p>
        </div>
      </div>
    `
    container.querySelector('#about-github').addEventListener('click', (event) => {
      event.preventDefault()
      window.p2p.openExternal('https://github.com/valverde-marcelo/coherence')
    })
    const [version, qr] = await Promise.all([
      window.p2p.getAppVersion(),
      window.p2p.getDonationQr()
    ])
    container.querySelector('#about-version-value').textContent = version
    container.querySelector('#donation-qr').src = qr
    window.coherenceI18n.apply(window.coherenceI18n.locale)
  }
}

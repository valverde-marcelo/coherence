'use strict'

let ownPubkey = ''
let pendingAttachments = [] // { path, mime, previewDataUrl }

const el = id => document.getElementById(id)

function shortKey (hex, len = 10) {
  return hex ? `${hex.slice(0, len)}…${hex.slice(-4)}` : ''
}

function formatBytesPerSec (n) {
  if (!n) return '0 KB/s'
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB/s`
  return `${(kb / 1024).toFixed(2)} MB/s`
}

// i18n helper
async function t (key, defaultValue = '') {
  return await window.api.i18n.t(key, defaultValue)
}

async function applyTranslations () {
  // Apply text translations
  document.querySelectorAll('[data-i18n]').forEach(async el => {
    const key = el.dataset.i18n
    el.textContent = await t(key)
  })

  // Apply placeholder translations
  document.querySelectorAll('[data-i18n-placeholder]').forEach(async el => {
    const key = el.dataset.i18nPlaceholder
    el.placeholder = await t(key)
  })
}

function switchTab (name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`))
}

async function initLanguageSwitcher () {
  const select = el('language-select')
  const langs = await window.api.i18n.getAvailableLanguages()
  const currentLang = await window.api.i18n.getCurrentLang()

  for (const lang of langs) {
    const label = await window.api.i18n.getLanguageLabel(lang)
    const option = document.createElement('option')
    option.value = lang
    option.textContent = label
    option.selected = lang === currentLang
    select.appendChild(option)
  }

  select.addEventListener('change', async (e) => {
    await window.api.i18n.setLang(e.target.value)
    // Reload to apply new language
    window.location.reload()
  })
}

async function init () {
  // Initialize language switcher
  await initLanguageSwitcher()
  await applyTranslations()

  const identity = await window.api.getIdentity()
  ownPubkey = identity.publicKeyHex
  el('own-pubkey').textContent = shortKey(ownPubkey, 16)
  el('own-pubkey').title = ownPubkey

  const profile = await window.api.getProfile()
  el('display-name').value = profile.displayName || ''

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })

  el('copy-pubkey').addEventListener('click', async () => {
    navigator.clipboard.writeText(ownPubkey)
    const copiedText = await t('common.copied', 'Copiado!')
    el('copy-pubkey').textContent = copiedText
    setTimeout(async () => {
      const copyText = await t('common.copy', 'Copiar')
      el('copy-pubkey').textContent = copyText
    }, 1500)
  })

  el('settings-btn').addEventListener('click', () => {
    window.location.href = 'settings.html'
  })

  el('display-name').addEventListener('change', onDisplayNameChange)
  el('attach-btn').addEventListener('click', onAttachClick)
  el('publish-btn').addEventListener('click', onPublishClick)
  el('follow-add-btn').addEventListener('click', onFollowAddClick)
  el('user-search-btn').addEventListener('click', onUserSearch)
  el('user-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') onUserSearch() })

  await refreshFeed()
  await refreshFollows()
  await refreshStats()
  await onUserSearch() // mostra sugestões (conhecidos recentes) mesmo sem busca

  setInterval(refreshFeed, 8000)
  setInterval(refreshFollows, 8000)
  setInterval(refreshStats, 4000)
}

async function onDisplayNameChange () {
  const name = el('display-name').value.trim()
  try {
    await window.api.setDisplayName(name)
  } catch (err) {
    const errMsg = await t('errors.displayNameError', 'Erro ao salvar nome:')
    alert(errMsg + ' ' + err.message)
  }
}

async function onAttachClick () {
  const picked = await window.api.pickImages()
  for (const item of picked) {
    pendingAttachments.push(item)
  }
  renderAttachmentPreviews()
}

function renderAttachmentPreviews () {
  const box = el('composer-attachments')
  box.innerHTML = ''
  for (const att of pendingAttachments) {
    const img = document.createElement('img')
    img.src = att.previewDataUrl
    box.appendChild(img)
  }
}

async function onPublishClick () {
  const text = el('post-text').value.trim()
  if (!text && pendingAttachments.length === 0) return
  el('publish-btn').disabled = true
  try {
    await window.api.createPost(text, pendingAttachments.map(a => a.path))
    el('post-text').value = ''
    pendingAttachments = []
    renderAttachmentPreviews()
    await refreshFeed()
  } catch (err) {
    const errMsg = await t('errors.publishError', 'Erro ao publicar:')
    alert(errMsg + ' ' + err.message)
  } finally {
    el('publish-btn').disabled = false
  }
}

async function onFollowAddClick () {
  const pubkeyHex = el('follow-pubkey').value.trim().toLowerCase()
  const alias = el('follow-alias').value.trim()
  if (!pubkeyHex) return
  try {
    await window.api.addFollow(pubkeyHex, alias)
    el('follow-pubkey').value = ''
    el('follow-alias').value = ''
    await refreshFollows()
  } catch (err) {
    const errMsg = await t('errors.followError', 'Erro ao seguir:')
    alert(errMsg + ' ' + err.message)
  }
}

async function refreshFeed () {
  const posts = await window.api.getFeed()
  const list = el('feed-list')
  if (!posts.length) {
    const emptyMsg = await t('feed.emptyWithoutFollows', 'Nenhum post ainda. Publique algo ou siga alguém pela chave pública.')
    list.innerHTML = `<div class="empty-hint">${emptyMsg}</div>`
    return
  }
  list.innerHTML = ''
  for (const post of posts) {
    list.appendChild(await renderPostCard(post))
  }
}

async function renderPostCard (post) {
  const card = document.createElement('div')
  card.className = 'post-card'

  const header = document.createElement('div')
  header.className = 'post-header'
  const author = document.createElement('span')
  author.className = 'post-author' + (post.isOwn ? ' own' : '')
  if (post.isOwn) {
    author.textContent = await t('feed.youLabel', 'Você')
  } else {
    author.textContent = shortKey(post.pubkeyHex)
  }
  const time = document.createElement('span')
  time.className = 'post-time'
  time.dataset.timestamp = post.ts
  const currentLang = await window.api.i18n.getCurrentLang()
  const localeMap = { 'pt-BR': 'pt-BR', 'en': 'en-US' }
  const timeAgo = formatTimeAgo(post.ts)
  const date = new Date(post.ts).toLocaleString(localeMap[currentLang] || 'pt-BR')
  time.textContent = timeAgo
  time.title = date
  header.appendChild(author)
  header.appendChild(time)
  card.appendChild(header)

  if (post.text) {
    const text = document.createElement('div')
    text.className = 'post-text'
    text.textContent = post.text
    card.appendChild(text)
  }

  if (post.media && post.media.length) {
    const mediaBox = document.createElement('div')
    mediaBox.className = 'post-media'
    for (const m of post.media) {
      const dataUrl = await window.api.readMedia(post.pubkeyHex, post.isOwn, m.sha256, m.mime)
      if (dataUrl) {
        const img = document.createElement('img')
        img.src = dataUrl
        mediaBox.appendChild(img)
      }
    }
    card.appendChild(mediaBox)
  }

  const footer = document.createElement('div')
  footer.className = 'post-footer'
  const footerFmt = await t('feed.postFooterFmt', 'seq {seq} · hash {hash}…')
  footer.textContent = footerFmt
    .replace('{seq}', post.seq)
    .replace('{hash}', post.hash.slice(0, 12))
  card.appendChild(footer)

  return card
}

async function refreshFollows () {
  const follows = await window.api.listFollows()
  const list = el('follows-list')
  if (!follows.length) {
    const emptyMsg = await t('follows.emptyList', 'Você ainda não segue ninguém. Cole a chave pública de alguém acima.')
    list.innerHTML = `<div class="empty-hint">${emptyMsg}</div>`
    return
  }
  list.innerHTML = ''
  for (const f of follows) {
    const card = document.createElement('div')
    card.className = 'follow-card'
    const info = document.createElement('div')
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = f.remoteDisplayName || f.alias
    const pk = document.createElement('span')
    pk.className = 'pubkey'
    pk.textContent = f.pubkeyHex
    const meta = document.createElement('span')
    meta.className = 'meta'
    if (f.lastSeq != null) {
      const metaText = await t('follows.lastSeqMeta_other', 'último post: seq')
      meta.textContent = `${metaText} ${f.lastSeq}`
    } else {
      meta.textContent = await t('follows.awaitingSync', 'aguardando primeira sincronização…')
    }
    info.appendChild(name)
    info.appendChild(pk)
    info.appendChild(meta)

    const removeBtn = document.createElement('button')
    removeBtn.className = 'danger'
    removeBtn.textContent = await t('follows.unfollowBtn', 'Deixar de seguir')
    removeBtn.addEventListener('click', async () => {
      await window.api.removeFollow(f.pubkeyHex)
      await refreshFollows()
      await refreshFeed()
    })

    card.appendChild(info)
    card.appendChild(removeBtn)
    list.appendChild(card)
  }
}

async function refreshStats () {
  const stats = await window.api.getStats()
  const peersLabel = await t('stats.peers', 'peers:')
  const downLabel = await t('stats.downloadLabel', '↓')
  const upLabel = await t('stats.uploadLabel', '↑')
  const torrentsLabel = await t('stats.torrents', 'torrents:')
  el('stats').innerHTML =
    `<span>${peersLabel} <b>${stats.peers}</b></span>` +
    `<span>${downLabel} <b>${formatBytesPerSec(stats.downloadSpeed)}</b></span>` +
    `<span>${upLabel} <b>${formatBytesPerSec(stats.uploadSpeed)}</b></span>` +
    `<span>${torrentsLabel} <b>${stats.torrents}</b></span>`
}

async function onUserSearch () {
  const query = el('user-search-input').value.trim()
  const results = await window.api.searchUsers(query)
  const box = el('user-search-results')
  if (!results.length) {
    let emptyMsg
    if (query) {
      emptyMsg = await t('search.notFound', 'Nenhum usuário encontrado.')
    } else {
      emptyMsg = await t('search.noUsersKnown', 'Ainda não há usuários conhecidos — siga alguém para começar a descobrir a rede.')
    }
    box.innerHTML = `<div class="empty-hint">${emptyMsg}</div>`
    return
  }
  box.innerHTML = ''
  for (const u of results) {
    const card = document.createElement('div')
    card.className = 'user-result-card'
    const info = document.createElement('div')
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = u.displayName || u.alias || shortKey(u.pubkeyHex)
    const pk = document.createElement('span')
    pk.className = 'pubkey'
    pk.textContent = u.pubkeyHex
    const meta = document.createElement('span')
    meta.className = 'meta'
    if (u.discoveredVia === 'direct') {
      meta.textContent = await t('search.youFollow', 'você segue')
    } else {
      const viaFmt = await t('search.discoveredViaFmt', 'descoberto via {user}')
      meta.textContent = viaFmt.replace('{user}', shortKey(u.discoveredVia, 8))
    }
    info.appendChild(name)
    info.appendChild(pk)
    info.appendChild(meta)

    card.appendChild(info)
    if (u.isFollowing) {
      const badge = document.createElement('span')
      badge.className = 'meta'
      badge.textContent = await t('search.alreadyFollows', 'já segue ✓')
      card.appendChild(badge)
    } else {
      const followBtn = document.createElement('button')
      followBtn.className = 'primary'
      followBtn.textContent = await t('search.followBtn', 'Seguir')
      followBtn.addEventListener('click', async () => {
        try {
          await window.api.addFollow(u.pubkeyHex, u.displayName || u.alias || '')
          await refreshFollows()
          await onUserSearch()
        } catch (err) {
          const errMsg = await t('errors.followError', 'Erro ao seguir:')
          alert(errMsg + ' ' + err.message)
        }
      })
      card.appendChild(followBtn)
    }
    box.appendChild(card)
  }
}

init()

// ===== QR CODE & PROGRESS TRACKING =====

let currentSealingPostCount = 0
let maxPostsPerChapter = 10

function initQRCodeButton () {
  el('qrcode-btn').addEventListener('click', async () => {
    const modal = el('qrcode-modal')
    const canvas = el('qrcode-canvas')
    canvas.innerHTML = ''
    
    try {
      const QRCode = window.QRCode || (await import('https://cdn.jsdelivr.net/npm/qrcode@latest')).default
      await QRCode.toCanvas(canvas, `coherence://follow/${ownPubkey}`, { width: 280, margin: 1, color: { dark: '#000', light: '#fff' } })
      modal.style.display = 'flex'
    } catch (err) {
      console.error('[qrcode] erro:', err)
      alert('Erro ao gerar QR code: ' + err.message)
    }
  })
  
  el('qrcode-modal-close').addEventListener('click', () => {
    el('qrcode-modal').style.display = 'none'
  })
  el('qrcode-modal-ok').addEventListener('click', () => {
    el('qrcode-modal').style.display = 'none'
  })
  
  // Close modal on background click
  el('qrcode-modal').addEventListener('click', (e) => {
    if (e.target.id === 'qrcode-modal') {
      el('qrcode-modal').style.display = 'none'
    }
  })
}

function setupChapterProgressListeners () {
  // Listen for post added to open chapter
  window.api.onChapterPostAdded((data) => {
    currentSealingPostCount = data.postCount
    maxPostsPerChapter = data.maxPostsPerChapter
    updateProgressDisplay()
  })
  
  // Listen for chapter sealing started
  window.api.onChapterSealing((data) => {
    el('seal-progress').style.display = 'flex'
    currentSealingPostCount = data.postCount
    updateProgressDisplay('sealing')
  })
  
  // Listen for chapter saved to disk
  window.api.onChapterSaved((data) => {
    updateProgressDisplay('saved')
  })
  
  // Listen for seeding started
  window.api.onChapterSeedingStarted((data) => {
    updateProgressDisplay('seeding', data.infohash)
  })
  
  // Listen for rate limiting
  window.api.onChapterRateLimited(async (data) => {
    const progressText = el('seal-progress-text')
    const waitSecs = Math.ceil(data.waitMs / 1000)
    progressText.textContent = `Taxa limite: aguarde ${waitSecs}s`
  })
}

function updateProgressDisplay (stage = 'adding', infohash = null) {
  const progressText = el('seal-progress-text')
  const progressFill = el('seal-progress-fill')
  const percent = Math.round((currentSealingPostCount / maxPostsPerChapter) * 100)
  progressFill.style.width = percent + '%'
  
  if (stage === 'sealing') {
    progressText.textContent = `Selando capítulo: ${currentSealingPostCount}/${maxPostsPerChapter} posts...`
  } else if (stage === 'saved') {
    progressText.textContent = 'Capítulo salvo, iniciando distribuição via BitTorrent...'
  } else if (stage === 'seeding') {
    progressText.textContent = 'Distribuindo capítulo para a rede P2P ✓'
    setTimeout(() => {
      el('seal-progress').style.display = 'none'
      currentSealingPostCount = 0
    }, 2000)
  } else {
    progressText.textContent = `Posts em aberto: ${currentSealingPostCount}/${maxPostsPerChapter}`
  }
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', async () => {
  await init()
  await refreshFeed()
  await refreshFollows()
  await refreshStats()
  setInterval(refreshStats, 5000)
  
  // Initialize QR code functionality
  initQRCodeButton()
  
  // Setup chapter progress tracking
  setupChapterProgressListeners()
  
  // Initialize Phase 2 features (QR scanner, bootstrap users, time-ago)
  await initPhase2()
})

// ===== PHASE 2: QR SCANNER & BOOTSTRAP USERS =====

let qrScannerInstance = null
let scannedPubkey = null

// Known popular users (bootstrap for cold start)
const BOOTSTRAP_USERS = [
  { pubkeyHex: 'a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a', displayName: 'Alice', alias: 'alice' },
  { pubkeyHex: 'b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789ab', displayName: 'Bob', alias: 'bob' },
  { pubkeyHex: 'c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789abc', displayName: 'Carol', alias: 'carol' },
  { pubkeyHex: 'd4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789abcd', displayName: 'David', alias: 'david' },
  { pubkeyHex: 'e5f6789abcdef0123456789abcdef0123456789abcdef0123456789abcde', displayName: 'Eve', alias: 'eve' },
  { pubkeyHex: 'f6789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', displayName: 'Frank', alias: 'frank' }
]

// Initialize QR Scanner
async function initQRScanner () {
  el('follow-qr-scan-btn').addEventListener('click', openQRScannerModal)
  el('qrcode-scanner-modal-close').addEventListener('click', closeQRScannerModal)
  el('qrcode-scanner-modal-close-btn').addEventListener('click', closeQRScannerModal)
  el('qrcode-scanner-modal-use').addEventListener('click', useScannedQRCode)
  
  // Close modal on background click
  el('qrcode-scanner-modal').addEventListener('click', (e) => {
    if (e.target.id === 'qrcode-scanner-modal') closeQRScannerModal()
  })
}

async function openQRScannerModal () {
  el('qrcode-scanner-modal').style.display = 'flex'
  scannedPubkey = null
  el('qr-scanner-result').value = ''
  el('qrcode-scanner-modal-use').style.display = 'none'
  
  try {
    // Dynamically import html5-qrcode if not already available
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.4/dist/html5-qrcode.min.js'
    script.onload = initScanner
    document.head.appendChild(script)
  } catch (err) {
    console.error('[qr-scanner] erro ao carregar lib:', err)
    alert('Erro ao inicializar c�mera')
  }
}

async function initScanner () {
  try {
    if (!window.Html5Qrcode) {
      console.error('Html5Qrcode n�o carregou')
      return
    }
    
    qrScannerInstance = new window.Html5Qrcode('qr-scanner')
    
    await qrScannerInstance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onQRCodeScanned,
      undefined
    )
  } catch (err) {
    console.error('[qr-scanner] erro ao iniciar:', err)
    // Fallback: manual paste
    el('qrcode-scanner-modal').innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Escanear QR Code (Câmera não disponível)</h2>
          <button class="modal-close" onclick="closeQRScannerModal()" style="background: none; border: none; cursor: pointer; font-size: 24px; color: #999;">✕</button>
        </div>
        <div class="modal-body">
          <p>Cole a chave pública abaixo:</p>
          <input id="qr-scanner-result" type="text" placeholder="Chave pública (64 caracteres hex)" style="width: 100%; padding: 8px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text);" />
        </div>
        <div class="modal-footer">
          <button class="primary" onclick="useScannedQRCode()" style="background: var(--accent); color: white; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer;">Usar</button>
          <button onclick="closeQRScannerModal()" style="padding: 8px 16px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; color: var(--text);">Fechar</button>
        </div>
      </div>
    `
  }
}

function onQRCodeScanned (decodedText) {
  // Parse coherence://follow/{pubkey} or raw hex
  let pubkey = decodedText
  if (decodedText.includes('coherence://follow/')) {
    pubkey = decodedText.split('coherence://follow/')[1]?.split(/[^a-fA-F0-9]/)[0]
  }
  
  if (pubkey && pubkey.length === 64 && /^[a-fA-F0-9]{64}\$/.test(pubkey)) {
    scannedPubkey = pubkey.toLowerCase()
    el('qr-scanner-result').value = scannedPubkey
    el('qrcode-scanner-modal-use').style.display = 'block'
    
    // Stop scanner on successful scan
    if (qrScannerInstance) {
      qrScannerInstance.stop().catch(() => {})
    }
  }
}

function closeQRScannerModal () {
  if (qrScannerInstance) {
    qrScannerInstance.stop().catch(() => {})
    qrScannerInstance = null
  }
  scannedPubkey = null
  el('qrcode-scanner-modal').style.display = 'none'
}

async function useScannedQRCode () {
  const pubkey = el('qr-scanner-result').value.trim().toLowerCase()
  if (!pubkey || pubkey.length !== 64) {
    alert('Chave p�blica inv�lida')
    return
  }
  
  el('follow-pubkey').value = pubkey
  el('follow-alias').value = ''
  closeQRScannerModal()
  
  // Auto-focus on alias field
  el('follow-alias').focus()
}

// Initialize Popular Users (Bootstrap for cold start)
async function initPopularUsers () {
  const follows = await window.api.listFollows()
  const followedPubkeys = follows.map(f => f.pubkeyHex)
  
  // Only show if user has <2 follows
  if (followedPubkeys.length < 2) {
    const section = el('popular-users-section')
    section.style.display = 'block'
    
    const list = el('popular-users-list')
    list.innerHTML = ''
    
    for (const user of BOOTSTRAP_USERS) {
      if (followedPubkeys.includes(user.pubkeyHex)) continue
      
      const card = document.createElement('div')
      card.className = 'popular-user-card'
      
      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = user.displayName
      
      const pubkey = document.createElement('div')
      pubkey.className = 'pubkey'
      pubkey.textContent = user.pubkeyHex.slice(0, 16) + '�'
      pubkey.title = user.pubkeyHex
      
      const btn = document.createElement('button')
      btn.textContent = 'Seguir'
      btn.addEventListener('click', async () => {
        try {
          await window.api.addFollow(user.pubkeyHex, user.alias)
          await refreshFollows()
          await refreshFeed()
          // Refresh popular users list
          await initPopularUsers()
        } catch (err) {
          alert('Erro: ' + err.message)
        }
      })
      
      card.appendChild(name)
      card.appendChild(pubkey)
      card.appendChild(btn)
      list.appendChild(card)
    }
  } else {
    el('popular-users-section').style.display = 'none'
  }
}

// ===== TIME-AGO FORMATTING WITH date-fns =====

// Simple time-ago without external lib (fallback)
function formatTimeAgo (timestamp) {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  
  if (diffSecs < 60) return 'agora'
  if (diffMins < 60) return `${diffMins}m atrás`
  if (diffHours < 24) return `${diffHours}h atrás`
  if (diffDays < 7) return `${diffDays}d atrás`
  if (diffWeeks < 4) return `${diffWeeks}w atrás`
  if (diffMonths < 12) return `${diffMonths}mo atrás`
  
  const date = new Date(timestamp)
  return date.toLocaleDateString('pt-BR')
}

// Update post timestamps with time-ago
function updatePostTimestamps () {
  document.querySelectorAll('.post-time').forEach(el => {
    const timestamp = parseInt(el.dataset.timestamp, 10)
    if (timestamp) {
      const timeAgo = formatTimeAgo(timestamp)
      const date = new Date(timestamp).toLocaleString('pt-BR')
      el.textContent = timeAgo
      el.title = date
    }
  })
}

// Update timestamps periodically (every 30s)
setInterval(updatePostTimestamps, 30000)

// Initialize Phase 2 features
async function initPhase2 () {
  await initPopularUsers()
  initQRScanner()
  updatePostTimestamps()
}

// Wrap original refreshFeed to update timestamps
const originalRefreshFeed = window.refreshFeed
window.refreshFeed = async function () {
  await originalRefreshFeed.call(this)
  updatePostTimestamps()
}

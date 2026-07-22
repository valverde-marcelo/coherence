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
  const currentLang = await window.api.i18n.getCurrentLang()
  const localeMap = { 'pt-BR': 'pt-BR', 'en': 'en-US' }
  time.textContent = new Date(post.ts).toLocaleString(localeMap[currentLang] || 'pt-BR')
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

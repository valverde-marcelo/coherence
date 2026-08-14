'use strict'

const t = (key) => window.coherenceI18n.text(key)

const els = {
  // Identity & Profile
  myName: document.getElementById('my-name'),
  myKey: document.getElementById('my-key'),
  keyText: document.getElementById('key-text'),
  copyFeedback: document.getElementById('copy-feedback'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  avatarSection: document.getElementById('avatar-section'),
  avatarDisplay: document.getElementById('avatar-display'),
  avatarUpload: document.getElementById('avatar-upload'),

  // Profile Form
  profileForm: document.getElementById('profile-form'),
  profileNome: document.getElementById('profile-nome'),
  profileBio: document.getElementById('profile-bio'),
  addLinkBtn: document.getElementById('add-link-btn'),
  linksList: document.getElementById('links-list'),

  // Following & Search
  followForm: document.getElementById('follow-form'),
  followKey: document.getElementById('follow-key'),
  followError: document.getElementById('follow-error'),
  followingCount: document.getElementById('following-count'),
  followingList: document.getElementById('following-list'),

  searchViewContainer: document.getElementById('search-view-container'),
  searchInput: document.getElementById('search-input'),
  searchBtn: document.getElementById('search-btn'),
  searchResults: document.getElementById('search-results'),
  backToFeedFromSearchBtn: document.getElementById('back-to-feed-from-search-btn'),
  openSearchBtn: document.getElementById('open-search-btn'),

  // Right Sidebar Tabs
  tabFollowing: document.getElementById('tab-following'),
  tabFollowers: document.getElementById('tab-followers'),
  tabContentFollowing: document.getElementById('tab-content-following'),
  tabContentFollowers: document.getElementById('tab-content-followers'),
  followersList: document.getElementById('followers-list'),
  followersCount: document.getElementById('followers-count'),

  // Composer & Feed
  composerForm: document.getElementById('composer-form'),
  composerText: document.getElementById('composer-text'),
  composerImage: document.getElementById('composer-image'),
  composerImageName: document.getElementById('composer-image-name'),
  composerError: document.getElementById('composer-error'),
  feed: document.getElementById('feed'),
  feedEmpty: document.getElementById('feed-empty'),

  // Profile View
  profileViewContainer: document.getElementById('profile-view-container'),
  profileView: document.getElementById('profile-view'),
  backToFeedBtn: document.getElementById('back-to-feed-btn'),

  // Templates
  postTemplate: document.getElementById('post-template'),
  peerTemplate: document.getElementById('peer-template'),
  linkTemplate: document.getElementById('link-template')
}

let myKey = null
let currentProfile = null
let pendingImage = null // { dataBase64, mime, name }
let pendingLinks = [] // Links sendo editados no profile
let currentFollowingList = [] // Cache of the following list with status
let statusUpdateInterval = null
let profileCache = {} // Profile cache to avoid multiple requests
let currentViewingProfileKey = null // Key of the profile being viewed
let profileSocialData = null // { following, followers, ... } of the viewed user (profile view)
let profileSocialType = null // 'following' | 'followers' | null — which social list is open
let profileSocialPanel = null // Panel element with the social list (profile view)
let profileReturnTarget = 'feed' // 'feed' | 'search' — where "voltar" in the profile view returns to
let pendingImageName = null // Name of the image currently attached to the composer
let lastRenderedLocale = null // Locale used by the last refreshMainUI render

// =====================================================================
// UTILITIES
// =====================================================================

function shortKey(key) {
  return key.slice(0, 8) + '…' + key.slice(-4)
}

function formatTime(ts) {
  const locale = (window.coherenceI18n && window.coherenceI18n.locale) || 'pt-BR'
  return new Date(ts).toLocaleString(locale, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const [, base64] = String(reader.result).split(',')
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function showError(el, message) {
  el.textContent = message
  el.hidden = false
}

function clearError(el) {
  el.hidden = true
  el.textContent = ''
}

function getInitials(name) {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'
}

async function copyToClipboard(text, feedbackEl) {
  try {
    await navigator.clipboard.writeText(text)
    if (feedbackEl) {
      feedbackEl.hidden = false
      setTimeout(() => { feedbackEl.hidden = true }, 1500)
    }
  } catch (err) {
    console.error('Error copying to clipboard:', err)
  }
}

// =====================================================================
// RENDERING
// =====================================================================

function renderIdentity(profile) {
  currentProfile = profile
  els.myName.textContent = profile.nome || t('noName')
  els.keyText.textContent = myKey
  els.profileNome.value = profile.nome || ''
  els.profileBio.value = profile.bio || ''
  
  // Avatar
  const initials = getInitials(profile.nome || t('userDefault'))
  if (profile.avatar) {
    const img = document.createElement('img')
    img.src = `data:${profile.avatar.mime};base64,${profile.avatar.dataBase64}`
    els.avatarDisplay.innerHTML = ''
    els.avatarDisplay.appendChild(img)
  } else {
    els.avatarDisplay.innerHTML = `<span class="avatar-initials">${initials}</span>`
  }

  // Links
  pendingLinks = [...(profile.links || [])]
  renderLinksList()
}

function renderLinksList() {
  els.linksList.innerHTML = ''
  for (let i = 0; i < pendingLinks.length; i++) {
    const link = pendingLinks[i]
    const node = els.linkTemplate.content.cloneNode(true)
    const titleEl = node.querySelector('.link-title')
    titleEl.textContent = link.titulo || t('link')
    titleEl.href = link.url
    node.querySelector('.link-remove').addEventListener('click', () => {
      pendingLinks.splice(i, 1)
      renderLinksList()
    })
    els.linksList.appendChild(node)
  }
}

async function refreshStatus() {
  try {
    const count = await window.p2p.getPeerCount()
    els.statusText.textContent = count === 0
      ? t('noPeersConnected')
      : t(count === 1 ? 'peerConnected' : 'peersConnected').replace('{n}', String(count))
  } catch (err) {
    // Ignores transient failures (e.g. node null during reset/quit)
  }
}

function renderFollowing(list) {
  currentFollowingList = list
  els.followingCount.textContent = `(${list.length})`
  els.followingList.innerHTML = ''
  
  for (const peer of list) {
    const node = els.peerTemplate.content.cloneNode(true)
    
    // Status dot (green=online, dark=offline)
    const statusDot = node.querySelector('.peer-status-dot')
    const isOnline = peer.peersConectados > 0
    statusDot.classList.toggle('dot--online', isOnline)
    statusDot.classList.toggle('dot--offline', !isOnline)
    
    // Name (clickable -> profile view)
    const nameEl = node.querySelector('.peer-name')
    nameEl.textContent = peer.nome || (peer.sincronizando ? t('syncing') : t('noName'))
    nameEl.addEventListener('click', () => showProfileView(peer.publicKeyHex))
    
    // Key
    node.querySelector('.peer-key').textContent = shortKey(peer.publicKeyHex)
    
    // Copy key button
    node.querySelector('.peer-copy-key').addEventListener('click', async () => {
      await copyToClipboard(peer.publicKeyHex)
    })
    
    // Unfollow button
    node.querySelector('.peer-unfollow').addEventListener('click', async () => {
      await window.p2p.unfollow(peer.publicKeyHex)
      await loadFollowing()
      await loadFeed()
    })
    
    els.followingList.appendChild(node)
  }
}

function renderFeed(posts) {
  els.feed.querySelectorAll('.post').forEach((n) => n.remove())
  els.feedEmpty.hidden = posts.length > 0

  for (const post of posts) {
    const node = els.postTemplate.content.cloneNode(true)
    const authorEl = node.querySelector('.post-author')
    const isMe = post.autor === myKey
    
    // Fetch the author's name from the cache or use the short key
    let authorName = isMe ? t('you') : shortKey(post.autor)
    const cachedProfile = profileCache[post.autor]
    if (cachedProfile && cachedProfile.nome) {
      authorName = isMe ? t('you') : cachedProfile.nome
    }
    
    authorEl.textContent = authorName
    authorEl.classList.toggle('is-me', isMe)
    authorEl.style.cursor = isMe ? 'default' : 'pointer'
    
    if (!isMe) {
      authorEl.addEventListener('click', () => showProfileView(post.autor))
      // Cache the author profile when clicking or when rendering
      if (!profileCache[post.autor]) {
        window.p2p.getProfileOf(post.autor).then(p => {
          if (p) {
            profileCache[post.autor] = p
            // Update the displayed name if the element is still visible
            const currentText = authorEl.textContent
            if (currentText === shortKey(post.autor)) {
              authorEl.textContent = p.nome || currentText
            }
          }
        }).catch(() => {})
      }
    }
    
    node.querySelector('.post-time').textContent = formatTime(post.timestamp)
    node.querySelector('.post-body').textContent = post.texto || ''

    if (post.tipo === 'imagem' && post.imagem) {
      const img = node.querySelector('.post-image')
      img.src = `data:${post.imagem.mime};base64,${post.imagem.dataBase64}`
      img.hidden = false
    }

    node.querySelector('.post-footer').textContent = `#${post.seq} · ${shortKey(post.autor)}`
    els.feed.appendChild(node)
  }
}

// =====================================================================
// PROFILE VIEW
// =====================================================================

async function showProfileView(pubKeyHex) {
  try {
    currentViewingProfileKey = pubKeyHex
    
    // Always fetch a fresh profile (don't use a stale cache)
    const profile = await window.p2p.getProfileOf(pubKeyHex)
    if (profile) profileCache[pubKeyHex] = profile
    
    const posts = await window.p2p.getPostsOf(pubKeyHex)

    // Social graph (who this user follows / who follows them) — for the
    // "Seguindo / Seguidores" counts and lists.
    let social = null
    try {
      social = await window.p2p.getUserSocial(pubKeyHex)
    } catch (err) {
      console.error('Error loading social graph:', err)
    }
    
    if (!profile) {
      console.warn('Profile not available yet')
      // Continue even without a profile, it may be syncing
    }

    // Determine where "voltar" should return to, based on the view the user came
    // from: opening a profile from search results goes back to search; from the
    // feed (or sidebar) it goes back to the feed. Navigating profile → profile
    // (e.g. via the social lists) keeps the previous target.
    if (!els.searchViewContainer.hidden) {
      profileReturnTarget = 'search'
    } else if (!els.feed.hidden) {
      profileReturnTarget = 'feed'
    }

    // Hide feed and other views, show profile view
    els.composerForm.hidden = true
    els.feed.hidden = true
    els.searchViewContainer.hidden = true
    els.profileViewContainer.hidden = false

    // Render profile
    els.profileView.innerHTML = ''
    profileSocialType = null
    profileSocialPanel = null
    profileSocialData = social
    
    const header = document.createElement('div')
    header.className = 'profile-view-header'
    
    // Avatar - always show (placeholder if none)
    const avatar = document.createElement('div')
    avatar.className = 'profile-view-avatar'
    if (profile.avatar) {
      const img = document.createElement('img')
      img.src = `data:${profile.avatar.mime};base64,${profile.avatar.dataBase64}`
      avatar.appendChild(img)
    } else {
      const placeholder = document.createElement('div')
      placeholder.style.cssText = `
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, var(--panel-raised), var(--line));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 36px;
        color: var(--relay);
      `
      placeholder.textContent = getInitials(profile.nome || t('userDefault'))
      avatar.appendChild(placeholder)
    }
    header.appendChild(avatar)
    
    // Info
    const info = document.createElement('div')
    info.className = 'profile-view-info'
    
    const name = document.createElement('div')
    name.className = 'profile-view-name'
    name.textContent = profile?.nome || t('loading')
    info.appendChild(name)
    
    const key = document.createElement('div')
    key.className = 'profile-view-key'
    key.textContent = shortKey(pubKeyHex)
    key.style.cursor = 'pointer'
    key.title = t('copyFullKey')
    key.addEventListener('click', () => copyToClipboard(pubKeyHex))
    info.appendChild(key)
    
    if (profile?.bio) {
      const bio = document.createElement('div')
      bio.className = 'profile-view-bio'
      bio.textContent = profile.bio
      info.appendChild(bio)
    }
    
    if (profile?.links && profile.links.length > 0) {
      const linksDiv = document.createElement('div')
      linksDiv.className = 'profile-view-links'
      for (const link of profile.links) {
        const a = document.createElement('a')
        a.href = link.url
        a.target = '_blank'
        a.rel = 'noopener'
        a.textContent = link.titulo || link.url
        linksDiv.appendChild(a)
      }
      info.appendChild(linksDiv)
    }
    
    // Social stats (Seguindo / Seguidores counts + list trigger)
    if (social) {
      renderProfileSocialStats(info, social)
    }
    
    header.appendChild(info)
    els.profileView.appendChild(header)
    
    // Social list panel (hidden until a stat is clicked)
    renderProfileSocialList()
    
    // Posts
    if (posts && posts.length > 0) {
      const postsDiv = document.createElement('div')
      postsDiv.className = 'profile-view-posts'
      
      const postsTitle = document.createElement('div')
      postsTitle.className = 'eyebrow'
      postsTitle.textContent = t('posts')
      postsDiv.appendChild(postsTitle)
      
      const postsFeed = document.createElement('div')
      postsFeed.className = 'feed'
      
      for (const post of posts.sort((a, b) => b.timestamp - a.timestamp)) {
        // Filter to only the posts of the viewed user
        if (post.autor !== pubKeyHex) continue
        
        const node = els.postTemplate.content.cloneNode(true)
        const authorEl = node.querySelector('.post-author')
        authorEl.textContent = profile.nome || t('noName')
        authorEl.classList.add('is-me')
        
        node.querySelector('.post-time').textContent = formatTime(post.timestamp)
        node.querySelector('.post-body').textContent = post.texto || ''

        if (post.tipo === 'imagem' && post.imagem) {
          const img = node.querySelector('.post-image')
          img.src = `data:${post.imagem.mime};base64,${post.imagem.dataBase64}`
          img.hidden = false
        }

        node.querySelector('.post-footer').textContent = `#${post.seq}`
        postsFeed.appendChild(node)
      }
      
      postsDiv.appendChild(postsFeed)
      els.profileView.appendChild(postsDiv)
    }
    
  } catch (err) {
    console.error('Error displaying profile:', err)
  }
}

// =====================================================================
// PROFILE VIEW — SOCIAL GRAPH (Seguindo / Seguidores)
// =====================================================================

/** Renders the "seguindo N · seguidores N" clickable stats into the profile info. */
function renderProfileSocialStats(info, social) {
  if (!social) return

  const statsRow = document.createElement('div')
  statsRow.className = 'profile-social-stats'

  const makeStat = (label, count, type) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'profile-social-stat'
    btn.textContent = `${label} ${count}`
    btn.addEventListener('click', () => {
      // Toggle the clicked list (clicking again closes it)
      profileSocialType = profileSocialType === type ? null : type
      renderProfileSocialList()
      statsRow.querySelectorAll('.profile-social-stat').forEach((s) => {
        s.classList.toggle('is-active', s === btn && profileSocialType === type)
      })
    })
    return btn
  }

  statsRow.appendChild(makeStat(t('following'), social.following.length, 'following'))
  statsRow.appendChild(makeStat(t('followers'), social.followers.length, 'followers'))
  info.appendChild(statsRow)
}

/** Renders (or updates) the social list panel inside the profile view. */
function renderProfileSocialList() {
  const social = profileSocialData
  if (!social) return

  if (!profileSocialPanel) {
    profileSocialPanel = document.createElement('div')
    profileSocialPanel.className = 'profile-social-panel'
    els.profileView.appendChild(profileSocialPanel)
  }

  const type = profileSocialType
  profileSocialPanel.hidden = !type
  if (!type) return

  const keys = type === 'following' ? social.following : social.followers
  const label = t(type === 'following' ? 'following' : 'followers')

  profileSocialPanel.innerHTML = ''

  const head = document.createElement('div')
  head.className = 'profile-social-panel-head'
  const titleEl = document.createElement('div')
  titleEl.className = 'eyebrow'
  titleEl.textContent = `${label} (${keys.length})`
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'btn btn--ghost btn--tiny'
  closeBtn.title = t('close')
  closeBtn.textContent = '✕'
  closeBtn.addEventListener('click', () => {
    profileSocialType = null
    renderProfileSocialList()
    els.profileView.querySelectorAll('.profile-social-stat').forEach((s) => s.classList.remove('is-active'))
  })
  head.appendChild(titleEl)
  head.appendChild(closeBtn)
  profileSocialPanel.appendChild(head)

  const listEl = document.createElement('div')
  listEl.className = 'profile-social-list'
  if (keys.length === 0) {
    listEl.innerHTML = `<p style="font-size: 12px; color: var(--muted); padding: 8px 0;">${t('noUsersHere')}</p>`
  } else {
    for (const key of keys) listEl.appendChild(renderProfileSocialItem(key))
  }
  profileSocialPanel.appendChild(listEl)
}

/** Builds a single user row in the social list (navigate to profile / follow). */
function renderProfileSocialItem(key) {
  const item = document.createElement('div')
  item.className = 'profile-social-item'

  const avatarEl = document.createElement('span')
  avatarEl.className = 'profile-social-avatar'
  avatarEl.textContent = '?'

  const nameEl = document.createElement('span')
  nameEl.className = 'profile-social-name'
  nameEl.title = key
  nameEl.textContent = shortKey(key)
  nameEl.addEventListener('click', () => showProfileView(key))

  // Load name + avatar asynchronously
  ;(async () => {
    try {
      const p = await window.p2p.getProfileOf(key)
      if (!p) return
      if (p.avatar) {
        const img = document.createElement('img')
        img.src = `data:${p.avatar.mime};base64,${p.avatar.dataBase64}`
        avatarEl.textContent = ''
        avatarEl.appendChild(img)
      } else if (p.nome) {
        avatarEl.textContent = getInitials(p.nome)
      }
      if (p.nome) nameEl.textContent = p.nome
    } catch (err) {
      // Keep the short key as fallback
    }
  })()

  const actions = document.createElement('span')
  actions.className = 'profile-social-actions'

  const viewBtn = document.createElement('button')
  viewBtn.type = 'button'
  viewBtn.className = 'btn btn--ghost btn--tiny'
  viewBtn.textContent = t('viewProfile')
  viewBtn.addEventListener('click', () => showProfileView(key))
  actions.appendChild(viewBtn)

  if (key !== myKey && !currentFollowingList.some((p) => p.publicKeyHex === key)) {
    const followBtn = document.createElement('button')
    followBtn.type = 'button'
    followBtn.className = 'btn btn--accent btn--tiny'
    followBtn.textContent = t('follow')
    followBtn.addEventListener('click', async (evt) => {
      evt.stopPropagation()
      try {
        await window.p2p.follow(key)
        delete profileCache[key]
        followBtn.textContent = t('followingDone')
        followBtn.disabled = true
        await loadFollowing()
        await loadFeed()
      } catch (err) {
        console.error('Error following:', err)
      }
    })
    actions.appendChild(followBtn)
  }

  item.appendChild(avatarEl)
  item.appendChild(nameEl)
  item.appendChild(actions)
  return item
}

function showFeedView() {
  els.profileViewContainer.hidden = true
  els.searchViewContainer.hidden = true
  els.composerForm.hidden = false
  els.feed.hidden = false
}

// Re-renders the dynamic parts of the UI so the whole app reflects the current
// language. Hooked to window.coherenceI18n.onApply, which fires whenever the
// locale is applied (e.g. via the settings modal). The [data-i18n] static
// elements are updated directly by apply(); here we rebuild the dynamic lists
// and views that are built in JS.
function refreshMainUI() {
  if (window.__coherenceSetupActive || !myKey) return
  const locale = window.coherenceI18n.locale
  if (locale === lastRenderedLocale) return
  lastRenderedLocale = locale
  if (currentProfile) renderIdentity(currentProfile)
  loadFollowing()
  if (!els.tabContentFollowers.hidden) loadFollowers()
  if (!els.searchViewContainer.hidden && els.searchInput.value.trim()) {
    els.searchBtn.click()
  } else if (!els.profileViewContainer.hidden && currentViewingProfileKey) {
    showProfileView(currentViewingProfileKey)
  } else if (!els.feed.hidden) {
    loadFeed()
  }
  refreshStatus()
  if (pendingImageName) {
    els.composerImageName.textContent = pendingImageName
    els.composerImageName.classList.add('has-image')
  }
}

window.coherenceI18n.onApply = () => refreshMainUI()

async function loadIdentity() {
  myKey = await window.p2p.getMyKey()
  const profile = await window.p2p.getProfile()
  renderIdentity(profile)
  refreshStatus()
}

async function loadFollowing() {
  const list = await window.p2p.getFollowing()
  renderFollowing(list)
}

async function loadFollowers() {
  console.log('[loadFollowers] STARTING...')
  try {
    console.log('[loadFollowers] Calling window.p2p.getFollowers()...')
    const followers = await window.p2p.getFollowers()
    console.log('[loadFollowers] Received array with', followers.length, 'followers:', followers.map(f => f.publicKeyHex.slice(0, 12)).join(', '))
    console.log('[loadFollowers] Calling renderFollowers()...')
    renderFollowers(followers)
    console.log('[loadFollowers] DONE')
  } catch (err) {
    console.error('Error loading followers:', err)
  }
}

function renderFollowers(followers) {
  els.followersList.innerHTML = ''
  els.followersCount.textContent = `(${followers.length})`
  
  console.log('[renderFollowers] Rendering', followers.length, 'followers:', followers.map(f => f.publicKeyHex.slice(0, 12)).join(', '))
  
  if (followers.length === 0) {
    els.followersList.innerHTML = `<p style="font-size: 12px; color: var(--muted); margin-top: 8px;">${t('noFollowersYet')}</p>`
    return
  }
  
  for (const follower of followers) {
    const item = document.createElement('li')
    item.className = 'follower-item'
    
    const nameSpan = document.createElement('span')
    nameSpan.className = 'follower-name'
    nameSpan.title = follower.publicKeyHex
    // Initially shows the short key, then fetches the name
    nameSpan.textContent = shortKey(follower.publicKeyHex)
    
    // Fetch the follower's name asynchronously
    ;(async () => {
      try {
        console.log('[renderFollowers] Fetching profile of:', follower.publicKeyHex.slice(0, 12))
        const profile = await window.p2p.getProfileOf(follower.publicKeyHex)
        if (profile && profile.nome) {
          nameSpan.textContent = profile.nome
        }
      } catch (err) {
        console.log('Could not load follower name:', err)
      }
    })()
    
    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className = 'btn btn--ghost btn--tiny'
    copyBtn.title = t('copyKey')
    copyBtn.textContent = '📋'
    
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      copyToClipboard(follower.publicKeyHex)
    })
    
    nameSpan.addEventListener('click', () => {
      showProfileView(follower.publicKeyHex)
    })
    
    item.appendChild(nameSpan)
    item.appendChild(copyBtn)
    els.followersList.appendChild(item)
  }
}

async function loadFeed() {
  const posts = await window.p2p.getFeed()
  renderFeed(posts)
}

// =====================================================================
// FORMS
// =====================================================================

// Avatar Upload
els.avatarSection.addEventListener('click', () => {
  els.avatarUpload.click()
})

els.avatarUpload.addEventListener('change', async () => {
  const file = els.avatarUpload.files[0]
  if (!file) return
  
  try {
    const dataBase64 = await fileToBase64(file)
    const img = document.createElement('img')
    img.src = `data:${file.type};base64,${dataBase64}`
    els.avatarDisplay.innerHTML = ''
    els.avatarDisplay.appendChild(img)
    
    // Save to pending (will be saved with profile)
    currentProfile.avatar = { dataBase64, mime: file.type }
  } catch (err) {
    console.error('Error processing avatar:', err)
  }
})

// Key Copy
els.myKey.addEventListener('click', async () => {
  await copyToClipboard(myKey, els.copyFeedback)
})

// Profile Form - Toggle (click name to edit)
els.myName.addEventListener('click', () => {
  els.profileForm.hidden = !els.profileForm.hidden
})

// Links Manager Modal
function showLinksModal() {
  const modal = document.createElement('div')
  modal.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  `
  
  const modalContent = document.createElement('div')
  modalContent.style.cssText = `
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 20px;
    max-width: 400px;
    width: 90%;
  `
  
  const title = document.createElement('div')
  title.className = 'eyebrow'
  title.textContent = t('addLinkTitle')
  modalContent.appendChild(title)
  
  const tituloLabel = document.createElement('label')
  tituloLabel.className = 'field'
  tituloLabel.innerHTML = `<span>${t('title')}</span>`
  const tituloInput = document.createElement('input')
  tituloInput.type = 'text'
  tituloInput.maxLength = '30'
  tituloInput.placeholder = t('linkTitlePlaceholder')
  tituloLabel.appendChild(tituloInput)
  modalContent.appendChild(tituloLabel)
  
  const urlLabel = document.createElement('label')
  urlLabel.className = 'field'
  urlLabel.innerHTML = `<span>${t('url')}</span>`
  const urlInput = document.createElement('input')
  urlInput.type = 'text'
  urlInput.placeholder = t('urlPlaceholder')
  urlLabel.appendChild(urlInput)
  modalContent.appendChild(urlLabel)
  
  const actions = document.createElement('div')
  actions.className = 'form-actions'
  actions.style.marginTop = '16px'
  
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'btn btn--accent btn--small'
  addBtn.textContent = t('add')
  addBtn.addEventListener('click', () => {
    const titulo = tituloInput.value.trim()
    const url = urlInput.value.trim()
    
    if (!titulo || !url) {
      alert(t('fillTitleUrl'))
      return
    }
    
    if (pendingLinks.length >= 3) {
      alert(t('maxLinksReached'))
      return
    }
    
    pendingLinks.push({ titulo, url })
    renderLinksList()
    document.body.removeChild(modal)
  })
  actions.appendChild(addBtn)
  
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'btn btn--ghost btn--small'
  cancelBtn.textContent = t('cancel')
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal)
  })
  actions.appendChild(cancelBtn)
  
  modalContent.appendChild(actions)
  modal.appendChild(modalContent)
  document.body.appendChild(modal)
  
  tituloInput.focus()
}

els.addLinkBtn.addEventListener('click', showLinksModal)

// Profile Form Submit
els.profileForm.addEventListener('submit', async (evt) => {
  evt.preventDefault()
  try {
    const profile = await window.p2p.updateProfile({
      nome: els.profileNome.value.trim(),
      bio: els.profileBio.value.trim(),
      avatar: currentProfile.avatar,
      links: pendingLinks
    })
    renderIdentity(profile)
    // Keep the form visible after saving
  } catch (err) {
    console.error('Error updating profile:', err)
  }
})

// Follow Form
els.followForm.addEventListener('submit', async (evt) => {
  evt.preventDefault()
  clearError(els.followError)
  const key = els.followKey.value.trim().toLowerCase()
  try {
    await window.p2p.follow(key)
    els.followKey.value = ''
    // Clear the stale cache of the newly followed user to ensure fresh data
    delete profileCache[key]
    // Fetch a fresh profile
    const freshProfile = await window.p2p.getProfileOf(key)
    if (freshProfile) profileCache[key] = freshProfile
    await loadFollowing()
    await loadFeed()
  } catch (err) {
    showError(els.followError, err.message)
  }
})

// Composer Image
els.composerImage.addEventListener('change', async () => {
  const file = els.composerImage.files[0]
  if (!file) {
    pendingImage = null
    pendingImageName = null
    els.composerImageName.textContent = t('addImage')
    els.composerImageName.classList.remove('has-image')
    return
  }
  const dataBase64 = await fileToBase64(file)
  pendingImage = { dataBase64, mime: file.type }
  pendingImageName = file.name
  els.composerImageName.textContent = file.name
  els.composerImageName.classList.add('has-image')
})

// Composer Submit
els.composerForm.addEventListener('submit', async (evt) => {
  evt.preventDefault()
  clearError(els.composerError)

  const texto = els.composerText.value.trim()
  if (!texto && !pendingImage) {
    showError(els.composerError, t('composerErrorEmpty'))
    return
  }

  try {
    if (pendingImage) {
      await window.p2p.publishPost({ tipo: 'imagem', texto: texto || null, imagem: pendingImage })
    } else {
      await window.p2p.publishPost({ tipo: 'texto', texto })
    }
    els.composerText.value = ''
    els.composerImage.value = ''
    pendingImage = null
    pendingImageName = null
    els.composerImageName.textContent = t('addImage')
    els.composerImageName.classList.remove('has-image')
    await loadFeed()
  } catch (err) {
    showError(els.composerError, err.message)
  }
})

// Back from Profile View — returns to search (when the profile was opened from a
// search result) or to the feed otherwise.
els.backToFeedBtn.addEventListener('click', () => {
  if (profileReturnTarget === 'search') {
    // Return to the search view, keeping the results list intact
    els.profileViewContainer.hidden = true
    els.composerForm.hidden = true
    els.feed.hidden = true
    els.searchViewContainer.hidden = false
  } else {
    showFeedView()
  }
  currentViewingProfileKey = null
})

// Back to Feed from Search View
els.backToFeedFromSearchBtn.addEventListener('click', () => {
  showFeedView()
  els.searchInput.value = ''
  els.searchResults.innerHTML = ''
})

// Search Button — TRANSITIVE search over the follow graph (friends of friends)
els.searchBtn.addEventListener('click', async () => {
  const query = els.searchInput.value.trim()
  if (!query) return

  els.searchResults.innerHTML = `<p style="font-size: 12px; color: var(--muted);">${t('searching')}</p>`
  try {
    const results = await window.p2p.searchUsers(query)
    if (!results || results.length === 0) {
      els.searchResults.innerHTML = `<p style="font-size: 12px; color: var(--muted);">${t('noResults')}</p>`
      return
    }

    // Map key → name to label the relationship ("via …")
    const keyToName = {}
    for (const p of results) if (p.nome) keyToName[p.publicKeyHex] = p.nome
    for (const p of currentFollowingList) if (p.nome) keyToName[p.publicKeyHex] = p.nome

    const relationOf = (peer) => {
      if (peer.depth === 0) return t('you')
      if (peer.depth === 1) return t('followingRelation')
      const viaName = peer.via && (keyToName[peer.via] || shortKey(peer.via))
      return viaName ? t('viaUser').replace('{name}', viaName) : t('viaNetwork')
    }

    const resultsDiv = document.createElement('div')
    resultsDiv.style.fontSize = '12px'

    for (const peer of results) {
      const item = document.createElement('div')
      item.style.padding = '8px 0'
      item.style.borderBottom = '1px solid var(--line)'
      item.style.cursor = 'pointer'

      const nameEl = document.createElement('div')
      nameEl.style.color = 'var(--relay)'
      nameEl.textContent = peer.nome || shortKey(peer.publicKeyHex)
      item.appendChild(nameEl)

      if (peer.bio) {
        const bioEl = document.createElement('div')
        bioEl.style.fontSize = '11px'
        bioEl.style.color = 'var(--muted)'
        bioEl.textContent = peer.bio
        item.appendChild(bioEl)
      }

      const metaEl = document.createElement('div')
      metaEl.style.fontSize = '11px'
      metaEl.style.color = 'var(--muted)'
      metaEl.textContent = [relationOf(peer), shortKey(peer.publicKeyHex)].filter(Boolean).join(' · ')
      item.appendChild(metaEl)

      const actionsEl = document.createElement('div')
      actionsEl.style.marginTop = '4px'
      const viewBtn = document.createElement('button')
      viewBtn.type = 'button'
      viewBtn.className = 'btn btn--ghost btn--small'
      viewBtn.textContent = t('viewProfile')
      viewBtn.addEventListener('click', (evt) => {
        evt.stopPropagation()
        showProfileView(peer.publicKeyHex)
      })
      actionsEl.appendChild(viewBtn)

      if (peer.publicKeyHex !== myKey && !currentFollowingList.some((p) => p.publicKeyHex === peer.publicKeyHex)) {
        const followBtn = document.createElement('button')
        followBtn.type = 'button'
        followBtn.className = 'btn btn--accent btn--small'
        followBtn.textContent = t('follow')
        followBtn.addEventListener('click', async (evt) => {
          evt.stopPropagation()
          try {
            await window.p2p.follow(peer.publicKeyHex)
            delete profileCache[peer.publicKeyHex]
            followBtn.textContent = t('followingDone')
            followBtn.disabled = true
            await loadFollowing()
            await loadFeed()
          } catch (err) {
            console.error('Error following:', err)
          }
        })
        actionsEl.appendChild(followBtn)
      }
      item.appendChild(actionsEl)

      item.addEventListener('click', () => showProfileView(peer.publicKeyHex))
      resultsDiv.appendChild(item)
    }

    els.searchResults.innerHTML = ''
    els.searchResults.appendChild(resultsDiv)
  } catch (err) {
    console.error('Search error:', err)
    els.searchResults.innerHTML = `<p style="font-size: 12px; color: var(--muted);">${t('searchError')}</p>`
  }
})

els.searchInput.addEventListener('keypress', (evt) => {
  if (evt.key === 'Enter') {
    evt.preventDefault()
    els.searchBtn.click()
  }
})

// Open Search View
els.openSearchBtn.addEventListener('click', () => {
  els.composerForm.hidden = true
  els.feed.hidden = true
  els.profileViewContainer.hidden = true
  els.searchViewContainer.hidden = false
  els.searchInput.focus()
})

// Tab Switching
els.tabFollowing.addEventListener('click', () => {
  els.tabFollowing.classList.add('tab-btn--active')
  els.tabFollowers.classList.remove('tab-btn--active')
  els.tabContentFollowing.hidden = false
  els.tabContentFollowers.hidden = true
})

els.tabFollowers.addEventListener('click', () => {
  console.log('[tab-followers] Click fired')
  els.tabFollowers.classList.add('tab-btn--active')
  els.tabFollowing.classList.remove('tab-btn--active')
  els.tabContentFollowers.hidden = false
  els.tabContentFollowing.hidden = true
  console.log('[tab-followers] Calling loadFollowers()...')
  loadFollowers()
})

// Auto-populate following list to profile cache
window.p2p.on('following-changed', async () => {
  const list = await window.p2p.getFollowing()
  for (const peer of list) {
    if (peer.publicKeyHex) {
      const profile = await window.p2p.getProfileOf(peer.publicKeyHex)
      if (profile) profileCache[peer.publicKeyHex] = profile
    }
  }
})

// The polling can only start after the setup flow created or imported the node.
function startProfilePolling() {
  setInterval(async () => {
    try {
      const list = await window.p2p.getFollowing()
      for (const peer of list) {
        if (peer.publicKeyHex) {
          try {
            const profile = await window.p2p.getProfileOf(peer.publicKeyHex)
            if (profile) profileCache[peer.publicKeyHex] = profile
          } catch (err) {
            // Silence individual polling errors
          }
        }
      }
    } catch (err) {
      // Silence overall polling errors
    }
  }, 10000)
}

// =====================================================================
// BACKEND EVENTS
// =====================================================================

window.p2p.on('feed-updated', loadFeed)
window.p2p.on('profile-updated', loadIdentity)
window.p2p.on('following-changed', () => { loadFollowing(); loadFeed() })
window.p2p.on('peers-changed', () => {
  console.log('[peers-changed] event fired')
  refreshStatus()
  // If the followers tab is visible, update it
  if (!els.tabContentFollowers.hidden) {
    console.log('[peers-changed] Followers tab is visible, calling loadFollowers()')
    loadFollowers()
  } else {
    console.log('[peers-changed] Followers tab is HIDDEN, not loading')
  }
})
window.p2p.on('following-status-update', (list) => {
  renderFollowing(list)
})

// =====================================================================
// UPDATE BANNER (startup check against GitHub Releases)
// =====================================================================

function showUpdateBanner(result) {
  const banner = document.getElementById('update-banner')
  if (!banner) return
  const text = document.getElementById('update-banner-text')
  const link = document.getElementById('update-banner-link')
  text.textContent = window.coherenceI18n.text('updateAvailable').replace('{version}', result.latest)
  link.textContent = window.coherenceI18n.text('updateDownload')
  link.addEventListener('click', (event) => {
    event.preventDefault()
    window.p2p.openExternal(result.url)
  })
  document.getElementById('update-banner-close').addEventListener('click', () => { banner.hidden = true })
  banner.hidden = false
}

async function checkUpdatesOnStartup() {
  try {
    const result = await window.p2p.checkForUpdates()
    if (result && result.available) showUpdateBanner(result)
  } catch (err) {
    // Silent — offline or API unavailable
  }
}

// =====================================================================
// BOOT
// =====================================================================

;(async () => {
  await window.coherenceSetupReady
  if (window.__coherenceSetupActive) return
  lastRenderedLocale = window.coherenceI18n.locale
  await loadIdentity()
  await loadFollowing()
  await loadFeed()
  startProfilePolling()
  checkUpdatesOnStartup()
})()

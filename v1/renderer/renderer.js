'use strict'

const els = {
  myName: document.getElementById('my-name'),
  myKey: document.getElementById('my-key'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),

  editProfileBtn: document.getElementById('edit-profile-btn'),
  profileForm: document.getElementById('profile-form'),
  profileNome: document.getElementById('profile-nome'),
  profileBio: document.getElementById('profile-bio'),
  cancelProfileBtn: document.getElementById('cancel-profile-btn'),

  followForm: document.getElementById('follow-form'),
  followKey: document.getElementById('follow-key'),
  followError: document.getElementById('follow-error'),
  followingCount: document.getElementById('following-count'),
  followingList: document.getElementById('following-list'),

  composerForm: document.getElementById('composer-form'),
  composerText: document.getElementById('composer-text'),
  composerImage: document.getElementById('composer-image'),
  composerImageName: document.getElementById('composer-image-name'),
  composerError: document.getElementById('composer-error'),

  feed: document.getElementById('feed'),
  feedEmpty: document.getElementById('feed-empty'),

  postTemplate: document.getElementById('post-template'),
  peerTemplate: document.getElementById('peer-template')
}

let myKey = null
let pendingImage = null // { dataBase64, mime, name }

// ---------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------

function shortKey(key) {
  return key.slice(0, 8) + '…' + key.slice(-4)
}

function formatTime(ts) {
  return new Date(ts).toLocaleString('pt-BR', {
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

// ---------------------------------------------------------------------
// renderização
// ---------------------------------------------------------------------

function renderIdentity(profile) {
  els.myName.textContent = profile.nome || 'sem nome'
  els.myKey.textContent = myKey
  els.profileNome.value = profile.nome || ''
  els.profileBio.value = profile.bio || ''
}

async function refreshStatus() {
  const count = await window.p2p.getPeerCount()
  els.statusText.textContent = count === 0
    ? 'nenhum peer conectado ainda'
    : `${count} peer${count === 1 ? '' : 's'} conectado${count === 1 ? '' : 's'}`
}

function renderFollowing(list) {
  els.followingCount.textContent = `(${list.length})`
  els.followingList.innerHTML = ''
  for (const peer of list) {
    const node = els.peerTemplate.content.cloneNode(true)
    node.querySelector('.peer-name').textContent = peer.nome || (peer.sincronizando ? 'sincronizando…' : 'sem nome')
    node.querySelector('.peer-key').textContent = shortKey(peer.publicKeyHex)
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
    authorEl.textContent = isMe ? 'você' : shortKey(post.autor)
    authorEl.classList.toggle('is-me', isMe)
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

// ---------------------------------------------------------------------
// carregamento de dados
// ---------------------------------------------------------------------

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

async function loadFeed() {
  const posts = await window.p2p.getFeed()
  renderFeed(posts)
}

// ---------------------------------------------------------------------
// formulários
// ---------------------------------------------------------------------

els.editProfileBtn.addEventListener('click', () => {
  els.profileForm.hidden = false
})
els.cancelProfileBtn.addEventListener('click', () => {
  els.profileForm.hidden = true
})
els.profileForm.addEventListener('submit', async (evt) => {
  evt.preventDefault()
  const profile = await window.p2p.updateProfile({
    nome: els.profileNome.value.trim(),
    bio: els.profileBio.value.trim()
  })
  renderIdentity(profile)
  els.profileForm.hidden = true
})

els.followForm.addEventListener('submit', async (evt) => {
  evt.preventDefault()
  clearError(els.followError)
  const key = els.followKey.value.trim().toLowerCase()
  try {
    await window.p2p.follow(key)
    els.followKey.value = ''
    await loadFollowing()
    await loadFeed()
  } catch (err) {
    showError(els.followError, err.message)
  }
})

els.composerImage.addEventListener('change', async () => {
  const file = els.composerImage.files[0]
  if (!file) {
    pendingImage = null
    els.composerImageName.textContent = '+ imagem'
    els.composerImageName.classList.remove('has-image')
    return
  }
  const dataBase64 = await fileToBase64(file)
  pendingImage = { dataBase64, mime: file.type }
  els.composerImageName.textContent = file.name
  els.composerImageName.classList.add('has-image')
})

els.composerForm.addEventListener('submit', async (evt) => {
  evt.preventDefault()
  clearError(els.composerError)

  const texto = els.composerText.value.trim()
  if (!texto && !pendingImage) {
    showError(els.composerError, 'escreva algo ou anexe uma imagem antes de publicar.')
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
    els.composerImageName.textContent = '+ imagem'
    els.composerImageName.classList.remove('has-image')
    await loadFeed()
  } catch (err) {
    showError(els.composerError, err.message)
  }
})

// ---------------------------------------------------------------------
// eventos vindos do processo main
// ---------------------------------------------------------------------

window.p2p.on('feed-updated', loadFeed)
window.p2p.on('profile-updated', loadIdentity)
window.p2p.on('following-changed', () => { loadFollowing(); loadFeed() })
window.p2p.on('peers-changed', refreshStatus)

// ---------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------

;(async () => {
  await loadIdentity()
  await loadFollowing()
  await loadFeed()
})()

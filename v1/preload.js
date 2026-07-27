'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const EVENTS = ['feed-updated', 'profile-updated', 'following-changed', 'peers-changed']

contextBridge.exposeInMainWorld('p2p', {
  getMyKey: () => ipcRenderer.invoke('p2p:get-my-key'),
  getProfile: () => ipcRenderer.invoke('p2p:get-profile'),
  updateProfile: (patch) => ipcRenderer.invoke('p2p:update-profile', patch),
  publishPost: (post) => ipcRenderer.invoke('p2p:publish-post', post),
  follow: (key) => ipcRenderer.invoke('p2p:follow', key),
  unfollow: (key) => ipcRenderer.invoke('p2p:unfollow', key),
  getProfileOf: (key) => ipcRenderer.invoke('p2p:get-profile-of', key),
  getFollowing: () => ipcRenderer.invoke('p2p:get-following'),
  getFeed: (opts) => ipcRenderer.invoke('p2p:get-feed', opts),
  getPeerCount: () => ipcRenderer.invoke('p2p:get-peer-count'),

  /** Assina um evento vindo do processo main. Retorna uma função para cancelar a assinatura. */
  on(eventName, callback) {
    if (!EVENTS.includes(eventName)) throw new Error('evento desconhecido: ' + eventName)
    const channel = 'p2p:event:' + eventName
    const listener = (_evt, ...args) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})

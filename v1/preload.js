'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const EVENTS = ['feed-updated', 'profile-updated', 'following-changed', 'peers-changed', 'following-status-update', 'recovery-updated']

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
  getFollowers: () => ipcRenderer.invoke('p2p:get-followers'),
  getUserSocial: (key) => ipcRenderer.invoke('p2p:get-user-social', key),
  getPostsOf: (key) => ipcRenderer.invoke('p2p:get-posts-of', key),
  searchUsers: (query, opts) => ipcRenderer.invoke('p2p:search-users', query, opts),
  getSuggestedUsers: () => ipcRenderer.invoke('p2p:get-suggested-users'),

  setup: {
    getSettings: () => ipcRenderer.invoke('setup:get-settings'),
    setSettings: (settings) => ipcRenderer.invoke('setup:set-settings', settings),
    checkIdentity: () => ipcRenderer.invoke('setup:check-identity'),
    importIdentity: () => ipcRenderer.invoke('setup:import-identity'),
    createIdentity: (username) => ipcRenderer.invoke('setup:create-identity', username),
    startApp: () => ipcRenderer.invoke('setup:start-app'),
    getState: () => ipcRenderer.invoke('setup:get-state'),
    getRecoveryStatus: () => ipcRenderer.invoke('setup:get-recovery-status'),
    startFromZero: () => ipcRenderer.invoke('setup:start-from-zero'),
    cancelRecovery: () => ipcRenderer.invoke('setup:cancel-recovery')
  },
  exportIdentity: () => ipcRenderer.invoke('export-identity'),
  resetApp: () => ipcRenderer.invoke('reset-app'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getDonationInfo: () => ipcRenderer.invoke('get-donation-info'),
  getDonationQr: (content) => ipcRenderer.invoke('get-donation-qr', content),
  checkForUpdates: (opts) => ipcRenderer.invoke('check-for-updates', opts),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /** Subscribes to an event from the main process. Returns a function to unsubscribe. */
  on(eventName, callback) {
    if (!EVENTS.includes(eventName)) throw new Error('evento desconhecido: ' + eventName)
    const channel = 'p2p:event:' + eventName
    const listener = (_evt, ...args) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})

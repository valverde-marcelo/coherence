# Coherence

Coherence is a fully distributed peer-to-peer social network client built with Electron, WebTorrent, and DHT. It requires no centralized backend, no user registration, and no traditional server infrastructure. Each instance acts as both a client and a network node.

## Overview

This project implements a desktop social client that:

- stores identity as a local Ed25519 key pair
- publishes a signed mutable pointer to the latest content chapter via DHT (BEP44)
- distributes posts and media using WebTorrent
- discovers users through friend-of-a-friend gossip and DHT lookups
- maintains integrity with a personal signed hash chain per author

## Architecture

### Identity

- Uses `tweetnacl` for Ed25519 key generation and signing.
- The public key is the user identifier.
- There are no usernames, no centralized registry, and no server-managed account state.

### Content distribution

- Uses `webtorrent` to seed and download content chapters.
- Posts are batched into chapters rather than individual torrents per post, which improves swarm performance and reduces torrent fragmentation.
- Each peer reseeds downloaded chapters indefinitely.

### Discovery

- Uses DHT mutable items with BEP44 to publish the latest chapter pointer.
- Each user publishes a signed mutable record under the hash of their public key.
- Followers resolve that mutable record with the followed user's public key, enabling decentralized "what's new" updates.

### Social graph discovery

- Implements friend-of-a-friend (FOAF) gossip to discover users in the local social graph.
- Follow pointers include display names and a sample of outbound follows.
- The network does not provide a global user directory; discovery is limited to the connected social graph.

### Integrity and history

- Each post is part of a personal signed hash chain.
- Each item references the previous post hash and is signed by the author's private key.
- This provides verifiable author attribution and tamper evidence without global consensus.

## Features

- Local Ed25519 identity generation and secure storage
- DHT-based publish/resolve of user pointers
- WebTorrent chapter-based publication and torrent reseeding
- Adaptive polling for DHT refresh based on window focus/minimized state
- Media preview support using piece prioritization
- Social discovery through FOAF gossip

## Repository structure

```text
electron/          Electron main process and preload code
src/main/          application domain logic executed in Electron main
  identity.js      Ed25519 identity generation and loading
  hashchain.js     signed personal hash chain creation and verification
  chapters.js      post batching, chapter sealing, and torrent metadata
  torrentClient.js WebTorrent wrapper for seed/download and piece priority
  dht.js           BEP44 mutable record publish and resolve
  discovery.js     follow graph polling, validation, and ingestion
  scheduler.js     adaptive timers for focus, blur, and minimized state
  feed.js          feed aggregation and media resolution
  store.js         JSON-based local persistence
  app.js           application orchestration
renderer/          sandboxed UI layer using HTML/CSS/vanilla JS
```

## Prerequisites

- Node.js (recommended latest LTS)
- npm
- Electron-compatible desktop environment

## Installation

```bash
npm install
```

## Run in development

```bash
npm start
```

On first launch, the application generates a local Ed25519 identity. The private key is stored locally and is protected by Electron `safeStorage` when available.

## Build a distributable

```bash
npm run dist
```

This runs `electron-builder` and produces platform installers for Windows (`nsis`), Linux (`AppImage`), and macOS (`dmg`) according to the `build` configuration in `package.json`.

## License and attribution

This repository is published under the Apache License 2.0. Derivative works, improvements, and custom clients are permitted, provided the Apache 2.0 license and copyright notices are preserved.

Author: `Valverde82 (@valverdeoficial)`

## Contributing

Contributions are welcome from the community. Please read `CONTRIBUTING.md` before opening issues or pull requests.

- Use the issue templates under `.github/ISSUE_TEMPLATE/` for bug reports or feature requests.
- Keep code changes small and focused.
- Preserve author attribution and the Apache-2.0 license header in modified source files.

## Known limitations

- History backfill is intentionally limited to approximately 25 chapters to avoid unbounded chain traversal.
- Media support is currently limited to images. Additional attachment types can be added using the existing `media: [{sha256, name, mime, size}]` pattern.
- Initial DHT discovery relies on public bootstrap nodes such as `router.bittorrent.com`; fully isolated networks will require custom bootstrap configuration.
- User discovery is limited by the local social graph (followers and FOAF gossip). There is no centralized global search across all network participants.

# Coherence - Distributed P2P Social Network

A distributed social network built on P2P (peer-to-peer) technology using **Hyperswarm**, **Hypercore**, and **Hyperbee**. No centralized servers, no censorship, no data collection.

> **Current version:** `v1/` — Electron + Hypercore/Corestore/Hyperbee backend. See
> [Multiple instances and local users](#multiple-instances-and-local-users) to manage more
> than one local account. The initial prototype lives in `v0/`.

## 🌍 Overview

**Coherence** is a social network platform where:
- Each user controls their own data
- All data is cryptographically signed (Ed25519)
- Direct P2P connections between peers via Hyperswarm
- Data is automatically replicated across multiple machines
- Desktop interface built with Electron

## 🚀 Features

- ✅ **Decentralized Identity**: Each user generates their own Ed25519 keypair
- ✅ **Immutable Posts**: All posts are signed and stored in Hypercores
- ✅ **Distributed Profile**: Name, bio, avatar, and links saved in Hyperbee
- ✅ **Follow/Unfollow System**: Followers are detected via P2P connections
- ✅ **Peer Discovery**: Automatically discovers and connects with followed users
- ✅ **Identity recovery**: the `identity.json` backup includes the Hypercore key; on a
  fresh installation the app waits for a seeder, recovers profile, posts and followers
  and only then creates the local `corestore` and unlocks writing
- ✅ **Transitive user search**: `searchUsers()` traverses the follow graph in both
  directions (who you follow/followers and, for each profile, its follows and followers),
  loading profiles on demand up to 3 hops
- ✅ **Intuitive Interface**: 3 columns (Profile, Feed, Followers) in Electron
- ✅ **Persistence**: Data saved locally in `~/Documents/coherence-data/`

## 📁 Project Structure

```
coherence/
├── v0/                          # Initial prototype
│   ├── app-p2p.js
│   └── package.json
├── v1/                          # Current version (Electron + UI)
│   ├── main.js                  # Electron main process
│   ├── preload.js               # Secure IPC bridge
│   ├── src/
│   │   ├── p2p-node.js          # P2P core (Hyperswarm/Hypercore/Hyperbee)
│   │   └── identity.js          # Keypair generation and management
│   ├── renderer/
│   │   ├── index.html           # UI (3 columns)
│   │   ├── renderer.js          # Frontend logic
│   │   └── styles.css           # CSS styles
│   ├── scripts/
│   │   ├── start.js             # `npm start` launcher (account selection menu)
│   │   ├── start-all.js         # Opens ALL local accounts at once
│   │   ├── reset.js             # Resets data (interactive, via CLI)
│   │   └── instances.js         # Shared instance discovery + selection menu
│   ├── test/                    # Integration tests
│   └── package.json
├── docs/                        # GitHub Pages landing page
└── README.md
```

## 🛠️ Technology

| Component | Technology | Purpose |
|-----------|-----------|----------|
| **P2P Network** | Hyperswarm | Peer discovery and connection |
| **Storage** | Hypercore | Immutable, cryptographically signed logs |
| **Index** | Hyperbee | Distributed data structure (B-tree) |
| **Desktop** | Electron | Cross-platform native UI |
| **Cryptography** | Ed25519 | Digital data signing |

## 📦 Installation

### Requirements
- Node.js 18+ (tested on Node 22)
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/valverde-marcelo/coherence.git
cd coherence/v1

# Install dependencies
npm install

# Start the application
npm start
```

## 🎮 Usage

### First Run
1. Launch the app with `npm start`
2. On first run, choose the language and import an identity or create a new account
3. Edit your profile (bio, avatar, links)
4. Start posting!

### Multiple instances and local users

Each identity's data is isolated in `coherence-data/<public-key>`. The app doesn't use an
instance lock, so different accounts can run at the same time.

When there is more than one local account, `npm start` shows an **interactive selection
menu** (arrow keys ↑/↓ + Enter) letting you choose which account to open. To skip the
menu, specify the public key directly:

```bash
npm start -- --user-key <hex-public-key>
```

To open **all** local accounts found in `coherence-data` at once (one window per user),
use:

```bash
npm run start-all
```

When there is **more than one** local account, `start-all` shows the same menu — including
the option to start **all** of them (or cancel). The same selection can be driven
non-interactively:

```bash
npm run start-all -- --all                      # start all, without asking
npm run start-all -- --select                   # force the selection menu
npm run start-all -- --user-key=<hex-public-key>  # start a specific account
```

`npm start` uses the same launcher logic: with multiple accounts it opens a single
foreground window for the chosen account (or launches all of them in the background if
you pick "TODAS"). `npm start -- --new-user` always goes straight to the new-account flow.

The launcher detects each identity's folder in `coherence-data` and starts one Electron
instance per account, with `--user-key` filled automatically. When opening multiple
windows it "watches" for ~20s: if any instance crashes on startup (e.g., identity error),
the reason is shown in the terminal and the full log is at
`%TEMP%\coherence-start-all\<key>.log`.

> ⚠️ Each identity uses a `corestore` with an exclusive lock: the same account cannot be
> open in two instances at the same time. If a window is already open for an account,
> running `start-all` again will make that account's new instance fail with "File
> descriptor could not be locked" (the log explains).

### Following Users
1. Paste a friend's public key into the "Following" tab
2. You will be connected automatically when both are online
3. Your posts and profile will be replicated

### Viewing Followers
1. Click the "Followers" tab in the right sidebar
2. Everyone who connected to your node will appear
3. Click a name to view the full profile

## 🔄 Data Synchronization

Data is replicated through:

1. **Automatic Replication**: When two peers connect, data is synchronized
2. **Smart Polling**: Profile and post updates every few seconds
3. **Peer Detection**: New followers are detected in real time
4. **Local Persistence**: Everything is saved in `~/Documents/coherence-data/`

## 🧪 Tests

```bash
npm test
```

This runs real integration tests (`test/`) against an **isolated local DHT**
(`hyperdht/testnet`, no internet needed), covering:

- `test-posts-and-unfollow.js` — post validation (text/image/size limit) and follow/unfollow.
- `test-integration-follow-sync.js` — Bob follows Alice, syncs the history and receives new posts in real time.
- `test-follow-target.js` — the follow-request only registers the follower on the correct owner (targetKey).
- `test-search-transitive.js` — transitive search: in Alice→Bob→Carol→Dave, any node finds the others.
- `test-integration-seeding.js` — **the seeding requirement**: Bob follows Alice, Alice goes offline, Carol still follows Alice and receives her posts through Bob.
- `test-persistence.js` — identity, posts and following list survive an app restart.
- `test-restart-after-stop-race.js` — concurrent read during stop and first post after reopening.
- `test-identity-recovery.js` — recovery of profile, posts and followers using only `identity.json`.
- `test-recovery-timeout.js` — timeout without a seeder and fallback to a new core.
- `test-import-cancel-no-corestore.js` — importing without a seeder and canceling doesn't create `corestore`; recovering with a seeder promotes the storage and writes the recovery marker.

## 🔐 Privacy & Security

- **No Central Server**: Data is not centralized
- **End-to-End Encryption**: Data is signed with Ed25519
- **Full Control**: You have complete control over your data
- **Privacy by Design**: Peers can only read data you share

**Note**: A peer can read your profile and posts if they know your public key. This is by
design - you choose who you share your key with.

### Recovering an identity

Export and keep the `identity.json` file. On another installation, import only that file.
The app will wait for a seeder that has your Hypercore to recover your profile, posts,
and followers. While the identity is not recovered from the network, the user **never**
gets access to it: canceling/closing during recovery removes the pending import, and a
crash mid-process returns to the recovery screen. Without a seeder, the "start from
scratch" option generates a **new identity** (the imported key is not reused).

## 💾 Full Reset

The **in-app reset** (Settings → "Resetar aplicação") and `npm run reset` remove the
current account (asking for confirmation before deleting). With multiple accounts, the
CLI shows an interactive menu to choose which account to reset — including the option to
reset **all** of them:

```bash
npm run reset                              # reset the current/single account or show the menu
npm run reset -- --user-key=<hex-public-key>  # reset a specific account
npm run reset -- --select                  # force the selection menu
npm run reset -- --yes                     # confirm automatically (no prompt)
npm run reset-all                          # reset ALL local accounts
```

This removes:
- Identity (keypair)
- All posts
- Profile
- Following list
- Cache

## What's missing (suggested next steps)

- **Larger images**: currently embedded as base64 inside the post, with a ~400KB limit.
  Evolve to blobs referenced by hash (`hyperblobs`/`hyperdrive`) when this becomes a bottleneck.
- **Profile avatar** — the field already exists in the data model, the UI to set it is missing.
- **Feed pagination** — today `getFeed()` reads everything; fine for a few posts, needs a
  real range/`limit` as the history grows.
- **Multi-device** — don't write to the same identity simultaneously from two machines.
- **Fallback relay** — for double CGNAT, when hole punching isn't enough
  (Hyperswarm already tries UPnP/hole punching on its own, but there's no relay configured yet).
- **Local block/mute** — there's no moderation; since posts are immutable, this only makes
  sense as a filter on the reader's side.
- **Custom title bar** — currently uses the OS native chrome (functional, not the focus of this phase).

## 🐛 Debugging

Logs are printed to the console during execution:

```
[swarm:connection] Socket connected from peer: ...
[getProfile] Fetching profile from: ...
[getFollowers] Returning X followers
```

## 📝 Roadmap

- [ ] Web UI (beyond Electron)
- [ ] Media support (images/videos)
- [ ] Reactions/likes system
- [ ] Real-time notifications
- [ ] Distributed search
- [ ] Improved DHT
- [ ] Mobile app (React Native)

## � Releases & Updates

Windows executables — **installer (NSIS)** and **portable** — are published on
[GitHub Releases](https://github.com/valverde-marcelo/coherence/releases).

The app checks for updates against GitHub Releases on startup (max once a day)
and through **Settings → "verificar atualizações"**. When a newer release is
available, a banner appears with a download link. Because your data lives in
`~/Documents/coherence-data` (outside the installation folder), updating by
reinstalling over the current version **preserves your identity, profile, posts
and settings**.

## 💖 Donate

Coherence is free and open-source. If it's useful to you, consider supporting
its development. The repo also has a **Sponsor** button (see
[.github/FUNDING.yml](.github/FUNDING.yml)):

- **PayPal** — [Donate](https://www.paypal.com/donate/?business=MX8LMBWFQY734&no_recurring=0&item_name=If+you+like+my+open-source+projects%2C+consider+buying+me+a+coffee+to+support+my+coding+journey%21&currency_code=USD)
- **Buy Me a Coffee** — <https://buymeacoffee.com/valverdeoficial>
- **USDT (TRON)** — `THBH1uEjPjSXqA56PKzfUXTvZoLCQn5s8d`
- **BTC (Lightning Network)** — QR code inside the app's **About** tab

The **About** tab inside the app shows the donation QR codes. A **Donate**
section is also available on the [landing page](https://valverde-marcelo.github.io/coherence/).

## �📄 License

Apache-2.0 - See [LICENSE](LICENSE) for details. The application is free and
open-source, and can be used in commercial products. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the license summary of the
dependencies used by Coherence.

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the project
2. Create a branch for your feature (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 Contact

For questions or suggestions, open an issue in the repository.

---

**Coherence** - Decentralized communication, without limits. 🌐

> `v1/preview-da-interface.png` is an automatic screenshot of the v1 interface (captured
> on a virtual display during development) for visual reference only — the source and
> exact render may vary a bit on your machine.

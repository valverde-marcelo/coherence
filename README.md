# Coherence - Distributed P2P Social Network

A distributed social network built on P2P (peer-to-peer) technology using **Hyperswarm**, **Hypercore**, and **Hyperbee**. No centralized servers, no censorship, no data collection.

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
│   ├── test/                    # Integration tests
│   ├── scripts/
│   │   └── reset.js             # Script to reset data
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
- Node.js 16+
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
2. **Smart Polling**: Profile and post updates every 10 seconds
3. **Peer Detection**: New followers are detected in real time
4. **Local Persistence**: Everything is saved in `~/Documents/coherence-data/`

## 🧪 Tests

```bash
# Run the test suite
npm test

# Tests include:
# - test-posts-and-unfollow.js      → Posts and unfollowing
# - test-integration-follow-sync.js  → Follow synchronization
# - test-integration-seeding.js      → Data seeding
# - test-persistence.js              → Data persistence
# - test-restart-after-stop-race.js  → Restart during concurrent reads
# - test-identity-recovery.js        → Recovery using only identity.json
# - test-recovery-timeout.js         → Timeout and fallback to a new core
```

## 🔐 Privacy & Security

- **No Central Server**: Data is not centralized
- **End-to-End Encryption**: Data is signed with Ed25519
- **Full Control**: You have complete control over your data
- **Privacy by Design**: Peers can only read data you share

**Note**: A peer can read your profile and posts if they know your public key. This is by design - you choose who you share your key with.

### Recovering an identity

Export and keep the `identity.json` file. On another installation, import only that
file. The app will wait for a seeder that has your Hypercore to recover your profile,
posts, and followers. If no seeder appears within the timeout, you can start from
scratch while keeping the same identity.

## 💾 Full Reset

To clear all data and start from scratch:

```bash
npm run reset
npm start
```

This removes:
- Identity (keypair)
- All posts
- Profile
- Following list
- Cache

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

## 📄 License

MIT - See [LICENSE](LICENSE) for details

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

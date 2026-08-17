# Follower Discovery

## 1. Swarm Inspection

**How it works in Hypercore:** Hypercore's network and peer discovery layer is managed by the Hyperswarm module.

**Implementation:**

- The author publishes their log (feed) by announcing a `discoveryKey` on Hyperswarm (a BLAKE2b cryptographic hash of the Hypercore public key).
- When followers try to read or sync the feed, they connect to the Hyperswarm swarm associated with that `discoveryKey`.
- The author's app can inspect, in real time, the array of active connections (`core.peers` or `swarm.connections`). During the initial connection handshake, the receivers' cryptographic identities and IP addresses become immediately accessible to the author's node.

## 2. Follow Records in Append-Only Logs (Hypercore's main solution)

**How it works in Hypercore:** Hypercore is, in essence, a distributed, immutable log that only allows appending data (append-only log). Each user is the sole holder of the private key of their own log.

**Implementation:**

- When User B clicks to follow User A, B's app performs a `core.append()` on their own Hypercore, writing a block with the instruction: `{ type: 'follow', target: publicKey_A }`.
- For User A (or any other user) to discover who their followers are, database structures built on top of Hypercore are used, such as Hyperbee or Hypertrie (which turn ordered logs into key-value indexes).
- Local indexes or reader nodes (indexers) traverse the logs of known peers in the social network to map "who follows whom" connections, creating a fully decentralized social graph verifiable by digital signatures.

## 3. Block-Level Read Confirmations (Read Receipts)

**How it works in Hypercore:** Hypercore's replication protocol operates by requesting specific blocks of data by sequential index (`seq`).

**Implementation:**

- When User B's app tries to render a post from User A, B's client sends a `get(index)` request via the P2P stream to fetch that specific block.
- User A's app intercepts this event on their own Hypercore's replication stream.
- Since the block request is associated with the connected peer, the author's node knows exactly the moment the follower downloaded the post block, acting as an instant read/receipt confirmation at the protocol level.

## 4. Official account as a search hub

Every brand-new user automatically follows the hardcoded official "Coherence" account
(`OFFICIAL_COHERENCE_KEY` in `v1/src/coherence-official.js`). Since all users share this
single follower edge, the official becomes a **common hub of degree 1**: the transitive
search (`searchUsers`) can reach any user from any other by traversing the official's
follower records, drastically reducing the hops needed to discover new people.

> ⚠️ The hub only works while the official's core is reachable (the official online or
> being seeded by followers). Without it, new users still follow the official but see
> "syncing" until it is available, and discovery falls back to the ordinary graph paths.

# P2P Network — Core Option B (Hypercore) + Electron

First functional slice of the distributed social network, using **Hypercore/Corestore/Hyperbee**
as the post log engine (instead of hand-written `GET_PROFILE`/`GET_POST` messages) and an
**Electron** shell on top.

## ⚠️ Before anything: your public key changed format

In the original prototype, the "public key" you shared with friends was the raw Ed25519
(32 bytes). **Corestore no longer supports the "compat" mode** that would preserve this
(we tested — it forces `compat: false` internally, "no compat for now" in their own code).
So now the key you share is the Hypercore `core.key`: a hash of the manifest (which
internally contains the same Ed25519 key as always — the cryptographic *identity* stays
the same, only the public address format changed).

In practice: if you already tested the old prototype with a friend, you'll need to
exchange the new key (visible at the top of the app's sidebar) before following each
other again. Your `identity.json` (Ed25519 keypair) continues to be reused — there's no
need to recreate any identity.

## What is already implemented

- **`src/identity.js`** — loads/generates the Ed25519 keypair (same logic as the original
  prototype) and converts it to the `{publicKey, secretKey}` format Hypercore expects.
- **`src/p2p-node.js`** — the `P2PNode` class:
  - One Hyperbee (signed B-tree over a Hypercore) per user, with two key families:
    `profile` (name/bio/avatar/following list) and `post!<seq>` (posts, text or base64 image).
  - `follow(key)` loads the person's Hypercore (read-only) via Corestore and joins their
    Hyperswarm topic with `{server: true, client: true}` — this is what makes this node
    **seed** the followed profile to third parties, even with the owner offline.
  - All signature/integrity verification of the chain is done by Hypercore itself during
    replication — we don't write it by hand.
  - `getFeed()` merges your own posts + those of people you follow, in chronological order.
- **`main.js` / `preload.js`** — Electron main process hosts the `P2PNode`; the renderer
  only talks to it via IPC (`contextIsolation: true`, `nodeIntegration: false`).
- **`renderer/`** — feed, publish form (text + image), follow by key, edit profile,
  connected peer counter.
- **Identity recovery** — the `identity.json` backup includes the Hypercore key. On an
  installation without `corestore`, the app waits for a seeder, recovers profile, posts
  and followers and **only then** creates the local `corestore` and unlocks writing.
  While the identity is not recovered from the network, the user **never** gets access to
  it: canceling/closing during recovery removes the pending import (the next start goes
  back to the welcome screen), and a crash mid-process returns to the recovery screen.
  Without a seeder, the "start from scratch" option now generates a **new identity**
  (discards the imported key).
- **Transitive user search** — `searchUsers()` traverses the follow graph in both
  directions (who you follow/followers and, for each profile, its follows and followers),
  loading profiles on demand up to 3 hops. In an Alice→Bob→Carol→Dave scenario, any
  user can find the others by name, bio or key prefix, with the path ("via Bob",
  "via Carol") and view-profile/follow actions.

## How to run

```bash
npm install
npm start          # opens the Electron app
```

To recover an account on another installation, import only the exported `identity.json`.

## Multiple instances and local users

Each identity's data is isolated in `coherence-data/<public-key>`. The app doesn't use an instance lock, so different accounts can run at the same time.

When there is more than one local account, specify the public key of the account to open:

```bash
npm start -- --user-key <hex-public-key>
```

To open **all** local accounts found in `coherence-data` at once (one window per user), use:

```bash
npm run start-all
```

This command detects each identity's folder in `coherence-data` and starts one Electron instance per account, with `--user-key` filled automatically. It "watches" for ~20s: if any instance crashes on startup (e.g., identity error), the reason is shown in the terminal and the full log is at `%TEMP%\coherence-start-all\<key>.log`. After that the script exits and the windows stay open.

> ⚠️ Each identity uses a `corestore` with an exclusive lock: the same account cannot be open in two instances at the same time. If a window is already open for an account, running `start-all` again will make that account's new instance fail with "File descriptor could not be locked" (the log explains).

To open the new-account creation flow even when local accounts already exist, use `--new-user`:

```bash
npm start -- --new-user
```

You can also use the dedicated script, which prevents npm from interpreting the option as configuration:

```bash
npm run new-user
```

The in-app reset and `npm run reset` only remove the current account. With multiple accounts, the terminal reset needs to specify the key:

```bash
npm run reset -- --user-key=<hex-public-key>
```

To remove all local users, use exclusively the command line:

```bash
npm run reset-all
```

The app will wait for a seeder that has your Hypercore; after the timeout, the
"start from scratch" option generates a **new identity** (the imported key is not reused).

## Automated tests

```bash
npm test
```

This runs real integration tests (`test/`) against an **isolated local DHT**
(`hyperdht/testnet`, no internet needed), covering:

- `test-posts-and-unfollow.js` — post validation (text/image/size limit) and follow/unfollow.
- `test-integration-follow-sync.js` — Bob follows Alice, syncs the history and receives new posts in real time.
- `test-follow-target.js` — the follow-request only registers the follower on the correct owner (targetKey).
- `test-search-transitive.js` — transitive search: in Alice→Bob→Carol→Dave, any node finds the others.
- `test-integration-seeding.js` — **the seeding requirement**: Bob follows Alice, Alice goes
  offline, Carol still follows Alice and receives her posts through Bob.
- `test-persistence.js` — identity, posts and following list survive an app restart.
- `test-restart-after-stop-race.js` — concurrent read during stop and first post after reopening.
- `test-identity-recovery.js` — recovery of profile, posts and followers using only `identity.json`.
- `test-recovery-timeout.js` — timeout without a seeder and fallback to a new core.
- `test-import-cancel-no-corestore.js` — importing without a seeder and canceling doesn't create `corestore`;
  recovering with a seeder promotes the storage and writes the recovery marker.

All passing at delivery time.

## What's missing (suggested next steps)

- **Larger images**: currently embedded as base64 inside the post, with a ~400KB limit.
  Evolve to blobs referenced by hash (`hyperblobs`/`hyperdrive`) when this becomes a bottleneck.
- **Profile avatar** — the field already exists in the data model, the UI to set it is missing.
- **Feed pagination** — today `getFeed()` reads everything; fine for a few posts, needs a
  real range/`limit` as the history grows.
- **Multi-device** — don't write to the same identity simultaneously from two machines.
  Recovery downloads the history from a seeder and only then reopens the core for writing.
- **Fallback relay** — for double CGNAT, when hole punching isn't enough
  (Hyperswarm already tries UPnP/hole punching on its own, but there's no relay configured yet).
- **Local block/mute** — there's no moderation; since posts are immutable, this only makes
  sense as a filter on the reader's side.
- **Custom title bar** — currently uses the OS native chrome (functional, not the focus of this phase).

## Structure

```
p2p-social/
├── main.js              # Electron main process
├── preload.js            # secure bridge (contextBridge) to the renderer
├── src/
│   ├── identity.js        # Ed25519 key -> Hypercore keyPair
│   └── p2p-node.js         # P2P core: Corestore + Hyperbee + Hyperswarm
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
└── test/                  # integration tests (see above)
```

`preview-da-interface.png`, next to this README, is an automatic screenshot (captured
on a virtual display during development) for visual reference only — the source and
exact render may vary a bit on your machine.

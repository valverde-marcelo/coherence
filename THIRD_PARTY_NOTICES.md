# Third-Party Notices & License Compatibility

This document lists the third-party libraries used by **Coherence** (the `v1`
desktop app), their licenses, and a summary of license compatibility — including
for **commercial use**.

> Licenses were verified against the installed packages under `v1/node_modules/`
> (`package.json` → `license` field) on 2026-08-14.

## Direct dependencies (`v1/package.json`)

| Package | Version | License | Notes |
|---------|---------|---------|-------|
| [hypercore](https://github.com/hypercore-protocol/hypercore) | ^11.35.0 | MIT | Core signed append-only log |
| [hyperswarm](https://github.com/hyperswarm/hyperswarm) | ^4.17.0 | MIT | P2P peer discovery/connections |
| [hyperbee](https://github.com/hypercore-protocol/hyperbee) | ^2.27.3 | MIT | B-tree KV store over Hypercore |
| [corestore](https://github.com/holepunchto/corestore) | ^7.11.1 | MIT | Multi-core storage manager |
| [hypercore-crypto](https://github.com/holepunchto/hypercore-crypto) | ^3.7.0 | MIT | Crypto primitives |
| [qrcode](https://github.com/soldair/node-qrcode) | ^1.5.4 | MIT | QR code generation |
| [protomux](https://github.com/holepunchto/protomux) | ^3.x (transitive) | MIT | Multiplexed protocol streams |

## Key transitive / native dependencies

| Package | License |
|---------|---------|
| dht-rpc, hyperdht, sodium-native, noise-handshake, b4a, streamx, compact-encoding, etc. | MIT |
| rocksdb-native, udx-native, device-file, fs-native-extensions, quickbit-native, simdle-native, blind-relay | Apache-2.0 |
| Electron (runtime) | MIT |

## License compatibility summary

- **Every dependency** is under a **permissive** license (**MIT** or
  **Apache-2.0**). There is **no copyleft** (no GPL/AGPL/LGPL) anywhere in the
  dependency tree.
- MIT and Apache-2.0 are fully compatible with each other and with **commercial
  use**, **closed-source distribution**, and **proprietary modifications**.
- **Apache-2.0** obligations when redistributing (which also apply to Coherence
  itself, since it is Apache-2.0):
  1. Retain the license/copyright notices (this file fulfills that).
  2. Include a copy of the Apache-2.0 license text for Apache-2.0 components.
  3. State significant changes made to Apache-2.0 licensed files (relevant only
     if you modify the Holepunch native modules themselves).
  4. Apache-2.0 grants an explicit **patent license** to contributors; MIT
     components grant an implicit patent license where applicable.
- **Electron** (MIT) imposes no restriction on distributing the packaged app,
  including the runtime and Chromium/Node binaries.

## Conclusion

Coherence **may** be used and extended for **commercial purposes** using all of
its current dependencies. No license fees, no source disclosure of your
proprietary code, and no copyleft obligations are triggered by the libraries in
use. Only the standard MIT/Apache-2.0 attribution/notice requirements apply, and
they are covered by this file plus the `LICENSE` file at the repository root.

## Keeping this file up to date

When adding or updating dependencies, verify the `license` field of each new
package (and its native/transitive children) and update this table. A quick
check:

```bash
cd v1
node -e "for (const p of process.argv.slice(1)) { const j=require('./node_modules/'+p+'/package.json'); console.log(p, j.version, j.license) }" hypercore hyperswarm hyperbee corestore qrcode
```

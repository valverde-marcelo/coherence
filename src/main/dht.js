'use strict'
const crypto = require('crypto')
const nacl = require('tweetnacl')

/**
 * Camada de descoberta via DHT Kademlia (BEP44 - "mutable item").
 *
 * Cada usuário publica, na chave da sua própria chave pública ed25519, um
 * "ponteiro" pequeno e assinado apontando para o que há de mais recente:
 *   { chainSeq, chainHash, latest:{start,end,infohash}, prevInfohash, ts }
 *
 * Isso substitui um servidor central de "quem segue quem tem novidade": basta
 * a chave pública de alguém para descobrir, via DHT, o estado mais recente
 * dessa pessoa — sem cadastro e sem backend.
 */

function verifyFn (sigBuf, msgBuf, pubKeyBuf) {
  try {
    return nacl.sign.detached.verify(msgBuf, sigBuf, pubKeyBuf)
  } catch {
    return false
  }
}

function makeDhtOpts () {
  return {
    verify: verifyFn,
    bootstrap: [
      'router.bittorrent.com:6881',
      'router.utorrent.com:6881',
      'dht.transmissionbt.com:6881'
    ]
  }
}

/**
 * Publica (ou atualiza) o ponteiro mutável do usuário no DHT.
 *
 * bittorrent-dht tem uma peculiaridade: se `put()` for chamado antes de a DHT
 * conhecer QUALQUER nó (ex.: logo na inicialização, antes do bootstrap
 * terminar), ele guarda em cache — permanentemente, mesmo depois de nós
 * serem descobertos — uma tabela vazia de "nós mais próximos" para aquela
 * chave, e todo `put()` seguinte para a MESMA chave volta a falhar com
 * "No nodes to query". Por isso tentamos algumas vezes, limpando esse cache
 * interno antes de cada nova tentativa.
 */
function publishPointer (dht, identity, pointerObj, { retries = 6, retryDelayMs = 2000 } = {}) {
  const v = Buffer.from(JSON.stringify(pointerObj))
  if (v.length > 990) return Promise.reject(new Error('valor do ponteiro DHT excede o limite do BEP44 (~1000 bytes)'))
  const targetHex = crypto.createHash('sha1').update(identity.publicKey).digest('hex')

  const attempt = () => new Promise((resolve, reject) => {
    dht.put({
      k: identity.publicKey,
      seq: Date.now(),
      v,
      sign: buf => identity.sign(buf)
    }, (err, hash) => {
      if (err) return reject(err)
      resolve(hash)
    })
  })

  return (async () => {
    let lastErr
    for (let i = 0; i <= retries; i++) {
      try {
        console.log(`[dht] tentativa ${i + 1}/${retries + 1} de publicar ponteiro`)
        return await attempt()
      } catch (err) {
        lastErr = err
        if (dht._tables && typeof dht._tables.remove === 'function') {
          dht._tables.remove(targetHex)
          console.log(`[dht] limpou cache para retry ${i + 1}`)
        }
        if (i < retries) await new Promise(r => setTimeout(r, retryDelayMs))
      }
    }
    throw lastErr
  })()
}

/**
 * Resolve o ponteiro mutável mais recente de um pubkey (hex) via DHT.
 * Retorna null se nada for encontrado.
 *
 * A "chave" de lookup no DHT (BEP44) é sha1(chave_pública) — não a chave
 * pública crua — pois é esse o "target" usado pelo dht.put() internamente.
 */
function resolvePointer (dht, pubkeyHex) {
  const pubkeyBuf = Buffer.from(pubkeyHex, 'hex')
  const target = crypto.createHash('sha1').update(pubkeyBuf).digest()
  return new Promise((resolve, reject) => {
    dht.get(target, (err, res) => {
      if (err) return reject(err)
      if (!res || !res.v) return resolve(null)
      try {
        const pointer = JSON.parse(res.v.toString('utf8'))
        resolve({ pointer, seq: res.seq })
      } catch {
        resolve(null)
      }
    })
  })
}

module.exports = { makeDhtOpts, publishPointer, resolvePointer }

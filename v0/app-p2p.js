import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import express from 'express'
import nodeCrypto from 'node:crypto'
import fs from 'node:fs'

// ====================================================================
// 1. IDENTITY AND PERSONAL PAGE (With Digital Signature) - FINAL SOLUTION
// ====================================================================

const KEY_FILE = './identity.json'
let keyPair
let publicKeyBuffer

// Node does not have format:'buffer' nor type:'ed25519' in KeyObject.export().
// To get the raw 32 bytes of the Ed25519 public key, we export as JWK
// (OKP/RFC 8037 format) and decode the "x" field, which is the key in base64url.
function getRawPublicKey(publicKeyObject) {
  const jwk = publicKeyObject.export({ format: 'jwk' })
  return Buffer.from(jwk.x, 'base64url')
}

// Loads or generates the Ed25519 keypair
if (fs.existsSync(KEY_FILE)) {
  const saved = JSON.parse(fs.readFileSync(KEY_FILE))
  keyPair = {
    publicKey: nodeCrypto.createPublicKey(saved.publicKey),
    privateKey: nodeCrypto.createPrivateKey(saved.privateKey)
  }
  // Natively exports the raw 32 bytes of the loaded Ed25519 key
  publicKeyBuffer = getRawPublicKey(keyPair.publicKey)
} else {
  keyPair = nodeCrypto.generateKeyPairSync('ed25519')
  
  // Saves the standard PEM structure to the file for secure persistence
  fs.writeFileSync(KEY_FILE, JSON.stringify({
    publicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' })
  }))
  
  // Natively exports the raw 32 bytes of the newly created Ed25519 key
  publicKeyBuffer = getRawPublicKey(keyPair.publicKey)
}

// Public key in hexadecimal format with EXACTLY 64 characters for the web panel
const publicKeyHex = publicKeyBuffer.toString('hex')

// Passes the guaranteed 32-byte buffer directly to generate the discovery topic
const topic = crypto.discoveryKey(publicKeyBuffer)


// Local profile
const PROFILE_FILE = './my_profile.json'
if (!fs.existsSync(PROFILE_FILE)) {
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({
    nome: "Usuário P2P " + Math.floor(Math.random() * 1000),
    bio: "Página hospedada no meu computador com Hole Punching nativo!",
    posts: [
      { id: 1, texto: "Rede sem servidores e sem roteador configurado!", data: new Date().toISOString() }
    ]
  }, null, 2))
}

function getSignedProfile() {
  const profileData = JSON.parse(fs.readFileSync(PROFILE_FILE))
  const payload = JSON.stringify(profileData)
  
  // Ed25519 doesn't support Node's streaming Sign/Verify API;
  // the correct approach is to use crypto.sign(algorithm, data, key) in
  // "one-shot" mode, passing algorithm = null (the curve already does its own
  // hashing internally).
  const signature = nodeCrypto.sign(null, Buffer.from(payload), keyPair.privateKey)

  return {
    publicKey: publicKeyHex,
    payload: profileData,
    signature: signature.toString('hex')
  }
}

// ====================================================================
// 2. LAYERS 1 AND 2: BITTORRENT HYPERSWARM (UPnP + Hole Punching)
// ====================================================================

// Hyperswarm automatically performs:
// 1. UPnP/NAT-PMP opening on the local router (Layer 1)
// 2. NAT traversal / UDP Hole Punching via STUN (Layer 2)
const swarm = new Hyperswarm()

// Listens for new direct P2P connections received
swarm.on('connection', (socket, peerInfo) => {
  // The Hyperswarm peerInfo object does NOT have a ".peer" property — it exposes
  // publicKey, client, relayAddresses, topics, etc. The remote IP/port are on the
  // low-level UDX stream, accessible via socket.rawStream.
  const host = socket.rawStream?.remoteHost || 'desconhecido'
  const port = socket.rawStream?.remotePort
  const papel = peerInfo.client ? 'client' : 'server'
  console.log(`\n⚡ [P2P Direct Engine] New connection established via Hole Punching/UPnP! IP: ${host}${port ? ':' + port : ''} (role: ${papel})`)

  // When the remote node asks for the page, we send the signed data
  socket.on('data', (data) => {
    const msg = data.toString()
    if (msg === 'GET_PROFILE') {
      console.log('📤 [P2P] Serving personal page to the visitor...')
      socket.write(JSON.stringify(getSignedProfile()))
    }
  })
})

// Announces our Topic on the DHT so other nodes can punch through/connect to us
const discovery = swarm.join(topic, { server: true, client: true })

discovery.flushed().then(() => {
  console.log('✅ [P2P Engine] Node published on the global network via DHT / Hole Punching!')
})

// ====================================================================
// 3. LOCAL WEB INTERFACE (Express for the user to control)
// ====================================================================

const app = express()
const HTTP_PORT = process.env.PORT || 51234

app.get('/', (req, res) => {
  const myProfile = JSON.parse(fs.readFileSync(PROFILE_FILE))
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Meu Nó P2P (Hole Punching)</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; line-height: 1.6; }
        .card { border: 1px solid #ddd; padding: 15px; border-radius: 8px; margin-bottom: 20px; background: #fafafa; }
        input { width: 100%; padding: 10px; margin-top: 5px; box-sizing: border-box; }
        button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; }
      </style>
    </head>
    <body>
      <h2>👤 Minha Página P2P</h2>
      <div class="card">
        <h3>${myProfile.nome}</h3>
        <p>${myProfile.bio}</p>
        <p><strong>Sua Chave Pública (Compartilhe para visitarem sua página):</strong></p>
        <textarea style="width:100%" rows="3" readonly>${publicKeyHex}</textarea>
      </div>

      <h3>🔍 Visitar Amigo (Redes Distintas)</h3>
      <div class="card">
        <form action="/visit" method="GET">
          <label>Cole a Chave do Amigo:</label>
          <input type="text" name="key" required />
          <br/><br/>
          <button type="submit">Conectar via Hole Punching</button>
        </form>
      </div>
    </body>
    </html>
  `)
})

// Visitation route between networks using Layer 2 (Hole Punching)
app.get('/visit', async (req, res) => {
  const friendKey = req.query.key.trim()
  if (!friendKey) return res.send("Chave inválida.")

  console.log(`\n🔍 [Hole Punching] Starting NAT hole punching process for key: ${friendKey.slice(0, 15)}...`)

  // Derives the friend's topic from their public key
  const friendTopic = crypto.discoveryKey(Buffer.from(friendKey, 'hex'))

  // Joins the friend's room on the DHT to start the UDP/STUN handshake
  const friendDiscovery = swarm.join(friendTopic, { client: true, server: false })
  
  let connected = false

  // Tries to find and punch through to the friend's node
  const onConnection = (socket) => {
    if (connected) return
    connected = true
    console.log('🎯 [Hole Punching Success] P2P connection established directly with the friend\'s machine!')

    // Asks the friend for their profile over the open socket
    socket.write('GET_PROFILE')

    socket.on('data', (data) => {
      try {
        const friendSignedProfile = JSON.parse(data.toString())
        
        res.send(`
          <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto;">
            <h1>Página P2P de: ${friendSignedProfile.payload.nome}</h1>
            <p><strong>Status de Conexão:</strong> ⚡ Conexão Direta P2P (UPnP / Hole Punching)</p>
            <p><strong>Bio:</strong> ${friendSignedProfile.payload.bio}</p>
            <h3>Posts do Amigo:</h3>
            <ul>
              ${friendSignedProfile.payload.posts.map(p => `<li>${p.texto} <i>(${p.data})</i></li>`).join('')}
            </ul>
            <a href="/">← Voltar ao Meu Nó</a>
          </div>
        `)
      } catch (e) {
        res.send("Erro ao processar perfil: " + e.message)
      }
    })
  }

  swarm.once('connection', onConnection)

  // 15-second timeout in case Hole Punching can't punch through
  setTimeout(() => {
    if (!connected) {
      swarm.off('connection', onConnection)
      res.send(`
        <h3>❌ Falha no Furamento de NAT (Hole Punching)</h3>
        <p>Não foi possível estabelecer uma conexão P2P direta com o amigo.</p>
        <p><strong>Motivos possíveis:</strong></p>
        <ul>
          <li>A outra máquina não está rodando a aplicação neste momento.</li>
          <li>A outra rede possui um CGNAT duplo ultra-rígido (Necessitaria da Camada 3: Relay).</li>
        </ul>
        <a href="/">← Voltar</a>
      `)
    }
  }, 15000)
})

app.listen(HTTP_PORT, () => {
  console.log(`\n🚀 [Local Node Started] Dashboard available at: http://localhost:${HTTP_PORT}`)
})
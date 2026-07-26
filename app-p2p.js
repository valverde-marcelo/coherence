import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import express from 'express'
import nodeCrypto from 'node:crypto'
import fs from 'node:fs'

// ====================================================================
// 1. IDENTIDADE E PÁGINA PESSOAL (Com Assinatura Digital) - SOLUÇÃO DEFINITIVA
// ====================================================================

const KEY_FILE = './identity.json'
let keyPair
let publicKeyBuffer

// O Node não possui format:'buffer' nem type:'ed25519' em KeyObject.export().
// Para obter os 32 bytes crus da chave pública Ed25519, exportamos como JWK
// (formato OKP/RFC 8037) e decodificamos o campo "x", que é a chave em base64url.
function getRawPublicKey(publicKeyObject) {
  const jwk = publicKeyObject.export({ format: 'jwk' })
  return Buffer.from(jwk.x, 'base64url')
}

// Carrega ou gera o par de chaves Ed25519
if (fs.existsSync(KEY_FILE)) {
  const saved = JSON.parse(fs.readFileSync(KEY_FILE))
  keyPair = {
    publicKey: nodeCrypto.createPublicKey(saved.publicKey),
    privateKey: nodeCrypto.createPrivateKey(saved.privateKey)
  }
  // Exporta nativamente os 32 bytes puros da chave Ed25519 carregada
  publicKeyBuffer = getRawPublicKey(keyPair.publicKey)
} else {
  keyPair = nodeCrypto.generateKeyPairSync('ed25519')
  
  // Salva no arquivo a estrutura PEM padrão para persistência segura
  fs.writeFileSync(KEY_FILE, JSON.stringify({
    publicKey: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' })
  }))
  
  // Exporta nativamente os 32 bytes puros da chave Ed25519 recém-criada
  publicKeyBuffer = getRawPublicKey(keyPair.publicKey)
}

// Chave pública em formato hexadecimal com EXATAMENTE 64 caracteres para o painel web
const publicKeyHex = publicKeyBuffer.toString('hex')

// Passa o buffer garantido de 32 bytes diretamente para gerar o tópico de descoberta
const topic = crypto.discoveryKey(publicKeyBuffer)


// Perfil local
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
  
  // Ed25519 não suporta a API de streaming Sign/Verify do Node;
  // o correto é usar crypto.sign(algorithm, data, key) em modo "one-shot",
  // passando algorithm = null (a curva já faz seu próprio hash internamente).
  const signature = nodeCrypto.sign(null, Buffer.from(payload), keyPair.privateKey)

  return {
    publicKey: publicKeyHex,
    payload: profileData,
    signature: signature.toString('hex')
  }
}

// ====================================================================
// 2. CAMADAS 1 E 2: BITTORRENT HYPERSWARM (UPnP + Hole Punching)
// ====================================================================

// O Hyperswarm executa automaticamente:
// 1. Abertura UPnP/NAT-PMP no roteador local (Camada 1)
// 2. Furamento de NAT / UDP Hole Punching via STUN (Camada 2)
const swarm = new Hyperswarm()

// Escuta por novas conexões P2P diretas recebidas
swarm.on('connection', (socket, peerInfo) => {
  const host = peerInfo.client ? peerInfo.peer.host : 'Remoto'
  console.log(`\n⚡ [P2P Direct Engine] Nova conexão estabelecida via Hole Punching/UPnP! IP: ${host}`)

  // Quando o nó remoto pede a página, enviamos os dados assinados
  socket.on('data', (data) => {
    const msg = data.toString()
    if (msg === 'GET_PROFILE') {
      console.log('📤 [P2P] Servindo página pessoal para o visitante...')
      socket.write(JSON.stringify(getSignedProfile()))
    }
  })
})

// Anuncia nosso Tópico na DHT para que outros nós consigam nos furar/conectar
const discovery = swarm.join(topic, { server: true, client: true })

discovery.flushed().then(() => {
  console.log('✅ [P2P Engine] Nó publicado na rede global via DHT / Hole Punching!')
})

// ====================================================================
// 3. INTERFACE WEB LOCAL (Express para o usuário controlar)
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

// Rota de visitação entre redes usando a Camada 2 (Hole Punching)
app.get('/visit', async (req, res) => {
  const friendKey = req.query.key.trim()
  if (!friendKey) return res.send("Chave inválida.")

  console.log(`\n🔍 [Hole Punching] Iniciando processo de furamento de NAT para a chave: ${friendKey.slice(0, 15)}...`)

  // Deriva o tópico do amigo a partir da chave pública dele
  const friendTopic = crypto.discoveryKey(Buffer.from(friendKey, 'hex'))

  // Entra na sala do amigo na DHT para iniciar o handshaking UDP/STUN
  const friendDiscovery = swarm.join(friendTopic, { client: true, server: false })
  
  let connected = false

  // Tenta encontrar e furar a conexão com o nó do amigo
  const onConnection = (socket) => {
    if (connected) return
    connected = true
    console.log('🎯 [Hole Punching Success] Conexão P2P estabelecida diretamente com a máquina do amigo!')

    // Pede o perfil do amigo pela conexão socket aberta
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

  // Timeout de 15 segundos caso o Hole Punching não consiga furar
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
  console.log(`\n🚀 [Nó Local Iniciado] Dashboard disponível em: http://localhost:${HTTP_PORT}`)
})
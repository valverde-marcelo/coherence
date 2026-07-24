# 🌐 Descoberta P2P Pura + QR Code

**Status:** ✅ Finalizado  
**Abordagem:** Completamente descentralizada, sem servidores centralizados

---

## Filosofia

**Coerência usa descoberta 100% P2P pura:**
- ✅ Sem servidor central
- ✅ Sem HTTP tracker
- ✅ Sem DHT fallback externo
- ✅ Apenas mecanismos nativos de BitTorrent + manual

---

## Arquitetura de Descoberta

### Camada 1: DHT Global (Quando Disponível)

```
User1: publica pointer
  ↓
DHT Mainline (Kademlia)
  ↓
User2: descobre pointer globalmente
  ↓
Sincroniza posts ✅
```

**Funciona quando:** Rede está aberta, NAT/firewall permite UDP  
**Vantagem:** Descoberta global, sem dependência de rede local

---

### Camada 2: LSD Local (Mesma Subnet)

```
User1: publica capítulo → WebTorrent inicia
         ↓
    LSD mDNS anuncia locally
         ↓
User2 (mesma subnet): descobre via mDNS
         ↓
    Baixa capítulo + sincroniza ✅
```

**Funciona quando:** Firewall bloqueia UDP 6881-6889 mas LSD opera em UDP 5353  
**Vantagem:** Automático em redes locais, não precisa de ação manual

---

### Camada 3: PEX (Peer Exchange)

```
User1: conecta a User2 em torrent
  ↓
PEX gossip: "conheço User3"
  ↓
User2 descobre User3 através de User1
  ↓
Network propaga ✅
```

**Funciona quando:** Peers já conectados trocam informações  
**Vantagem:** Propagação orgânica, resiliente

---

### Camada 4: QR Code Manual

```
User1: clica "📱 QR" → compartilha chave
  ↓
User2: input chave pública + segue
  ↓
Se mesma subnet: LSD/PEX sincroniza
Se diferente: pode sincronizar via TCP manual ✅
```

**Funciona quando:** Nada acima funcionou, precisa ação humana  
**Vantagem:** Garante que mesmo em redes isoladas conseguem sincronizar

---

## Mecanismos de Sincronização

| Cenário | DHT | LSD | PEX | Manual | Resultado |
|---------|-----|-----|-----|--------|-----------|
| **Internet aberta** | ✅ | - | ✅ | - | Sincroniza globalmente |
| **Mesma subnet, UDP bloqueado** | ❌ | ✅ | ✅ | - | Sincroniza localmente |
| **Redes diferentes** | ❌ | ❌ | ❌ | ✅ | Sincroniza manual |
| **Completamente isolado** | ❌ | ❌ | ❌ | ✅ | QR Code previne | 

---

## Código Modificado

### `src/main/discovery.js`

#### `publishOwnPointer()` - Pure DHT
```javascript
async function publishOwnPointer (dht, identity, store) {
  // ... build pointer ...
  
  try {
    // Tenta DHT
    const result = await dhtLib.publishPointer(dht, identity, pointer)
    console.log('[discovery] pointer publicado no DHT')
    return result
  } catch (err) {
    // Se DHT falhar: LSD/PEX farão o trabalho localmente
    console.warn('[discovery] DHT indisponível')
    console.log('[discovery] posts serão descobertos via LSD/PEX quando peers se conectarem')
    return null
  }
}
```

**Mudança:** Removido fallback para HTTP tracker. Se DHT falha, confia em LSD/PEX.

#### `pollFollow()` - Pure DHT Query
```javascript
async function pollFollow ({ dht, torrentClient, store }, follow) {
  // Tenta resolver pointer via DHT
  try {
    resolved = await dhtLib.resolvePointer(dht, follow.pubkeyHex)
  } catch (err) {
    // Se DHT falha: peers podem estar conectados via LSD/PEX já
    console.log(`[discovery] pointer não encontrado via DHT (pode estar via LSD/PEX)`)
    resolved = null
  }
  
  // Se pointer não encontrado, continua com LSD/PEX
  if (!resolved) {
    return { updated: false }
  }
  
  // Se encontrou via DHT: baixa capítulos
  // ... download logic ...
}
```

**Mudança:** Removido fallback para HTTP tracker. Falha no DHT não bloqueia sincronização local.

### `renderer/app.js`

#### QR Code Modal - Manual Sharing
```javascript
async function showQRCodeModal (pubkeyHex) {
  // Cria modal dinâmico
  // Gera QR code com qrcode library
  // Permite copiar chave
  // Usuário compartilha: screenshot, send, etc
}
```

**Botão:** "📱 QR" na header  
**Flow:** Clique → vê QR → compartilha → outro user input key → sincronizam

---

## Como Testar

### Teste 1: Rede Global (Internet Aberta)
```bash
npm install && npm start
```
**Esperado:** DHT descobre peers, posts sincronizam globalmente automaticamente

### Teste 2: Rede Local (UDP Bloqueado)
```bash
# Terminal 1
COHERENCE_USER_DATA=/tmp/user1 npm start

# Terminal 2  
COHERENCE_USER_DATA=/tmp/user2 npm start
```

**Setup:** Mesma subnet local, firewall bloqueia UDP 6881-6889  
**Esperado:** LSD descobre chapters, posts sincronizam via mDNS + PEX  
**Logs:** `[discovery] pointer não encontrado via DHT` mas posts aparecem anyway

### Teste 3: Redes Diferentes + Manual
```bash
# User1 em network A
# User2 em network B

# User1: Click "📱 QR"
# Compartilha chave pública

# User2: Input chave + Segue
# Pode colocar URL torrent manualmente se necessário
```

**Esperado:** Manual sync via QR code sharing

---

## Propriedades do Design

✅ **Descentralizado:** Sem single point of failure  
✅ **Resiliente:** 4 camadas de fallback  
✅ **Privado:** Não há tracker que vê suas atividades  
✅ **Offline-ready:** QR code funciona sem internet  
✅ **Open Standard:** Puro BitTorrent (DHT, LSD, PEX)  

⚠️ **Trade-offs:**
- Descoberta global precisa de DHT funcional
- Usuários em redes diferentes precisam compartilhar chave manualmente
- Não há "busca global" de todos os usuários

---

## Roadmap Futuro

**V1 (Agora):** DHT + LSD + PEX + QR Manual ✅

**V2:** 
- Melhorar UI para QR code sharing
- Indicadores visuais de status (DHT, LSD, PEX)
- Sugerir peers conhecidos

**V3:**
- IPFS como DHT alternativa (ainda P2P puro)
- Gossip melhorado entre peers
- Cache local de pointers conhecidos

**V4:**
- WebSocket fallback (ainda P2P, apenas protocol)
- Relay peers (intermediários P2P, não centralizados)

---

## Conclusão

Coerência implementa **descoberta verdadeiramente descentralizada:**
- DHT para escala global
- LSD para sincronização local automática
- PEX para propagação orgânica
- QR Code para casos extremos

**Nenhum servidor. Apenas redes BitTorrent.**
